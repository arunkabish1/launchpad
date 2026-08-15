#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import { spawn } from "node:child_process";

const CF_API_BASE = "https://api.cloudflare.com/client/v4";
const ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID || "";
const API_TOKEN = process.env.CLOUDFLARE_API_TOKEN || "";

function log(msg) {
  console.log("[preview] " + msg);
}
function fail(msg) {
  console.error("[preview] " + msg);
  process.exit(1);
}

function requireCredentials() {
  if (!ACCOUNT_ID || !API_TOKEN) {
    fail("CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN must be set in the workflow.");
  }
}

async function cfJson(apiPath, options) {
  const method = (options && options.method) || "GET";
  const body = options && options.body;
  const res = await fetch(CF_API_BASE + apiPath, {
    method,
    headers: {
      Authorization: "Bearer " + API_TOKEN,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try {
    data = await res.json();
  } catch (err) {
    // non-JSON body
  }
  return { ok: res.ok, status: res.status, data };
}

function apiDetail(data, status) {
  if (data && Array.isArray(data.errors) && data.errors.length > 0) {
    return data.errors.map(function (e) { return e.message; }).join(", ");
  }
  return "HTTP " + status;
}

function sanitizeBranch(branch) {
  let s = String(branch || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!s) s = "branch";
  if (s.length > 40) s = s.slice(0, 40).replace(/-+$/g, "");
  return s;
}

function computePreviewName(projectName, branch) {
  let name = projectName + "-" + sanitizeBranch(branch);
  if (name.length > 63) name = name.slice(0, 63).replace(/-+$/g, "");
  return name;
}

function branchFromEnv() {
  const eventName = process.env.GITHUB_EVENT_NAME || "";
  if (eventName === "pull_request") {
    return process.env.GITHUB_HEAD_REF || process.env.GITHUB_REF_NAME || "";
  }
  if (eventName === "delete") {
    try {
      const payload = JSON.parse(
        fs.readFileSync(process.env.GITHUB_EVENT_PATH || "/dev/null", "utf8")
      );
      if (payload.ref) return payload.ref;
    } catch {
      // fall through to the generic ref below
    }
  }
  return process.env.GITHUB_REF_NAME || "";
}

function findConfig() {
  for (const name of ["wrangler.toml", "wrangler.jsonc", "wrangler.json"]) {
    if (fs.existsSync(name)) {
      return { file: name, kind: name.endsWith(".toml") ? "toml" : "json" };
    }
  }
  return null;
}

function replaceAll(input, from, to) {
  return input.split(from).join(to);
}

function parseTomlBindings(text) {
  const bindings = [];
  let block = null;
  const lines = text.split("\n");
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    if (line.startsWith("[[") && line.endsWith("]]")) {
      const section = line.slice(2, -2).trim();
      if (
        section === "kv_namespaces" ||
        section === "d1_databases" ||
        section === "r2_buckets" ||
        section === "ai_search"
      ) {
        block = { type: section };
        bindings.push(block);
      } else {
        block = null;
      }
      continue;
    }
    if (line.startsWith("[") && line.endsWith("]")) {
      block = null;
      continue;
    }
    const eq = line.indexOf("=");
    if (eq === -1 || !block) continue;
    const key = line.slice(0, eq).trim();
    const rawValue = line.slice(eq + 1).trim();
    if (/^"[^"]*"$/.test(rawValue)) {
      try {
        block[key] = JSON.parse(rawValue);
      } catch (err) {
        block[key] = rawValue;
      }
    } else {
      block[key] = rawValue;
    }
  }
  return bindings;
}

function parseJsonBindings(parsed) {
  const bindings = [];
  for (const b of parsed.kv_namespaces || []) {
    if (b && b.binding) bindings.push({ type: "kv_namespaces", ...b });
  }
  for (const b of parsed.d1_databases || []) {
    if (b && b.binding) bindings.push({ type: "d1_databases", ...b });
  }
  for (const b of parsed.r2_buckets || []) {
    if (b && b.binding) bindings.push({ type: "r2_buckets", ...b });
  }
  for (const b of parsed.ai_search || []) {
    if (b && b.binding) bindings.push({ type: "ai_search", ...b });
  }
  return bindings;
}

function rewriteConfig(text, kind, preview, bindings, resources) {
  if (kind === "json") {
    const cfg = JSON.parse(text);
    cfg.name = preview;
    cfg.kv_namespaces = (cfg.kv_namespaces || []).map(function (b) {
      return { ...b, id: resources.kv ? resources.kv.id : b.id };
    });
    cfg.d1_databases = (cfg.d1_databases || []).map(function (b) {
      return {
        ...b,
        database_name: resources.d1 ? resources.d1.name : b.database_name,
        database_id: resources.d1 ? resources.d1.id : b.database_id,
      };
    });
    cfg.r2_buckets = (cfg.r2_buckets || []).map(function (b) {
      return { ...b, bucket_name: resources.r2 ? resources.r2.name : b.bucket_name };
    });
    cfg.ai_search = (cfg.ai_search || []).map(function (b) {
      return {
        ...b,
        instance_name: resources.ai_search ? resources.ai_search.id : b.instance_name,
      };
    });
    return JSON.stringify(cfg, null, 2);
  }

  let out = text.replace(/^name\s*=\s*"[^"]*"/m, 'name = "' + preview + '"');
  for (const b of bindings) {
    if (b.type === "kv_namespaces" && b.id && resources.kv) {
      out = replaceAll(out, 'id = "' + b.id + '"', 'id = "' + resources.kv.id + '"');
    }
    if (b.type === "d1_databases" && resources.d1) {
      if (b.database_id) {
        out = replaceAll(
          out,
          'database_id = "' + b.database_id + '"',
          'database_id = "' + resources.d1.id + '"'
        );
      }
      if (b.database_name) {
        out = replaceAll(
          out,
          'database_name = "' + b.database_name + '"',
          'database_name = "' + resources.d1.name + '"'
        );
      }
    }
    if (b.type === "r2_buckets" && b.bucket_name && resources.r2) {
      out = replaceAll(
        out,
        'bucket_name = "' + b.bucket_name + '"',
        'bucket_name = "' + resources.r2.name + '"'
      );
    }
    if (b.type === "ai_search" && b.instance_name && resources.ai_search) {
      out = replaceAll(
        out,
        'instance_name = "' + b.instance_name + '"',
        'instance_name = "' + resources.ai_search.id + '"'
      );
    }
  }
  return out;
}

async function ensureKv(name) {
  const list = await cfJson("/accounts/" + ACCOUNT_ID + "/storage/kv/namespaces?per_page=100");
  if (!list.ok) fail("Failed to list KV namespaces: " + apiDetail(list.data, list.status));
  const found = list.data.result.find(function (r) { return r.title === name; });
  if (found) return found.id;
  const created = await cfJson("/accounts/" + ACCOUNT_ID + "/storage/kv/namespaces", {
    method: "POST",
    body: { title: name },
  });
  if (!created.ok) {
    fail("Failed to create KV namespace " + name + ": " + apiDetail(created.data, created.status));
  }
  return created.data.result.id;
}

async function ensureD1(name) {
  const list = await cfJson("/accounts/" + ACCOUNT_ID + "/d1/database?per_page=100");
  if (!list.ok) fail("Failed to list D1 databases: " + apiDetail(list.data, list.status));
  const found = list.data.result.find(function (r) { return r.name === name; });
  if (found) return found.uuid;
  const created = await cfJson("/accounts/" + ACCOUNT_ID + "/d1/database", {
    method: "POST",
    body: { name, primary_location: process.env.LAUNCHPAD_D1_LOCATION || "WEUR" },
  });
  if (!created.ok) {
    fail("Failed to create D1 database " + name + ": " + apiDetail(created.data, created.status));
  }
  return created.data.result.uuid;
}

async function ensureR2(name) {
  const list = await cfJson("/accounts/" + ACCOUNT_ID + "/r2/buckets?per_page=100");
  if (!list.ok) fail("Failed to list R2 buckets: " + apiDetail(list.data, list.status));
  const found = list.data.result.find(function (r) { return r.name === name; });
  if (found) return name;
  const created = await cfJson("/accounts/" + ACCOUNT_ID + "/r2/buckets", {
    method: "POST",
    body: { name },
  });
  if (!created.ok) {
    fail("Failed to create R2 bucket " + name + ": " + apiDetail(created.data, created.status));
  }
  return name;
}

async function ensureAiSearch(id) {
  const list = await cfJson("/accounts/" + ACCOUNT_ID + "/ai-search/instances?per_page=100&page=1");
  if (!list.ok) {
    fail("Failed to list AI Search instances: " + apiDetail(list.data, list.status));
  }
  const found = list.data.result.find(function (r) { return r.id === id; });
  if (found) return id;
  const created = await cfJson("/accounts/" + ACCOUNT_ID + "/ai-search/instances", {
    method: "POST",
    body: { id },
  });
  if (!created.ok) {
    fail("Failed to create AI Search instance " + id + ": " + apiDetail(created.data, created.status));
  }
  return created.data.result.id;
}

function turnstilePairs(values) {
  const pairs = [];
  for (const key of Object.keys(values)) {
    if (key.endsWith("_SECRET_KEY")) {
      const prefix = key.slice(0, -"_SECRET_KEY".length);
      if (values[prefix + "_SITE_KEY"] !== undefined) pairs.push(prefix);
    }
  }
  return pairs;
}

function widgetNameFor(preview, prefix) {
  let name = preview + "-" + prefix;
  if (name.length > 64) name = name.slice(0, 64).replace(/-+$/g, "");
  return name;
}

async function getWorkersSubdomain() {
  const sub = await cfJson("/accounts/" + ACCOUNT_ID + "/workers/subdomain");
  if (sub.ok && sub.data && sub.data.result && sub.data.result.subdomain) {
    return sub.data.result.subdomain;
  }
  return null;
}

async function ensureTurnstileWidget(name, domains) {
  const list = await cfJson(
    "/accounts/" + ACCOUNT_ID + "/challenges/widgets?per_page=100&page=1"
  );
  if (!list.ok) {
    fail("Failed to list Turnstile widgets: " + apiDetail(list.data, list.status));
  }
  const found = list.data.result.find(function (w) { return w.name === name; });
  if (found) {
    const detail = await cfJson(
      "/accounts/" + ACCOUNT_ID + "/challenges/widgets/" + encodeURIComponent(found.sitekey)
    );
    if (!detail.ok) {
      fail("Failed to read Turnstile widget " + name + ": " + apiDetail(detail.data, detail.status));
    }
    return { sitekey: found.sitekey, secret: detail.data.result.secret };
  }
  const created = await cfJson("/accounts/" + ACCOUNT_ID + "/challenges/widgets", {
    method: "POST",
    body: { name, mode: "managed", domains },
  });
  if (!created.ok) {
    fail("Failed to create Turnstile widget " + name + ": " + apiDetail(created.data, created.status));
  }
  return { sitekey: created.data.result.sitekey, secret: created.data.result.secret };
}

function loadEnvValues() {
  if (!process.env.LP_ENV_MASTER_KEY) return {};
  const file = ".launchpad/env-values.enc";
  if (!fs.existsSync(file)) return {};
  const key = crypto.createHash("sha256").update(process.env.LP_ENV_MASTER_KEY).digest();
  const payload = fs.readFileSync(file, "utf8").trim();
  const parts = payload.split(".");
  if (parts.length !== 3) {
    log("env-values.enc is malformed; skipping preview env vars.");
    return {};
  }
  try {
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(parts[0], "base64"));
    decipher.setAuthTag(Buffer.from(parts[1], "base64"));
    const plain = Buffer.concat([
      decipher.update(Buffer.from(parts[2], "base64")),
      decipher.final(),
    ]).toString("utf8");
    return JSON.parse(plain);
  } catch (err) {
    log("Failed to decrypt env-values.enc (" + err.message + "); skipping preview env vars.");
    return {};
  }
}

