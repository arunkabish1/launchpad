import { parse as parseToml, stringify as stringifyToml } from "smol-toml";
import { Octokit } from "@octokit/rest";
import { getUser } from "./github";
import type { ScaffoldedFile } from "./scaffold";
import type { Binding, BindingResource, BindingType } from "./types";

const CF_API_BASE = "https://api.cloudflare.com/client/v4";

function cfHeaders(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}

async function cfResult<T>(
  path: string,
  token: string,
  init?: RequestInit
): Promise<T> {
  const res = await fetch(`${CF_API_BASE}${path}`, { ...init, headers: cfHeaders(token) });
  const body = (await res.json().catch(() => null)) as {
    success?: boolean;
    result?: T;
    errors?: Array<{ message?: string }>;
  } | null;
  if (!res.ok || !body?.success) {
    const detail = body?.errors?.map((e) => e.message).join(", ") || `HTTP ${res.status}`;
    throw new Error(`Cloudflare API error: ${detail}`);
  }
  return body.result as T;
}

export async function listKvNamespaces(
  token: string,
  accountId: string
): Promise<BindingResource[]> {
  const result = await cfResult<Array<{ id: string; title: string }>>(
    `/accounts/${accountId}/storage/kv/namespaces?per_page=100&page=1`,
    token
  );
  return result.map((r) => ({ type: "kv", name: r.title, id: r.id }));
}

export async function createKvNamespace(
  token: string,
  accountId: string,
  title: string
): Promise<{ id: string }> {
  return cfResult<{ id: string }>(
    `/accounts/${accountId}/storage/kv/namespaces`,
    token,
    { method: "POST", body: JSON.stringify({ title }) }
  );
}

export async function listD1Databases(
  token: string,
  accountId: string
): Promise<BindingResource[]> {
  const result = await cfResult<Array<{ uuid: string; name: string }>>(
    `/accounts/${accountId}/d1/database?per_page=100`,
    token
  );
  return result.map((r) => ({ type: "d1", name: r.name, id: r.uuid }));
}

export async function createD1Database(
  token: string,
  accountId: string,
  name: string
): Promise<{ uuid: string; name: string }> {
  const location = process.env.LAUNCHPAD_D1_LOCATION?.trim() || "WEUR";
  return cfResult<{ uuid: string; name: string }>(
    `/accounts/${accountId}/d1/database`,
    token,
    { method: "POST", body: JSON.stringify({ name, primary_location: location }) }
  );
}

export async function listR2Buckets(
  token: string,
  accountId: string
): Promise<BindingResource[]> {
  const result = await cfResult<Array<{ name: string }>>(
    `/accounts/${accountId}/r2/buckets?per_page=100&page=1`,
    token
  );
  return result.map((r) => ({ type: "r2", name: r.name, id: r.name }));
}

export async function createR2Bucket(
  token: string,
  accountId: string,
  name: string
): Promise<{ name: string }> {
  return cfResult<{ name: string }>(
    `/accounts/${accountId}/r2/buckets`,
    token,
    { method: "POST", body: JSON.stringify({ name }) }
  );
}

export async function listTurnstileWidgets(
  token: string,
  accountId: string
): Promise<BindingResource[]> {
  const result = await cfResult<Array<{ sitekey: string; name?: string }>>(
    `/accounts/${accountId}/challenges/widgets?per_page=100&page=1`,
    token
  );
  return result.map((r) => ({ type: "turnstile", name: r.name ?? r.sitekey, id: r.sitekey }));
}

export async function getTurnstileSecret(
  token: string,
  accountId: string,
  sitekey: string
): Promise<string> {
  const result = await cfResult<{ secret: string }>(
    `/accounts/${accountId}/challenges/widgets/${encodeURIComponent(sitekey)}`,
    token
  );
  return result.secret;
}

export async function createTurnstileWidget(
  token: string,
  accountId: string,
  name: string,
  domains: string[]
): Promise<{ sitekey: string; secret: string }> {
  const result = await cfResult<{ sitekey: string; secret: string }>(
    `/accounts/${accountId}/challenges/widgets`,
    token,
    { method: "POST", body: JSON.stringify({ name, mode: "managed", domains }) }
  );
  return { sitekey: result.sitekey, secret: result.secret };
}

export async function deleteTurnstileWidget(
  token: string,
  accountId: string,
  sitekey: string
): Promise<void> {
  await cfResult<unknown>(
    `/accounts/${accountId}/challenges/widgets/${encodeURIComponent(sitekey)}`,
    token,
    { method: "DELETE" }
  );
}

export async function listAiSearchInstances(
  token: string,
  accountId: string
): Promise<BindingResource[]> {
  const result = await cfResult<Array<{ id: string }>>(
    `/accounts/${accountId}/ai-search/instances?per_page=100&page=1`,
    token
  );
  return result.map((r) => ({ type: "ai_search", name: r.id, id: r.id }));
}

