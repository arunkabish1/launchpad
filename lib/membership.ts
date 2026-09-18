import { getDb, ensureSchema } from "./db";
import { getProject } from "./store";
import { resolvePat } from "./status";
import {
  createClient,
  addRepoCollaborator,
  removeRepoCollaborator,
  type CollaboratorPermission,
} from "./github";
import { getUserById } from "./users";
import type { GithubInviteState, Membership, ProjectRole, SessionUser } from "./types";

const memoryMemberships = new Map<string, Membership>();

let schemaReady: Promise<void> | null = null;

function key(projectId: string, userId: string): string {
  return `${projectId}:${userId}`;
}

function ensureSchemaOnce(): Promise<void> {
  if (!schemaReady) schemaReady = ensureSchema();
  return schemaReady;
}

interface MembershipRow {
  project_id: string;
  user_id: string;
  username: string;
  role: string;
  github_username: string | null;
  github_invite_state: string;
  github_invite_error: string | null;
  created_at: string;
}

function rowToMembership(row: MembershipRow): Membership {
  return {
    projectId: row.project_id,
    userId: row.user_id,
    username: row.username,
    role: (row.role as ProjectRole) ?? "member",
    githubUsername: row.github_username,
    githubInviteState: (row.github_invite_state as GithubInviteState) ?? "none",
    githubInviteError: row.github_invite_error ?? undefined,
    createdAt: row.created_at,
  };
}

