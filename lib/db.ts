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
}
