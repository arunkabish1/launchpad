import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getDb, ensureSchema } from "./db";
import type { AuditEntry } from "./types";

const memoryAudit: AuditEntry[] = [];
const AUDIT_CAP = 1000;

let schemaReady: Promise<void> | null = null;

function ensureSchemaOnce(): Promise<void> {
  if (!schemaReady) schemaReady = ensureSchema();
  return schemaReady;
}

export function recordAudit(entry: Omit<AuditEntry, "at">): void {
  const full: AuditEntry = { at: new Date().toISOString(), ...entry };
  const db = getDb();
  if (db) {
    // Auditing is best-effort; never fail the action it records.
    const op = ensureSchemaOnce()
      .then(() =>
        db
          .prepare(
            "INSERT INTO audit (at, actor, action, project, detail, outcome) VALUES (?, ?, ?, ?, ?, ?)"
          )
          .bind(
            full.at,
            full.actor,
            full.action,
            full.project,
            full.detail,
            full.outcome
          )
          .run()
      )
      .catch(() => {
        // ignore audit failures
      });
    try {
      getCloudflareContext().ctx.waitUntil(op);
    } catch {
      void op;
    }
  } else {
    memoryAudit.push(full);
    if (memoryAudit.length > AUDIT_CAP) memoryAudit.splice(0, memoryAudit.length - AUDIT_CAP);
  }
}

export async function listAudits(limit = 100): Promise<AuditEntry[]> {
  const db = getDb();
  if (db) {
    await ensureSchemaOnce();
    const { results } = await db
      .prepare(
        "SELECT at, actor, action, project, detail, outcome FROM audit ORDER BY at DESC LIMIT ?"
      )
      .bind(limit)
      .all<AuditEntry>();
    return results;
  }
  return memoryAudit.slice(-limit).reverse();
}
