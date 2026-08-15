import { getDb, ensureSchema } from "./db";
import type { ConfigStatus, LaunchpadConfig } from "./types";

let cached: LaunchpadConfig | null = null;
let schemaReady: Promise<void> | null = null;

function ensureSchemaOnce(): Promise<void> {
  if (!schemaReady) schemaReady = ensureSchema();
  return schemaReady;
}

function defaultConfig(): LaunchpadConfig {
  return {
    cloudflare: { defaultAccountId: "" },
    github: { patEnvVar: "GITHUB_PAT", org: "" },
  };
}

async function loadConfigOverride(): Promise<Partial<LaunchpadConfig> | null> {
  const db = getDb();
  if (!db) return null;
  await ensureSchemaOnce();
  const row = await db
    .prepare("SELECT value FROM launchpad_config WHERE key = ?")
    .bind("config")
    .first<{ value: string }>();
  if (!row) return null;
  try {
    return JSON.parse(row.value) as Partial<LaunchpadConfig>;
  } catch {
    return null;
  }
}

export async function getConfig(): Promise<LaunchpadConfig> {
  if (cached) return cached;
  const override = await loadConfigOverride();
  const base = defaultConfig();
  cached = {
    cloudflare: {
      defaultAccountId:
        override?.cloudflare?.defaultAccountId ?? base.cloudflare.defaultAccountId,
    },
    github: {
      patEnvVar: override?.github?.patEnvVar || base.github.patEnvVar,
      org: override?.github?.org ?? base.github.org,
    },
  };
  return cached;
}

export async function saveConfig(config: LaunchpadConfig): Promise<void> {
  cached = config;
  const db = getDb();
  if (!db) return;
  await ensureSchemaOnce();
  await db
    .prepare(
      "INSERT OR REPLACE INTO launchpad_config (key, value) VALUES ('config', ?)"
    )
    .bind(JSON.stringify(config))
    .run();
}

export async function getEnvPat(): Promise<string | null> {
  const config = await getConfig();
  const envVar = config.github.patEnvVar || "GITHUB_PAT";
  return process.env[envVar] || null;
}

export async function getDefaultAccountId(): Promise<string> {
  const config = await getConfig();
  return config.cloudflare.defaultAccountId || process.env.CLOUDFLARE_ACCOUNT_ID || "";
}

export async function getOrgName(): Promise<string> {
  const config = await getConfig();
  return config.github.org.trim() || "";
}

export async function getConfigStatus(): Promise<ConfigStatus> {
  const config = await getConfig();
  const pat = await getEnvPat();
  const accountId = await getDefaultAccountId();
  return {
    adminPasswordSet: Boolean(process.env.LAUNCHPAD_ADMIN_PASSWORD),
    patEnvSet: Boolean(pat),
    cloudflareTokenSet: Boolean(process.env.CLOUDFLARE_API_TOKEN),
    defaultAccountId: accountId,
    secretKeySet: Boolean(process.env.LAUNCHPAD_SECRET || process.env.LAUNCHPAD_SESSION_SECRET),
    org: config.github.org,
  };
}
