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
    aws: {
      accessKeyEnv: "AWS_ACCESS_KEY_ID",
      secretKeyEnv: "AWS_SECRET_ACCESS_KEY",
      defaultRegion: "us-east-1",
    },
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
    aws: {
      accessKeyEnv: override?.aws?.accessKeyEnv || base.aws.accessKeyEnv,
      secretKeyEnv: override?.aws?.secretKeyEnv || base.aws.secretKeyEnv,
      defaultRegion: override?.aws?.defaultRegion || base.aws.defaultRegion,
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

export async function getAwsCredentialEnvVars(): Promise<{ accessKeyEnv: string; secretKeyEnv: string }> {
  const config = await getConfig();
  return {
    accessKeyEnv: config.aws.accessKeyEnv || "AWS_ACCESS_KEY_ID",
    secretKeyEnv: config.aws.secretKeyEnv || "AWS_SECRET_ACCESS_KEY",
  };
}

export async function getDefaultAwsRegion(): Promise<string> {
  const config = await getConfig();
  return config.aws.defaultRegion || "us-east-1";
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
    awsAccessKeySet: Boolean((process.env[config.aws.accessKeyEnv] ?? "").trim()),
    awsSecretKeySet: Boolean((process.env[config.aws.secretKeyEnv] ?? "").trim()),
    awsRegion: config.aws.defaultRegion || "us-east-1",
  };
}
