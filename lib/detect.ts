import type { Detection, ImportDeployKind } from "./types";

export interface RepoFileEntry {
  path: string;
  size: number;
}

const PACKAGE_LOCKFILES = new Set(["package-lock.json", "npm-shrinkwrap.json", "yarn.lock", "pnpm-lock.yaml"]);
const SERVER_ONLY_DEPS = [
  "express",
  "fastify",
  "koa",
  "hapi",
  "nestjs",
  "@nestjs/core",
  "prisma",
  "@prisma/client",
  "ws",
  "socket.io",
  "pg",
  "mysql2",
  "mongoose",
  "sequelize",
  "typeorm",
  "mongoose",
  "bull",
  "pg-native",
  "knex",
];
const STATIC_BUILD_DIRS = ["dist", "build", "out", "public"];

function parseJson<T>(text: string): T | null {
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

export interface PackageJsonSummary {
  name?: string;
  main?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  scripts?: Record<string, string>;
  type?: string;
  engines?: Record<string, string>;
}

export function analyzePackageJson(text: string): PackageJsonSummary | null {
  return parseJson<PackageJsonSummary>(text);
}

function hasAnyFile(files: RepoFileEntry[], matcher: RegExp): boolean {
  return files.some((f) => matcher.test(f.path));
}

export function detectStack(files: RepoFileEntry[], readers: Map<string, string>): Detection {
  const names = new Set(files.map((f) => f.path));
  const hasPkg = names.has("package.json");
  const pkg = hasPkg ? analyzePackageJson(readers.get("package.json") ?? "") : null;

  const allDeps: Record<string, string> = { ...(pkg?.dependencies ?? {}), ...(pkg?.devDependencies ?? {}) };
  const depNames = Object.keys(allDeps);

  const hasLockfile = [...files].some((f) => PACKAGE_LOCKFILES.has(f.path.split("/").pop() ?? ""));
  const alreadyHasCF =
    hasAnyFile(files, /^wrangler\.(toml|jsonc|json)$/) ||
    hasAnyFile(files, /^_headers$/) ||
    hasAnyFile(files, /^_redirects$/) ||
    hasAnyFile(files, /^cloudflare$/);

  const packageManager = hasLockfile
    ? names.has("pnpm-lock.yaml")
      ? "pnpm"
      : names.has("yarn.lock")
        ? "yarn"
        : "npm"
    : null;

  const framework: string | null = (() => {
    if (depNames.includes("next")) return "next";
    if (depNames.includes("astro")) return "astro";
    if (depNames.includes("@remix-run/cloudflare") || depNames.includes("@remix-run/cloudflare-pages")) return "remix";
    if (depNames.includes("@cloudflare/pages-function")) return "pages-functions";
    if (depNames.includes("hono")) return "hono";
    if (depNames.includes("itty-router") || depNames.includes("worktop")) return "worktop";
    if (depNames.includes("@sveltejs/kit")) return "sveltekit";
    if (depNames.includes("svelte")) return "svelte";
    if (depNames.includes("vue")) return "vue";
    if (depNames.includes("react") && depNames.includes("react-dom")) return "react";
    return null;
  })();

  const hasSvelteKit = depNames.includes("@sveltejs/kit") || depNames.includes("@sveltejs/vite-plugin-svelte");
  const hasCloudflareAdapter =
    depNames.includes("@sveltejs/adapter-cloudflare") ||
    depNames.includes("@sveltejs/adapter-cloudflare-workers") ||
    depNames.includes("@sveltejs/adapter-auto");
  const adapterBased = hasSvelteKit && !hasCloudflareAdapter;

  const mainField = pkg?.main;
  const workerEntry =
    (mainField || "")
      .replace(/^\.\//, "")
      .split("/")
      .filter(Boolean)
      .join("/");

  const serverOnlyDeps = depNames.filter((d) => SERVER_ONLY_DEPS.some((s) => d === s || d.startsWith(s + "@")));

  const isPython = names.has("requirements.txt") || names.has("pyproject.toml");
  const runtime: Detection["runtime"] = isPython ? "python" : hasPkg || hasAnyFile(files, /\.(ts|tsx|js|jsx)$/) ? "node" : "other";

  const scripts = pkg?.scripts ?? {};
  const buildCommand = scripts["build"] ?? scripts["build:prod"] ?? "";

  const outputDir: string | null = (() => {
    if (framework === "next") return "out";
    if (framework === "astro") return "dist";
    if (framework === "react" || framework === "vue" || framework === "svelte") return "dist";
    if (hasAnyFile(files, /^public\/index\.html$/)) return "public";
    for (const dir of STATIC_BUILD_DIRS) {
      if (hasAnyFile(files, new RegExp(`^${dir}/index\\.html$`))) return dir;
    }
    const b = scripts["build"] ?? "";
    const m = b.match(/--out-dir\s+([\w.-]+)/) || b.match(/-o\s+([\w.-]+)/);
    return m ? m[1] : null;
  })();

  const envVarNames = parseEnvExample(readers.get(".env.example") ?? "");

  const pythonServerModules = isPython
    ? ["fastapi", "flask", "django", "uvicorn"].filter((m) => (readers.get("requirements.txt") ?? "").toLowerCase().includes(m.toLowerCase())).map((m) => `python:${m}`)
    : [];

  const hasStaticEntry =
    hasAnyFile(files, /^index\.html$/) ||
    hasAnyFile(files, /^public\/index\.html$/) ||
    hasAnyFile(files, /^dist\/index\.html$/) ||
    hasAnyFile(files, /^static\//);

  let deployKind: ImportDeployKind;
  const blockers: string[] = [];

  if (serverOnlyDeps.length > 0 || pythonServerModules.length > 0) {
    deployKind = "needs-adaptation";
    blockerAdd(blockers, serverOnlyDeps);
    blockerAdd(blockers, pythonServerModules);
  } else if (adapterBased) {
    deployKind = "needs-adaptation";
    blockers.push(framework === "sveltekit" ? "SvelteKit needs a Cloudflare adapter to run on Workers/Pages" : "This framework needs a Cloudflare adapter");
  } else if (framework === "next") {
    deployKind = "needs-adaptation";
    blockers.push("Next.js apps need an adapter (opennext) to run on Workers");
  } else if (isPython) {
    deployKind = "needs-adaptation";
    blockers.push("Python runtime not directly supported by Cloudflare Workers/Pages for this app");
  } else if (hasStaticEntry || (outputDir && names.has("package.json"))) {
    deployKind = "pages";
  } else if (workerEntry && readerHasWorkerExport(readers, workerEntry)) {
    deployKind = "worker";
  } else if (hasAnyFile(files, /\.(ts|tsx|js|jsx|mjs|cjs)$/)) {
    deployKind = "worker";
  } else {
    deployKind = "unsupported";
    blockers.push("No recognizable app entry point found");
  }

  return {
    framework,
    deployKind,
    buildCommand,
    outputDir,
    runtime,
    packageManager,
    hasLockfile,
    alreadyHasCloudflareConfig: alreadyHasCF,
    envVars: envVarNames.map((k) => ({ key: k, kind: "secret" })),
    serverOnlyDeps: [...serverOnlyDeps, ...pythonServerModules],
    blockers,
  };
}

function parseEnvExample(text: string): string[] {
  const keys: string[] = [];
  for (const line of (text ?? "").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const m = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*) ?=/);
    if (m) keys.push(m[1]);
  }
  return keys;
}

function blockerAdd(arr: string[], items: string[]): void {
  for (const i of items) if (!arr.includes(i)) arr.push(i);
}

function readerHasWorkerExport(readers: Map<string, string>, mainField: string): boolean {
  const candidates = [
    mainField,
    mainField.replace(/^\.[/\\]/, ""),
    `src/${mainField.replace(/^(\.\/|src\/)/, "").split("/").pop() ?? ""}`,
  ].filter(Boolean);
  for (const c of candidates) {
    const content = readers.get(c);
    if (content && /(fetch|scheduled)\s*\(|export\s+default\s*[{([]?/m.test(content)) {
      return true;
    }
  }
  return false;
}
