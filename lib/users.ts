import crypto from "node:crypto";
import { getDb, ensureSchema } from "./db";
import type { GlobalRole, UserRecord } from "./types";

const memoryUsers = new Map<string, UserRecord>();

let schemaReady: Promise<void> | null = null;

function ensureSchemaOnce(): Promise<void> {
  if (!schemaReady) schemaReady = ensureSchema();
  return schemaReady;
}

export function normalizeUsername(raw: string): string {
  return (raw ?? "").trim().toLowerCase().replace(/\s+/g, "-").slice(0, 40);
}

export function bootstrapAdminUsername(): string {
  return normalizeUsername(process.env.LAUNCHPAD_ADMIN_USER || "admin") || "admin";
}

interface UserRow {
  id: string;
  username: string;
  github_username: string | null;
  global_role: string;
  created_at: string;
  created_by: string | null;
}

function rowToUser(row: UserRow): UserRecord {
  return {
    id: row.id,
    username: row.username,
    githubUsername: row.github_username,
    globalRole: (row.global_role as GlobalRole) ?? "member",
    createdAt: row.created_at,
    createdBy: row.created_by,
  };
}

export async function getUserById(id: string): Promise<UserRecord | null> {
  const db = getDb();
  if (!db) return memoryUsers.get(id) ?? null;
  await ensureSchemaOnce();
  const row = await db
    .prepare(
      "SELECT id, username, github_username, global_role, created_at, created_by FROM users WHERE id = ?"
    )
    .bind(id)
    .first<UserRow>();
  return row ? rowToUser(row) : null;
}

export async function getUserByUsername(raw: string): Promise<UserRecord | null> {
  const username = normalizeUsername(raw);
  if (!username) return null;
  const db = getDb();
  if (!db) {
    for (const u of memoryUsers.values()) {
      if (u.username === username) return u;
    }
    return null;
  }
  await ensureSchemaOnce();
  const row = await db
    .prepare(
      "SELECT id, username, github_username, global_role, created_at, created_by FROM users WHERE username = ?"
    )
    .bind(username)
    .first<UserRow>();
  return row ? rowToUser(row) : null;
}

export async function listUsers(): Promise<UserRecord[]> {
  const db = getDb();
  if (!db) {
    return Array.from(memoryUsers.values()).sort((a, b) =>
      a.username.localeCompare(b.username)
    );
  }
  await ensureSchemaOnce();
  const { results } = await db
    .prepare(
      "SELECT id, username, github_username, global_role, created_at, created_by FROM users ORDER BY username ASC"
    )
    .all<UserRow>();
  return results.map(rowToUser);
}

export async function countUsers(): Promise<number> {
  const db = getDb();
  if (!db) return memoryUsers.size;
  await ensureSchemaOnce();
  const row = await db.prepare("SELECT COUNT(*) AS n FROM users").first<{ n: number }>();
  return row?.n ?? 0;
}

export async function createUser(input: {
  username: string;
  globalRole?: GlobalRole;
  githubUsername?: string | null;
  createdBy?: string | null;
}): Promise<UserRecord> {
  const username = normalizeUsername(input.username);
  if (!username) throw new Error("A username is required.");
  const existing = await getUserByUsername(username);
  if (existing) return existing;

  const user: UserRecord = {
    id: crypto.randomUUID(),
    username,
    githubUsername: input.githubUsername?.trim() || null,
    globalRole: input.globalRole ?? "member",
    createdAt: new Date().toISOString(),
    createdBy: input.createdBy ?? null,
  };

  const db = getDb();
  if (!db) {
    memoryUsers.set(user.id, user);
    return user;
  }
  await ensureSchemaOnce();
  await db
    .prepare(
      "INSERT INTO users (id, username, github_username, global_role, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?)"
    )
    .bind(
      user.id,
      user.username,
      user.githubUsername,
      user.globalRole,
      user.createdAt,
      user.createdBy
    )
    .run();
  return user;
}

export async function updateUserGithub(
  id: string,
  githubUsername: string | null
): Promise<void> {
  const value = githubUsername?.trim() || null;
  const db = getDb();
  if (!db) {
    const user = memoryUsers.get(id);
    if (user) memoryUsers.set(id, { ...user, githubUsername: value });
    return;
  }
  await ensureSchemaOnce();
  await db
    .prepare("UPDATE users SET github_username = ? WHERE id = ?")
    .bind(value, id)
    .run();
}
