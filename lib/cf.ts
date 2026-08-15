import type { DeployTarget, EnvVar, Project } from "./types";

const CF_API_BASE = "https://api.cloudflare.com/client/v4";

function cfHeaders(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}

export function getCloudflareToken(): string {
  return process.env.CLOUDFLARE_API_TOKEN?.trim() || "";
}

export async function getWorkersSubdomain(
  token: string,
  accountId: string
): Promise<string> {
  const res = await fetch(`${CF_API_BASE}/accounts/${accountId}/workers/subdomain`, {
    headers: cfHeaders(token),
  });
  if (!res.ok) {
    throw new Error(`Cloudflare API returned ${res.status}`);
  }
  const data = (await res.json()) as { success: boolean; result?: { subdomain?: string } };
  if (!data.success || !data.result?.subdomain) {
    throw new Error("Cloudflare API did not return a workers.dev subdomain.");
  }
  return data.result.subdomain;
}

export async function deleteCloudflareProject(
  type: DeployTarget,
  name: string,
  token: string,
  accountId: string
): Promise<void> {
  const url =
    type === "pages"
      ? `${CF_API_BASE}/accounts/${accountId}/pages/projects/${name}`
      : `${CF_API_BASE}/accounts/${accountId}/workers/scripts/${name}`;
  const res = await fetch(url, { method: "DELETE", headers: cfHeaders(token) });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { errors?: Array<{ message?: string }> } | null;
    const detail = body?.errors?.map((e) => e.message).join(", ") || `HTTP ${res.status}`;
    throw new Error(`Failed to delete Cloudflare project "${name}": ${detail}`);
  }
}

export async function listEnvVars(
  type: DeployTarget,
  name: string,
  token: string,
  accountId: string
): Promise<EnvVar[]> {
  const url =
    type === "pages"
      ? `${CF_API_BASE}/accounts/${accountId}/pages/projects/${name}`
      : `${CF_API_BASE}/accounts/${accountId}/workers/scripts/${name}/secrets`;
  const res = await fetch(url, { headers: cfHeaders(token) });
  const body = (await res.json().catch(() => null)) as {
    success?: boolean;
    errors?: Array<{ message?: string }>;
    result?:
      | Array<{ name: string; type?: string }>
      | { secrets?: Array<{ name: string; type?: string }> }
      | { deployment_configs?: { production?: { env_vars?: Record<string, { type?: string }> } } };
  } | null;
  if (!res.ok || !body?.success) {
    const detail = body?.errors?.map((e) => e.message).join(", ") || `HTTP ${res.status}`;
    throw new Error(`Failed to list env vars for "${name}": ${detail}`);
  }
  const result = body.result;
  if (type === "pages" && result && typeof result === "object" && "deployment_configs" in result) {
    const vars = result.deployment_configs?.production?.env_vars ?? {};
    return Object.entries(vars).map(([key, v]) => ({
      key,
      kind: v.type === "secret_text" || v.type === "secret" ? "secret" : "text",
    }));
  }
  const secrets = Array.isArray(result)
    ? result
    : result && typeof result === "object" && "secrets" in result
      ? result.secrets ?? []
      : [];
  return secrets.map((s) => ({ key: s.name, kind: "secret" }));
}

export async function setEnvVar(
  type: DeployTarget,
  name: string,
  key: string,
  value: string,
  isSecret: boolean,
  token: string,
  accountId: string
): Promise<void> {
  if (type === "pages") {
    const res = await fetch(`${CF_API_BASE}/accounts/${accountId}/pages/projects/${name}`, {
      method: "PATCH",
      headers: cfHeaders(token),
      body: JSON.stringify({
        deployment_configs: {
          production: {
            env_vars: {
              [key]: isSecret ? { type: "secret_text", value } : { value },
            },
          },
        },
      }),
    });
    if (!res.ok) {
      throw new Error(`Failed to set env var "${key}" on "${name}": HTTP ${res.status}`);
    }
  } else {
    const res = await fetch(
      `${CF_API_BASE}/accounts/${accountId}/workers/scripts/${name}/secrets`,
      {
        method: "PUT",
        headers: cfHeaders(token),
        body: JSON.stringify({ name: key, text: value, type: "secret_text" }),
      }
    );
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { errors?: Array<{ message?: string }> } | null;
      const detail = body?.errors?.map((e) => e.message).join(", ") || `HTTP ${res.status}`;
      throw new Error(`Failed to set secret "${key}" on "${name}": ${detail}`);
    }
  }
}

export async function deleteEnvVar(
  type: DeployTarget,
  name: string,
  key: string,
  token: string,
  accountId: string
): Promise<void> {
  if (type === "pages") {
    const res = await fetch(`${CF_API_BASE}/accounts/${accountId}/pages/projects/${name}`, {
      method: "PATCH",
      headers: cfHeaders(token),
      body: JSON.stringify({
        deployment_configs: { production: { env_vars: { [key]: null } } },
      }),
    });
    if (!res.ok) {
      throw new Error(`Failed to delete env var "${key}" from "${name}": HTTP ${res.status}`);
    }
  } else {
    const res = await fetch(
      `${CF_API_BASE}/accounts/${accountId}/workers/scripts/${name}/secrets/${encodeURIComponent(key)}`,
      { method: "DELETE", headers: cfHeaders(token) }
    );
    if (!res.ok) {
      throw new Error(`Failed to delete secret "${key}" from "${name}": HTTP ${res.status}`);
    }
  }
}

export function buildLiveUrl(
  type: DeployTarget,
  name: string,
  subdomain: string | null | undefined
): string | null {
  if (type === "pages") return `https://${name}.pages.dev`;
  if (subdomain) return `https://${name}.${subdomain}.workers.dev`;
  return null;
}

const configuredSubdomain = (): string | null => process.env.CLOUDFLARE_WORKERS_SUBDOMAIN?.trim() || null;

export function deriveLiveUrl(project: Pick<Project, "name" | "type" | "liveUrl">): string | null {
  if (project.liveUrl) return project.liveUrl;
  return buildLiveUrl(project.type, project.name, configuredSubdomain());
}
