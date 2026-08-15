import { getDb, ensureSchema } from "./db";
import type { Project } from "./types";

const memoryStore = new Map<string, Project>();

let schemaReady: Promise<void> | null = null;

function ensureSchemaOnce(): Promise<void> {
  if (!schemaReady) schemaReady = ensureSchema();
  return schemaReady;
}

async function readAll(): Promise<Project[]> {
  const db = getDb();
  if (!db) return Array.from(memoryStore.values());
  await ensureSchemaOnce();
  const { results } = await db.prepare("SELECT data FROM projects").all<{ data: string }>();
  return results.map((r) => JSON.parse(r.data) as Project);
}

async function writeAll(projects: Project[]): Promise<void> {
  const db = getDb();
  if (!db) {
    memoryStore.clear();
    for (const p of projects) memoryStore.set(p.id, p);
    return;
  }
  await ensureSchemaOnce();
  const stmt = db.prepare(
    "INSERT OR REPLACE INTO projects (id, data, updated_at) VALUES (?, ?, ?)"
  );
  for (const p of projects) {
    await stmt.bind(p.id, JSON.stringify(p), new Date().toISOString()).run();
  }
  const ids = projects.map((p) => p.id);
  await db
    .prepare(
      ids.length > 0
        ? `DELETE FROM projects WHERE id NOT IN (${ids.map(() => "?").join(",")})`
        : "DELETE FROM projects"
    )
    .bind(...ids)
    .run();
}

export async function listProjects(): Promise<Project[]> {
  const projects = await readAll();
  return projects.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function getProject(id: string): Promise<Project | null> {
  const db = getDb();
  if (!db) return memoryStore.get(id) ?? null;
  await ensureSchemaOnce();
  const row = await db
    .prepare("SELECT data FROM projects WHERE id = ?")
    .bind(id)
    .first<{ data: string }>();
  return row ? (JSON.parse(row.data) as Project) : null;
}

export async function addProject(project: Project): Promise<void> {
  const projects = await readAll();
  projects.push(project);
  await writeAll(projects);
}

export async function removeProject(id: string): Promise<void> {
  const projects = await readAll();
  const next = projects.filter((p) => p.id !== id);
  if (next.length === projects.length) return;
  await writeAll(next);
}

export async function updateProject(id: string, patch: Partial<Project>): Promise<void> {
  const projects = await readAll();
  const idx = projects.findIndex((p) => p.id === id);
  if (idx === -1) return;
  projects[idx] = { ...projects[idx], ...patch };
  await writeAll(projects);
}