async function applyEnv(preview) {
  const values = loadEnvValues();
  const prefixes = turnstilePairs(values);
  if (prefixes.length > 0) {
    const subdomain = await getWorkersSubdomain();
    const host = subdomain ? preview + "." + subdomain + ".workers.dev" : null;
    for (const prefix of prefixes) {
      if (!host) {
        log("No workers.dev subdomain available; skipping per-branch Turnstile widget for " + prefix + ".");
        continue;
      }
      const widgetName = widgetNameFor(preview, prefix);
      const widget = await ensureTurnstileWidget(widgetName, [host]);
      values[prefix + "_SITE_KEY"] = widget.sitekey;
      values[prefix + "_SECRET_KEY"] = widget.secret;
      log("Provisioned Turnstile widget " + widgetName + " for " + host);
    }
  }

  const keys = Object.keys(values);
  if (keys.length === 0) {
    log("No preview env vars to apply.");
    return;
  }
  for (const key of keys) {
    const res = await cfJson(
      "/accounts/" + ACCOUNT_ID + "/workers/scripts/" + preview + "/secrets",
      { method: "PUT", body: { name: key, text: values[key], type: "secret_text" } }
    );
    if (!res.ok) {
      fail("Failed to set secret " + key + " on " + preview + ": " + apiDetail(res.data, res.status));
    }
    log("Applied env var " + key + " to " + preview);
  }
}