async function writeMembership(record: Membership): Promise<void> {
  const db = getDb();
  if (!db) {
    memoryMemberships.set(key(record.projectId, record.userId), record);
    return;
  }
  await ensureSchemaOnce();
  await db
    .prepare(
      "INSERT OR REPLACE INTO memberships (project_id, user_id, username, role, github_username, github_invite_state, github_invite_error, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    )
    .bind(
      record.projectId,
      record.userId,
      record.username,
      record.role,
      record.githubUsername,
      record.githubInviteState,
      record.githubInviteError ?? null,
      record.createdAt
    )
    .run();
}

export async function getMembership(
  projectId: string,
  userId: string
): Promise<Membership | null> {
  const db = getDb();
  if (!db) return memoryMemberships.get(key(projectId, userId)) ?? null;
  await ensureSchemaOnce();
  const row = await db
    .prepare(
      "SELECT project_id, user_id, username, role, github_username, github_invite_state, github_invite_error, created_at FROM memberships WHERE project_id = ? AND user_id = ?"
    )
    .bind(projectId, userId)
    .first<MembershipRow>();
  return row ? rowToMembership(row) : null;
}

export async function listMembershipsForProject(projectId: string): Promise<Membership[]> {
  const db = getDb();
  if (!db) {
    return Array.from(memoryMemberships.values())
      .filter((m) => m.projectId === projectId)
      .sort((a, b) => a.role.localeCompare(b.role) || a.username.localeCompare(b.username));
  }
  await ensureSchemaOnce();
  const { results } = await db
    .prepare(
      "SELECT project_id, user_id, username, role, github_username, github_invite_state, github_invite_error, created_at FROM memberships WHERE project_id = ? ORDER BY role ASC, username ASC"
    )
    .bind(projectId)
    .all<MembershipRow>();
  return results.map(rowToMembership);
}

export async function listMembershipsForUser(userId: string): Promise<Membership[]> {
  const db = getDb();
  if (!db) {
    return Array.from(memoryMemberships.values()).filter((m) => m.userId === userId);
  }
  await ensureSchemaOnce();
  const { results } = await db
    .prepare(
      "SELECT project_id, user_id, username, role, github_username, github_invite_state, github_invite_error, created_at FROM memberships WHERE user_id = ?"
    )
    .bind(userId)
    .all<MembershipRow>();
  return results.map(rowToMembership);
}

export async function upsertMembership(input: {
  projectId: string;
  userId: string;
  username: string;
  role: ProjectRole;
  githubUsername?: string | null;
}): Promise<Membership> {
  const existing = await getMembership(input.projectId, input.userId);
  const record: Membership = {
    projectId: input.projectId,
    userId: input.userId,
    username: input.username,
    role: input.role,
    githubUsername: input.githubUsername?.trim() || existing?.githubUsername || null,
    githubInviteState: existing?.githubInviteState ?? "none",
    githubInviteError: existing?.githubInviteError,
    createdAt: existing?.createdAt ?? new Date().toISOString(),
  };
  await writeMembership(record);
  return record;
}

export async function updateMembershipRole(
  projectId: string,
  userId: string,
  role: ProjectRole
): Promise<void> {
  const existing = await getMembership(projectId, userId);
  if (!existing) return;
  await writeMembership({ ...existing, role });
}

export async function updateMembershipGithubState(
  projectId: string,
  userId: string,
  state: GithubInviteState,
  error?: string
): Promise<void> {
  const existing = await getMembership(projectId, userId);
  if (!existing) return;
  await writeMembership({ ...existing, githubInviteState: state, githubInviteError: error });
}

export async function countProjectOwners(projectId: string): Promise<number> {
  const members = await listMembershipsForProject(projectId);
  return members.filter((m) => m.role === "owner").length;
}

export async function removeMembership(projectId: string, userId: string): Promise<void> {
  const db = getDb();
  if (!db) {
    memoryMemberships.delete(key(projectId, userId));
    return;
  }
  await ensureSchemaOnce();
  await db
    .prepare("DELETE FROM memberships WHERE project_id = ? AND user_id = ?")
    .bind(projectId, userId)
    .run();
}

export async function removeProjectMember(
  projectId: string,
  userId: string
): Promise<Membership | null> {
  const membership = await getMembership(projectId, userId);
  if (!membership) return null;
  const githubUsername = membership.githubUsername?.trim();
  if (githubUsername) {
    const project = await getProject(projectId);
    const pat = project ? await resolvePat(projectId) : null;
    if (project && pat) {
      try {
        await removeRepoCollaborator(
          createClient(pat),
          project.owner,
          project.repo,
          githubUsername
        );
      } catch (err) {
        console.error("Failed to remove GitHub collaborator", err);
      }
    }
  }
  await removeMembership(projectId, userId);
  return membership;
}

// ── Authorization ────────────────────────────────────────────────────────────

export async function filterAccessibleProjects<T extends { id: string }>(
  user: SessionUser,
  projects: T[]
): Promise<T[]> {
  if (user.globalRole === "admin") return projects;
  const memberships = await listMembershipsForUser(user.id);
  const ids = new Set(memberships.map((m) => m.projectId));
  return projects.filter((p) => ids.has(p.id));
}

export async function requireProjectRole(
  user: SessionUser,
  projectId: string,
  minRole: ProjectRole = "member"
): Promise<{ ok: true; role: ProjectRole } | { ok: false; error: string }> {
  if (user.globalRole === "admin") return { ok: true, role: "owner" };
  const membership = await getMembership(projectId, user.id);
  if (!membership) {
    return { ok: false, error: "You don't have access to this project." };
  }
  if (minRole === "owner" && membership.role !== "owner") {
    return { ok: false, error: "Only a project owner can perform this action." };
  }
  return { ok: true, role: membership.role };
}

// ── Ownership bootstrap + GitHub collaborator sync ───────────────────────────

export async function ensureProjectOwner(input: {
  projectId: string;
  projectName: string;
  userId: string;
  username: string;
  githubUsername?: string | null;
}): Promise<void> {
  let githubUsername = input.githubUsername ?? null;
  if (!githubUsername) {
    const user = await getUserById(input.userId);
    githubUsername = user?.githubUsername ?? null;
  }
  await upsertMembership({
    projectId: input.projectId,
    userId: input.userId,
    username: input.username,
    role: "owner",
    githubUsername,
  });
  await syncGithubCollaborator(input.projectId, input.userId, "add");
}

function permissionForRole(role: ProjectRole): CollaboratorPermission {
  return role === "owner" ? "admin" : "push";
}

export async function syncGithubCollaborator(
  projectId: string,
  userId: string,
  op: "add" | "remove"
): Promise<{ ok: boolean; state: GithubInviteState; error?: string }> {
  const membership = await getMembership(projectId, userId);
  if (!membership) return { ok: false, state: "none", error: "Membership not found." };
  const githubUsername = membership.githubUsername?.trim();
  if (!githubUsername) {
    return { ok: true, state: "none" };
  }

  const project = await getProject(projectId);
  if (!project) return { ok: false, state: "none", error: "Project not found." };

  // The repo owner already has full access; adding them as a collaborator fails.
  if (op === "add" && project.owner.toLowerCase() === githubUsername.toLowerCase()) {
    await updateMembershipGithubState(projectId, userId, "active");
    return { ok: true, state: "active" };
  }

  const pat = await resolvePat(projectId);
  if (!pat) {
    const error = "No GitHub token available to manage collaborators.";
    await updateMembershipGithubState(projectId, userId, "failed", error);
    return { ok: false, state: "failed", error };
  }

  try {
    const client = createClient(pat);
    if (op === "remove") {
      await removeRepoCollaborator(client, project.owner, project.repo, githubUsername);
      await updateMembershipGithubState(projectId, userId, "none");
      return { ok: true, state: "none" };
    }
    const status = await addRepoCollaborator(
      client,
      project.owner,
      project.repo,
      githubUsername,
      permissionForRole(membership.role)
    );
    const state: GithubInviteState = status === 201 ? "pending" : "active";
    await updateMembershipGithubState(projectId, userId, state);
    return { ok: true, state };
  } catch (err) {
    const error = (err as Error).message;
    await updateMembershipGithubState(projectId, userId, "failed", error);
    return { ok: false, state: "failed", error };
  }
}