export async function createAiSearchInstance(
  token: string,
  accountId: string,
  id: string
): Promise<{ id: string }> {
  return cfResult<{ id: string }>(
    `/accounts/${accountId}/ai-search/instances`,
    token,
    { method: "POST", body: JSON.stringify({ id }) }
  );
}

export async function deleteAiSearchInstance(
  token: string,
  accountId: string,
  id: string
): Promise<void> {
  await cfResult<unknown>(
    `/accounts/${accountId}/ai-search/instances/${encodeURIComponent(id)}`,
    token,
    { method: "DELETE" }
  );
}

export async function ensureAiSearch(
  token: string,
  accountId: string,
  id: string
): Promise<BindingResource> {
  const found = (await listAiSearchInstances(token, accountId)).find((r) => r.name === id);
  if (found) return found;
  const created = await createAiSearchInstance(token, accountId, id);
  return { type: "ai_search", name: created.id, id: created.id };
}

export async function ensureResource(
  type: BindingType,
  name: string,
  token: string,
  accountId: string
): Promise<BindingResource> {
  if (type === "kv") {
    const found = (await listKvNamespaces(token, accountId)).find((r) => r.name === name);
    if (found) return found;
    const created = await createKvNamespace(token, accountId, name);
    return { type, name, id: created.id };
  }
  if (type === "d1") {
    const found = (await listD1Databases(token, accountId)).find((r) => r.name === name);
    if (found) return found;
    const created = await createD1Database(token, accountId, name);
    return { type, name, id: created.uuid };
  }
  const found = (await listR2Buckets(token, accountId)).find((r) => r.name === name);
  if (found) return found;
  await createR2Bucket(token, accountId, name);
  return { type, name, id: name };
}

const BINDING_NAME_REGEX = /^[A-Za-z_][A-Za-z0-9_]*$/;
const RESOURCE_NAME_REGEX = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;
const AI_SEARCH_ID_REGEX = /^[a-z0-9](?:[a-z0-9_-]*[a-z0-9])?$/;

export function validateBindingName(name: string | undefined): string | null {
  const trimmed = (name ?? "").trim();
  if (!trimmed) return "Binding name is required.";
  if (!BINDING_NAME_REGEX.test(trimmed)) {
    return "Binding name must match [A-Za-z_][A-Za-z0-9_]*.";
  }
  return null;
}

export function validateResourceName(type: BindingType, name: string | undefined): string | null {
  const trimmed = (name ?? "").trim();
  if (!trimmed) return "Resource name is required.";
  if (type === "turnstile") {
    if (!/^[A-Za-z0-9 _-]+$/.test(trimmed)) {
      return "Turnstile site names may only contain letters, numbers, spaces, hyphens, and underscores.";
    }
    if (trimmed.length > 64) return "Turnstile site names must be 64 characters or fewer.";
    return null;
  }
  if (type === "kv") {
    if (trimmed.length > 100) return "KV namespace titles must be 100 characters or fewer.";
    return null;
  }
  if (!RESOURCE_NAME_REGEX.test(trimmed)) {
    return "Resource names may only contain lowercase letters, numbers, and hyphens.";
  }
  if (type === "r2" && (trimmed.length < 3 || trimmed.length > 63)) {
    return "R2 bucket names must be 3-63 characters.";
  }
  if (type === "d1" && trimmed.length > 32) {
    return "D1 database names must be 32 characters or fewer.";
  }
  if (type === "ai_search") {
    if (!AI_SEARCH_ID_REGEX.test(trimmed)) {
      return "AI Search instance IDs may only contain lowercase letters, numbers, hyphens, and underscores.";
    }
    if (trimmed.length > 63) return "AI Search instance IDs must be 63 characters or fewer.";
  }
  return null;
}

export type WranglerKind = "toml" | "json";

export interface WranglerConfigRef {
  path: string;
  kind: WranglerKind;
}

export function findScaffoldWrangler(files: ScaffoldedFile[]): WranglerConfigRef | null {
  const candidates = ["wrangler.toml", "wrangler.jsonc", "wrangler.json"];
  for (const c of candidates) {
    if (files.some((f) => f.path === c)) {
      return { path: c, kind: c.endsWith(".toml") ? "toml" : "json" };
    }
  }
  return null;
}

export async function findWranglerConfig(
  client: Octokit,
  owner: string,
  repo: string
): Promise<WranglerConfigRef | null> {
  const { data } = await client.rest.repos.getContent({ owner, repo, path: "" });
  const entries = Array.isArray(data) ? data : [];
  const candidates = ["wrangler.toml", "wrangler.jsonc", "wrangler.json"];
  for (const c of candidates) {
    if (entries.some((e) => e.type === "file" && e.name === c)) {
      return { path: c, kind: c.endsWith(".toml") ? "toml" : "json" };
    }
  }
  return null;
}

export interface WranglerConfigContent {
  text: string;
  sha: string;
}