function runCommand(cmd) {
  return new Promise(function (resolve) {
    const child = spawn(cmd, { shell: true, stdio: "inherit", env: process.env });
    child.on("error", function () {
      resolve(1);
    });
    child.on("close", function (code) {
      resolve(code === null ? 1 : code);
    });
  });
}

async function deploy(preview, configName) {
  const base = process.env.PREVIEW_DEPLOY_CMD || "npx wrangler deploy";
  const code = await runCommand(base + " --config " + configName);
  if (code !== 0) process.exit(code);
  const sub = await cfJson("/accounts/" + ACCOUNT_ID + "/workers/subdomain");
  if (sub.ok && sub.data && sub.data.result && sub.data.result.subdomain) {
    log("Preview URL: https://" + preview + "." + sub.data.result.subdomain + ".workers.dev");
  }
}

async function teardown(preview) {
  const del = await cfJson("/accounts/" + ACCOUNT_ID + "/workers/scripts/" + preview, {
    method: "DELETE",
  });
  if (del.ok || del.status === 404) {
    log("Deleted preview worker " + preview);
  } else {
    log("Failed to delete preview worker " + preview + ": " + apiDetail(del.data, del.status));
  }

  const kvList = await cfJson("/accounts/" + ACCOUNT_ID + "/storage/kv/namespaces?per_page=100");
  if (kvList.ok) {
    for (const r of kvList.data.result || []) {
      if (r.title === preview) {
        const res = await cfJson("/accounts/" + ACCOUNT_ID + "/storage/kv/namespaces/" + r.id, {
          method: "DELETE",
        });
        if (res.ok || res.status === 404) log("Deleted KV namespace " + preview);
        else log("Failed to delete KV namespace " + preview + ": " + apiDetail(res.data, res.status));
      }
    }
  }

  const d1List = await cfJson("/accounts/" + ACCOUNT_ID + "/d1/database?per_page=100");
  if (d1List.ok) {
    for (const r of d1List.data.result || []) {
      if (r.name === preview) {
        const res = await cfJson("/accounts/" + ACCOUNT_ID + "/d1/database/" + r.uuid, {
          method: "DELETE",
        });
        if (res.ok || res.status === 404) log("Deleted D1 database " + preview);
        else log("Failed to delete D1 database " + preview + ": " + apiDetail(res.data, res.status));
      }
    }
  }

  const r2List = await cfJson("/accounts/" + ACCOUNT_ID + "/r2/buckets?per_page=100");
  if (r2List.ok) {
    for (const r of r2List.data.result || []) {
      if (r.name === preview) {
        const res = await cfJson("/accounts/" + ACCOUNT_ID + "/r2/buckets/" + preview, {
          method: "DELETE",
        });
        if (res.ok || res.status === 404) log("Deleted R2 bucket " + preview);
        else log("Failed to delete R2 bucket " + preview + ": " + apiDetail(res.data, res.status));
      }
    }
  }

  const aiDel = await cfJson(
    "/accounts/" + ACCOUNT_ID + "/ai-search/instances/" + encodeURIComponent(preview),
    { method: "DELETE" }
  );
  if (aiDel.ok || aiDel.status === 404) log("Deleted AI Search instance " + preview);
  else log("Failed to delete AI Search instance " + preview + ": " + apiDetail(aiDel.data, aiDel.status));

  const prefixes = turnstilePairs(loadEnvValues());
  if (prefixes.length > 0) {
    const widgetNames = new Set(prefixes.map(function (p) { return widgetNameFor(preview, p); }));
    const widgetList = await cfJson(
      "/accounts/" + ACCOUNT_ID + "/challenges/widgets?per_page=100&page=1"
    );
    if (widgetList.ok) {
      for (const w of widgetList.data.result || []) {
        if (widgetNames.has(w.name)) {
          const res = await cfJson(
            "/accounts/" + ACCOUNT_ID + "/challenges/widgets/" + encodeURIComponent(w.sitekey),
            { method: "DELETE" }
          );
          if (res.ok || res.status === 404) log("Deleted Turnstile widget " + w.name);
          else log("Failed to delete Turnstile widget " + w.name + ": " + apiDetail(res.data, res.status));
        }
      }
    }
  }
}

