#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";

const CF_API_BASE = "https://api.cloudflare.com/client/v4";
const ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID || "";
const API_TOKEN = process.env.CLOUDFLARE_API_TOKEN || "";

function log(msg) {
  console.log("[provision] " + msg);
}
function fail(msg) {
  console.error("[provision] " + msg);
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

function findConfig() {
  for (const name of ["wrangler.toml", "wrangler.jsonc", "wrangler.json"]) {
    if (fs.existsSync(name)) {
      const kind = name.endsWith(".toml") ? "toml" : name.endsWith(".jsonc") ? "jsonc" : "json";
      return { file: name, kind };
    }
  }
  return null;
}

function stripJsonComments(text) {
  let out = "";
  let i = 0;
  let inString = false;
  const n = text.length;
  while (i < n) {
    const ch = text[i];
    const next = text[i + 1];
    if (inString) {
      out += ch;
      if (ch === "\\" && i + 1 < n) {
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
      while (i < n && text[i] !== "\n") i += 1;
      continue;
    }
    if (ch === "/" && next === "*") {
      i += 2;
      while (i < n && !(text[i] === "*" && text[i + 1] === "/")) i += 1;
      i += 2;
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
}

function removeTrailingCommas(text) {
  return text.replace(/,\s*([}\]])/g, "$1");
}

function parseJsonc(text) {
  return JSON.parse(removeTrailingCommas(stripJsonComments(text)));
}

function parseTomlAiSearch(text) {
  const bindings = [];
  let block = null;
  const lines = text.split("\n");
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    if (line.startsWith("[[") && line.endsWith("]]")) {
      const section = line.slice(2, -2).trim();
      block = section === "ai_search" ? {} : null;
      if (block) bindings.push(block);
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

function parseJsonAiSearch(parsed) {
  const bindings = [];
  for (const b of parsed.ai_search || []) {
    if (b && b.binding) bindings.push(b);
  }
  return bindings;
}

function parseTomlCustomDomains(text) {
  const hosts = [];
  let block = null;
  const lines = text.split("\n");
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    if (line.startsWith("[[") && line.endsWith("]]")) {
      const section = line.slice(2, -2).trim();
      block = section === "custom_domains" ? {} : null;
      if (block) hosts.push(block);
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
    if (key === "hostname" && /^"[^"]*"$/.test(rawValue)) {
      block.hostname = JSON.parse(rawValue);
    }
  }
  return hosts.map(function (h) { return h.hostname; }).filter(Boolean);
}

function insertInstanceName(text, bindings, derived) {
  let out = text;
  for (const b of bindings) {
    if (b.instance_name) continue;
    const name = derived[b.binding];
    if (!name) continue;
    const lines = out.split("\n");
    const insertAt = [];
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].trim() === "[[ai_search]]") {
        const end = lines.findIndex(function (l, j) {
          if (j <= i) return false;
          const t = l.trim();
          return t.startsWith("[[") || t.startsWith("[") || t === "";
        });
        const blockEnd = end === -1 ? lines.length : end;
        const hasInstance = lines.slice(i + 1, blockEnd).some(function (l) {
          return l.trim().startsWith("instance_name");
        });
        const bindingLine = lines.slice(i + 1, blockEnd).find(function (l) {
          return l.trim().startsWith("binding");
        });
        if (!hasInstance && bindingLine) {
          const indent = bindingLine.slice(0, bindingLine.length - bindingLine.trimStart().length);
          insertAt.push({ at: blockEnd, indent });
        }
      }
    }
    for (const item of insertAt.reverse()) {
      lines.splice(item.at, 0, item.indent + 'instance_name = "' + name + '"');
    }
    out = lines.join("\n");
  }
  return out;
}

function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function insertInstanceNameJson(text, cfg, derived) {
  let out = text;
  for (const b of cfg.ai_search || []) {
    if (!b || derived[b.binding] === undefined) continue;
    const name = derived[b.binding];
    const re = new RegExp('"binding"\\s*:\\s*"' + escapeRegExp(b.binding) + '"');
    const m = re.exec(out);
    if (!m) continue;
    const lineStart = out.lastIndexOf("\n", m.index) + 1;
    const beforeKey = out.slice(lineStart, m.index);
    const insertPos = m.index + m[0].length;
    const inline = beforeKey.trim() !== "";
    const insertText = inline
      ? ', "instance_name": "' + name + '"'
      : ',\n' + beforeKey + '  "instance_name": "' + name + '"';
    out = out.slice(0, insertPos) + insertText + out.slice(insertPos);
  }
  return out;
}

function sanitizeName(name) {
  let s = String(name || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!s) s = "ai-search";
  if (s.length > 63) s = s.slice(0, 63).replace(/-+$/g, "");
  return s;
}

async function getProjectName(configRef) {
  const text = fs.readFileSync(configRef.file, "utf8");
  if (configRef.kind !== "toml") {
    try {
      const parsed = configRef.kind === "jsonc" ? parseJsonc(text) : JSON.parse(text);
      return (parsed.name || "").trim();
    } catch (err) {
      // fall through
    }
  } else {
    const m = text.match(/^name\s*=\s*"([^"]+)"/m);
    if (m) return m[1];
  }
  return ((process.env.GITHUB_REPOSITORY || "").split("/").pop() || "project").trim();
}

