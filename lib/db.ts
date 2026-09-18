import { getCloudflareContext } from "@opennextjs/cloudflare";

export interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  all<T = unknown>(): Promise<{ success: boolean; results: T[]; error?: string }>;
  first<T = unknown>(): Promise<T | null>;
  run(): Promise<{ success: boolean; meta?: { changes?: number; last_row_id?: number } }>;
}

export interface D1Database {
  prepare(sql: string): D1PreparedStatement;
}

let cached: D1Database | null | undefined;

export function getDb(): D1Database | null {
  if (cached !== undefined) return cached;
  try {
    const { env } = getCloudflareContext();
    cached = (env as { DB?: D1Database }).DB ?? null;
  } catch {
    cached = null;
  }
  return cached;
}

export function isCfRuntime(): boolean {
  return getDb() !== null;
}

export async function ensureSchema(): Promise<void> {
  const db = getDb();
  if (!db) return;
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        data TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`
    )
    .run();
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS audit (
        at TEXT NOT NULL,
        actor TEXT NOT NULL,
        action TEXT NOT NULL,
        project TEXT NOT NULL,
        detail TEXT NOT NULL,
        outcome TEXT NOT NULL
      )`
    )
    .run();
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS launchpad_config (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      )`
    )
    .run();
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL UNIQUE,
        github_username TEXT,
        global_role TEXT NOT NULL,
        created_at TEXT NOT NULL,
        created_by TEXT
      )`
    )
    .run();
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS memberships (
        project_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        username TEXT NOT NULL,
        role TEXT NOT NULL,
        github_username TEXT,
        github_invite_state TEXT NOT NULL,
        github_invite_error TEXT,
        created_at TEXT NOT NULL,
        PRIMARY KEY (project_id, user_id)
      )`
    )
    .run();
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS invites (
        token_hash TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        project_name TEXT NOT NULL,
        role TEXT NOT NULL,
        created_by TEXT NOT NULL,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        accepted_at TEXT,
        accepted_by TEXT
      )`
    )
    .run();
}