async function main() {
  const mode = process.argv[2];
  if (mode !== "deploy" && mode !== "teardown") {
    fail('Usage: node .launchpad/preview.mjs <deploy|teardown>');
  }
  requireCredentials();

  const branch = branchFromEnv();
  if (!branch) fail("Could not determine the branch from GitHub Actions environment.");

  const configRef = findConfig();
  if (!configRef) fail("No wrangler config file found in the repo root.");

  const text = fs.readFileSync(configRef.file, "utf8");
  let projectName = "";
  if (configRef.kind === "json") {
    try {
      projectName = (JSON.parse(text).name || "").trim();
    } catch (err) {
      // fall through
    }
  } else {
    const m = text.match(/^name\s*=\s*"([^"]+)"/m);
    if (m) projectName = m[1];
  }
  if (!projectName) {
    projectName = ((process.env.GITHUB_REPOSITORY || "").split("/").pop() || "project").trim();
  }

  const preview = computePreviewName(projectName, branch);
  const configName = configRef.kind === "json" ? "wrangler.preview.json" : "wrangler.preview.toml";
  log("Branch: " + branch + " | Preview worker: " + preview + " | Config: " + configName);

  if (mode === "teardown") {
    await teardown(preview);
    log("Teardown complete for " + preview);
    return;
  }

  let bindings = [];
  if (configRef.kind === "json") {
    try {
      bindings = parseJsonBindings(JSON.parse(text));
    } catch (err) {
      fail("Failed to parse " + configRef.file + ": " + err.message);
    }
  } else {
    bindings = parseTomlBindings(text);
  }

  const typesNeeded = {};
  for (const b of bindings) typesNeeded[b.type] = true;

  const resources = {};
  if (typesNeeded.kv_namespaces) {
    resources.kv = { name: preview, id: await ensureKv(preview) };
  }
  if (typesNeeded.d1_databases) {
    resources.d1 = { name: preview, id: await ensureD1(preview) };
  }
  if (typesNeeded.r2_buckets) {
    await ensureR2(preview);
    resources.r2 = { name: preview };
  }
  if (typesNeeded.ai_search) {
    resources.ai_search = { id: await ensureAiSearch(preview) };
  }

  const out = rewriteConfig(text, configRef.kind, preview, bindings, resources);
  fs.writeFileSync(configName, out);
  log("Wrote " + configName);

  await deploy(preview, configName);
  await applyEnv(preview);
  log("Preview deployed: " + preview);
}

main().catch(function (err) {
  console.error("[preview] " + (err && err.stack ? err.stack : String(err)));
  process.exit(1);
});
