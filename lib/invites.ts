import crypto from "node:crypto";
import { getDb, ensureSchema } from "./db";
import type { Invite, ProjectRole } from "./types";

const memoryInvites = new Map<string, Invite>();

let schemaReady: Promise<void> | null = null;

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function ensureSchemaOnce(): Promise<void> {
  if (!schemaReady) schemaReady = ensureSchema();
  return schemaReady;
}

function hashToken(raw: string): string {
  return crypto.createHash("sha256").update(raw).digest("hex");
}

interface InviteRow {
  token_hash: string;
  project_id: string;
  project_name: string;
  role: string;
  created_by: string;
  created_at: string;
  expires_at: string;
  accepted_at: string | null;
  accepted_by: string | null;
}

function rowToInvite(row: InviteRow): Invite {
  return {
    tokenHash: row.token_hash,
    projectId: row.project_id,
    projectName: row.project_name,
    role: (row.role as ProjectRole) ?? "member",
    createdBy: row.created_by,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    acceptedAt: row.accepted_at,
    acceptedBy: row.accepted_by,
  };
}

export async function createInvite(input: {
  projectId: string;
  projectName: string;
  role: ProjectRole;
  createdBy: string;
}): Promise<{ token: string; invite: Invite }> {
  const token = crypto.randomBytes(24).toString("base64url");
  const invite: Invite = {
    tokenHash: hashToken(token),
    projectId: input.projectId,
    projectName: input.projectName,
    role: input.role,
    createdBy: input.createdBy,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + INVITE_TTL_MS).toISOString(),
    acceptedAt: null,
    acceptedBy: null,
  };

  const db = getDb();
  if (!db) {
    memoryInvites.set(invite.tokenHash, invite);
    return { token, invite };
  }
  await ensureSchemaOnce();
  await db
    .prepare(
      "INSERT INTO invites (token_hash, project_id, project_name, role, created_by, created_at, expires_at, accepted_at, accepted_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
    )
    .bind(
      invite.tokenHash,
      invite.projectId,
      invite.projectName,
      invite.role,
      invite.createdBy,
      invite.createdAt,
      invite.expiresAt,
      invite.acceptedAt,
      invite.acceptedBy
    )
    .run();
  return { token, invite };
}

export async function getInviteByToken(raw: string): Promise<Invite | null> {
  if (!raw) return null;
  const tokenHash = hashToken(raw);
  const db = getDb();
  if (!db) return memoryInvites.get(tokenHash) ?? null;
  await ensureSchemaOnce();
  const row = await db
    .prepare(
      "SELECT token_hash, project_id, project_name, role, created_by, created_at, expires_at, accepted_at, accepted_by FROM invites WHERE token_hash = ?"
    )
    .bind(tokenHash)
    .first<InviteRow>();
  return row ? rowToInvite(row) : null;
}

export function inviteState(invite: Invite): "pending" | "accepted" | "expired" {
  if (invite.acceptedAt) return "accepted";
  if (new Date(invite.expiresAt).getTime() < Date.now()) return "expired";
  return "pending";
}

export async function listInvitesForProject(projectId: string): Promise<Invite[]> {
  const db = getDb();
  if (!db) {
    return Array.from(memoryInvites.values())
      .filter((i) => i.projectId === projectId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  await ensureSchemaOnce();
  const { results } = await db
    .prepare(
      "SELECT token_hash, project_id, project_name, role, created_by, created_at, expires_at, accepted_at, accepted_by FROM invites WHERE project_id = ? ORDER BY created_at DESC"
    )
    .bind(projectId)
    .all<InviteRow>();
  return results.map(rowToInvite);
}

export async function revokeInvite(projectId: string, raw: string): Promise<boolean> {
  return revokeInviteByHash(projectId, hashToken(raw));
}

export async function revokeInviteByHash(
  projectId: string,
  tokenHash: string
): Promise<boolean> {
  const db = getDb();
  if (!db) {
    const invite = memoryInvites.get(tokenHash);
    if (!invite || invite.projectId !== projectId) return false;
    memoryInvites.delete(tokenHash);
    return true;
  }
  await ensureSchemaOnce();
  const result = await db
    .prepare("DELETE FROM invites WHERE token_hash = ? AND project_id = ?")
    .bind(tokenHash, projectId)
    .run();
  return (result.meta?.changes ?? 0) > 0;
}

export async function acceptInvite(raw: string, userId: string): Promise<Invite | null> {
  const invite = await getInviteByToken(raw);
  if (!invite || inviteState(invite) !== "pending") return null;
  const acceptedAt = new Date().toISOString();

  const db = getDb();
  if (!db) {
    memoryInvites.set(invite.tokenHash, { ...invite, acceptedAt, acceptedBy: userId });
    return { ...invite, acceptedAt, acceptedBy: userId };
  }
  await ensureSchemaOnce();
  await db
    .prepare(
      "UPDATE invites SET accepted_at = ?, accepted_by = ? WHERE token_hash = ? AND accepted_at IS NULL"
    )
    .bind(acceptedAt, userId, invite.tokenHash)
    .run();
  return { ...invite, acceptedAt, acceptedBy: userId };
}