export async function readRepoWrangler(
  client: Octokit,
  owner: string,
  repo: string,
  ref: WranglerConfigRef
): Promise<WranglerConfigContent> {
  const res = await client.rest.repos.getContent({ owner, repo, path: ref.path });
  const data = res.data as {
    sha?: string;
    content?: string;
    encoding?: string;
  };
  const text =
    data.content && data.encoding === "base64"
      ? Buffer.from(data.content, "base64").toString("utf8")
      : "";
  return { text, sha: data.sha ?? "" };
}

function stripJsoncComments(text: string): string {
  let out = "";
  let inString = false;
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    const next = text[i + 1];
    if (inString) {
      out += ch;
      if (ch === "\\" && next !== undefined) {
        out += next;
        i += 2;
        continue;
      }
      if (ch === '"') inString = false;
      i += 1;
      continue;
    }
    if (ch === '"') {
      inString = true;
      out += ch;
      i += 1;
      continue;
    }
    if (ch === "/" && next === "/") {
      while (i < text.length && text[i] !== "\n") i += 1;
      continue;
    }
    if (ch === "/" && next === "*") {
      i += 2;
      while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) i += 1;
      i += 2;
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
}

function parseJsonc(text: string): Record<string, unknown> {
  return JSON.parse(stripJsoncComments(text)) as Record<string, unknown>;
}

export function parseBindings(text: string, kind: WranglerKind): Binding[] {
  const cfg = kind === "toml" ? (parseToml(text) as Record<string, unknown>) : parseJsonc(text);
  const bindings: Binding[] = [];

  const kv = (cfg.kv_namespaces as Array<{ binding?: string; id?: string }> | undefined) ?? [];
  for (const b of kv) {
    if (b?.binding) bindings.push({ type: "kv", name: b.binding, resource: b.id ?? "", id: b.id });
  }

  const d1 =
    (cfg.d1_databases as
      | Array<{ binding?: string; database_name?: string; database_id?: string }>
      | undefined) ?? [];
  for (const b of d1) {
    if (b?.binding) {
      bindings.push({
        type: "d1",
        name: b.binding,
        resource: b.database_name ?? b.database_id ?? "",
        id: b.database_id,
      });
    }
  }

  const r2 = (cfg.r2_buckets as Array<{ binding?: string; bucket_name?: string }> | undefined) ?? [];
  for (const b of r2) {
    if (b?.binding) {
      bindings.push({ type: "r2", name: b.binding, resource: b.bucket_name ?? "", id: b.bucket_name });
    }
  }

  const ai = (cfg.ai_search as Array<{ binding?: string; instance_name?: string }> | undefined) ?? [];
  for (const b of ai) {
    if (b?.binding) {
      bindings.push({
        type: "ai_search",
        name: b.binding,
        resource: b.instance_name ?? "",
        id: b.instance_name,
      });
    }
  }

  return bindings;
}

export function renderBindings(
  text: string,
  kind: WranglerKind,
  bindings: Binding[]
): string {
  const kv = bindings
    .filter((b) => b.type === "kv")
    .map((b) => ({ binding: b.name, id: b.id ?? b.resource }));
  const d1 = bindings
    .filter((b) => b.type === "d1")
    .map((b) => ({
      binding: b.name,
      database_name: b.resource,
      database_id: b.id ?? b.resource,
    }));
  const r2 = bindings
    .filter((b) => b.type === "r2")
    .map((b) => ({ binding: b.name, bucket_name: b.resource }));
  const ai = bindings
    .filter((b) => b.type === "ai_search")
    .map((b) => ({ binding: b.name, instance_name: b.resource }));

  if (kind === "toml") {
    const cfg = parseToml(text) as Record<string, unknown>;
    if (kv.length) cfg.kv_namespaces = kv;
    else delete cfg.kv_namespaces;
    if (d1.length) cfg.d1_databases = d1;
    else delete cfg.d1_databases;
    if (r2.length) cfg.r2_buckets = r2;
    else delete cfg.r2_buckets;
    if (ai.length) cfg.ai_search = ai;
    else delete cfg.ai_search;
    return stringifyToml(cfg);
  }

  const cfg = parseJsonc(text);
  if (kv.length) cfg.kv_namespaces = kv;
  else delete cfg.kv_namespaces;
  if (d1.length) cfg.d1_databases = d1;
  else delete cfg.d1_databases;
  if (r2.length) cfg.r2_buckets = r2;
  else delete cfg.r2_buckets;
  if (ai.length) cfg.ai_search = ai;
  else delete cfg.ai_search;
  return JSON.stringify(cfg, null, 2);
}

export async function updateRepoWrangler(
  client: Octokit,
  owner: string,
  repo: string,
  ref: WranglerConfigRef,
  content: string,
  sha: string
): Promise<void> {
  const author = await getUser(client);
  await client.rest.repos.createOrUpdateFileContents({
    owner,
    repo,
    path: ref.path,
    message: "Update Cloudflare bindings via Launchpad",
    content: Buffer.from(content, "utf8").toString("base64"),
    sha,
    branch: "main",
    author: { name: author.name, email: author.email },
    committer: { name: author.name, email: author.email },
  });
}