async function ensureAiSearch(id) {
  const list = await cfJson("/accounts/" + ACCOUNT_ID + "/ai-search/instances?per_page=100&page=1");
  if (!list.ok) {
    fail("Failed to list AI Search instances: " + apiDetail(list.data, list.status));
  }
  const found = list.data.result.find(function (r) { return r.id === id; });
  if (found) {
    log("AI Search instance " + id + " already exists");
    return id;
  }
  const created = await cfJson("/accounts/" + ACCOUNT_ID + "/ai-search/instances", {
    method: "POST",
    body: { id },
  });
  if (!created.ok) {
    fail("Failed to create AI Search instance " + id + ": " + apiDetail(created.data, created.status));
  }
  log("Provisioned AI Search instance " + id);
  return created.data.result.id;
}

async function getWorkersSubdomain() {
  const sub = await cfJson("/accounts/" + ACCOUNT_ID + "/workers/subdomain");
  if (sub.ok && sub.data && sub.data.result && sub.data.result.subdomain) {
    return sub.data.result.subdomain;
  }
  return null;
}

function widgetNameFor(project, prefix) {
  let name = project + "-" + prefix;
  if (name.length > 64) name = name.slice(0, 64).replace(/-+$/g, "");
  return name;
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
    log("Turnstile widget " + name + " already exists");
    return { sitekey: found.sitekey, secret: detail.data.result.secret };
  }
  const created = await cfJson("/accounts/" + ACCOUNT_ID + "/challenges/widgets", {
    method: "POST",
    body: { name, mode: "managed", domains },
  });
  if (!created.ok) {
    fail("Failed to create Turnstile widget " + name + ": " + apiDetail(created.data, created.status));
  }
  log("Provisioned Turnstile widget " + name + " for " + domains.join(", "));
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
    log("env-values.enc is malformed; skipping env vars.");
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
    log("Failed to decrypt env-values.enc (" + err.message + "); skipping env vars.");
    return {};
  }
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

async function setSecret(worker, name, value) {
  const res = await cfJson(
    "/accounts/" + ACCOUNT_ID + "/workers/scripts/" + worker + "/secrets",
    { method: "PUT", body: { name, text: value, type: "secret_text" } }
  );
  if (!res.ok) {
    fail("Failed to set secret " + name + " on " + worker + ": " + apiDetail(res.data, res.status));
  }
  log("Applied env var " + name + " to " + worker);
}

async function main() {
  requireCredentials();

  const configRef = findConfig();
  if (!configRef) fail("No wrangler config file found in the repo root.");

  const text = fs.readFileSync(configRef.file, "utf8");
  const projectName = await getProjectName(configRef);
  log("Project: " + projectName + " | Config: " + configRef.file);

  let bindings = [];
  let customDomains = [];
  if (configRef.kind !== "toml") {
    let parsed = null;
    try {
      parsed = configRef.kind === "jsonc" ? parseJsonc(text) : JSON.parse(text);
    } catch (err) {
      fail("Failed to parse " + configRef.file + ": " + err.message);
    }
    bindings = parseJsonAiSearch(parsed);
    customDomains = (parsed.custom_domains || [])
      .map(function (d) { return d && d.hostname; })
      .filter(Boolean);
  } else {
    bindings = parseTomlAiSearch(text);
    customDomains = parseTomlCustomDomains(text);
  }

  const values = loadEnvValues();
  const turnstilePrefixes = turnstilePairs(values);

  if (bindings.length === 0 && turnstilePrefixes.length === 0) {
    log("No AI Search bindings or Turnstile env vars to provision; nothing to do.");
    return;
  }

  const derived = {};
  for (const b of bindings) {
    if (!b.instance_name) {
      derived[b.binding] = sanitizeName(projectName + "-" + b.binding);
    }
  }

  for (const b of bindings) {
    const instanceName = b.instance_name || derived[b.binding];
    await ensureAiSearch(instanceName);
  }

  if (Object.keys(derived).length > 0) {
    let out = text;
    if (configRef.kind === "toml") {
      out = insertInstanceName(text, bindings, derived);
    } else if (configRef.kind === "jsonc") {
      out = insertInstanceNameJson(text, parseJsonc(text), derived);
    } else {
      const cfg = JSON.parse(text);
      for (const b of bindings) {
        if (derived[b.binding]) {
          cfg.ai_search = cfg.ai_search.map(function (e) {
            return e === b ? { ...e, instance_name: derived[b.binding] } : e;
          });
        }
      }
      out = JSON.stringify(cfg, null, 2);
    }
    fs.writeFileSync(configRef.file, out);
    log("Wrote derived instance_name values into " + configRef.file);
  }

  if (turnstilePrefixes.length > 0) {
    const subdomain = await getWorkersSubdomain();
    const host = subdomain ? projectName + "." + subdomain + ".workers.dev" : null;
    const domains = [];
    if (host) domains.push(host);
    for (const c of customDomains) domains.push(c);
    if (domains.length === 0) {
      log("No deploy host available; skipping Turnstile widgets.");
    } else {
      for (const prefix of turnstilePrefixes) {
        const widgetName = widgetNameFor(projectName, prefix);
        const widget = await ensureTurnstileWidget(widgetName, domains);
        values[prefix + "_SITE_KEY"] = widget.sitekey;
        values[prefix + "_SECRET_KEY"] = widget.secret;
      }
    }
  }

  const keys = Object.keys(values);
  if (keys.length === 0) {
    log("No env vars to apply.");
    return;
  }
  for (const key of keys) {
    await setSecret(projectName, key, values[key]);
  }
  log("Provisioning complete.");
}

main().catch(function (err) {
  console.error("[provision] " + (err && err.stack ? err.stack : String(err)));
  process.exit(1);
});
