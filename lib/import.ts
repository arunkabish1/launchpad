import crypto from "node:crypto";
import {
  createClient,
  validatePat,
  getUser,
  setRepoSecret,
  parseRepoUrl,
  verifyRepoAccess,
  downloadRepo,
  pushFilesToExistingRepo,
  requiredScopes,
  type ImportedFile,
} from "./github";
import { detectStack } from "./detect";
import { generateDeployPlan, generateGuidedFix, isAiAvailable } from "./ai";
import { getEnvPat, getDefaultAccountId } from "./config";import { getWorkersSubdomain, buildLiveUrl } from "./cf";
import { addProject } from "./store";
import { ensureProjectOwner } from "./membership";
import { rememberPat } from "./status";
import { recordAudit } from "./audit";
import { renderDeployWorkflow } from "./workflow";
import type {
  Detection,
  DeployPlan,
  GuidedFix,
  ImportAnalysis,
  Project,
  TemplateInfo,
} from "./types";

export class ImportError extends Error {}

interface ImportCreds {
  pat: string;
  cloudflareToken: string;
  accountId: string;
}

async function resolveCreds(patInput?: string, tokenInput?: string, accountIdInput?: string): Promise<ImportCreds> {
  const pat = (patInput ?? "").trim() || (await getEnvPat());
  if (!pat) throw new ImportError("A GitHub Personal Access Token is required.");
  const cloudflareToken = (tokenInput ?? "").trim() || process.env.CLOUDFLARE_API_TOKEN || "";
  if (!cloudflareToken) throw new ImportError("A Cloudflare API token is required.");
  const accountId = (accountIdInput ?? "").trim() || (await getDefaultAccountId());
  if (!accountId) throw new ImportError("A Cloudflare account ID is required.");
  return { pat, cloudflareToken, accountId };
}

async function checkScopes(client: ReturnType<typeof createClient>): Promise<void> {
  const { scopes } = await validatePat(client).catch(() => ({ scopes: null as string[] | null }));
  if (scopes) {
    const missing = requiredScopes().filter((s) => !scopes.includes(s));
    if (missing.length > 0) {
      throw new ImportError(
        `Your GitHub token is missing the ${missing.join(" and ")} scope(s). Recreate the token with repo + workflow scopes.`
      );
    }
  }
}

export async function analyseImport(input: {
  url: string;
  githubPat?: string;
}): Promise<ImportAnalysis> {
  const { owner, repo } = parseRepoUrl(input.url);
  const pat = (input.githubPat ?? "").trim() || (await getEnvPat());
  if (!pat) throw new ImportError("A GitHub Personal Access Token is required.");
  const client = createClient(pat);
  await checkScopes(client);

  let meta;
  let files: ImportedFile[];
  let tree: Array<{ path: string; size: number }>;
  try {
    meta = await verifyRepoAccess(client, owner, repo);
    const downloaded = await downloadRepo(client, owner, repo, meta.defaultBranch);
    files = downloaded.files;
    tree = downloaded.tree;
  } catch (err) {
    throw new ImportError((err as Error).message);
  }

  const readers = new Map<string, string>();
  for (const f of files) readers.set(f.path, f.content);

  const detection = detectStack(tree, readers);

  let plan: DeployPlan | null = null;
  let guidedFix: GuidedFix | null = null;

  if (detection.deployKind === "static" || detection.deployKind === "worker" || detection.deployKind === "pages") {
    if (isAiAvailable()) {
      const sample = pickSample(files);
      plan = await generateDeployPlan(detection, sample);
    } else {
      plan = fallbackPlan(detection);
    }
  } else if (detection.deployKind === "needs-adaptation" || detection.deployKind === "unsupported") {
    if (isAiAvailable()) {
      guidedFix = await generateGuidedFix(detection);
    } else {
      guidedFix = fallbackFix(detection);
    }
  }

  return {
    detection,
    plan,
    guidedFix,
    files: files.map((f) => f.path),
    defaultBranch: meta.defaultBranch,
    repoTitle: meta.title,
  };
}

function pickSample(files: ImportedFile[]): string {
  const order = [
    "package.json",
    "wrangler.toml",
    "wrangler.jsonc",
    "wrangler.json",
    "src/index.ts",
    "src/index.js",
    "index.html",
  ];
  for (const p of order) {
    const f = files.find((x) => x.path === p);
    if (f) return f.content;
  }
  if (files.length > 0) return files[0].content;
  return "";
}

function fallbackPlan(detection: Detection): DeployPlan {
  const buildCommand = detection.buildCommand || "";
  const deployCommand =
    detection.deployKind === "pages"
      ? `wrangler pages deploy ${(detection.outputDir ?? "dist").trim() || "."}`
      : "npx wrangler deploy";
  return {
    deployKind: detection.deployKind,
    framework: detection.framework,
    buildCommand,
    outputDir: detection.outputDir,
    deployCommand,
    packageManager: detection.packageManager,
    runtime: detection.runtime,
    envVars: detection.envVars,
    alreadyHasCloudflareConfig: detection.alreadyHasCloudflareConfig,
    summary: `Detected ${detection.framework ?? "app"} and prepared a Cloudflare ${
      detection.deployKind === "pages" ? "Pages" : "Workers"
    } deploy.`,
    notes: ["Cloudflare AI is not configured; using a safe detected fallback."],
    model: "fallback",
  };
}

function fallbackFix(detection: Detection): GuidedFix {
  return {
    reason:
      detection.deployKind === "unsupported"
        ? "This project doesn't have a recognizable app entry point for Cloudflare."
        : "This project uses server-only or runtime patterns Cloudflare Workers/Pages can't host as-is.",
    instruction:
      "Ask your AI tool to convert this project so it runs on Cloudflare Workers or Pages. " +
      "Blocker(s): " + (detection.blockers.join(", ") || "unknown") + ".",
    effort: "medium",
  };
}

function syntheticTemplate(plan: DeployPlan, projectName: string): TemplateInfo {
  const isPages = plan.deployKind === "pages";
  const setup = plan.buildCommand
    ? `${plan.packageManager === "pnpm" ? "pnpm install" : plan.packageManager === "yarn" ? "yarn install" : "npm install"} && ${plan.buildCommand}`
    : plan.packageManager === "pnpm"
      ? "pnpm install"
      : plan.packageManager === "yarn"
        ? "yarn install"
        : "npm install";
  return {
    id: `import-${projectName}`,
    name: plan.framework || "Imported app",
    description: "Deployed from an existing repository via Launchpad.",
    type: isPages ? "pages" : "worker",
    provider: "cloudflare",
    category: plan.runtime === "python" ? "python" : "javascript",
    deployCommand: plan.deployCommand,
    buildCommand: plan.buildCommand,
    requiresRoute: false,
    files: [],
    source: "local",
    deploy: {
      setup: setup.replace("npm install", "npm install").replace("pnpm install", "pnpm install"),
      command: plan.deployCommand,
      runtime: plan.runtime === "python" ? "python" : "node",
    },
  };
}

export async function deployImport(input: {
  url: string;
  projectName: string;
  plan: DeployPlan;
  githubPat?: string;
  cloudflareToken?: string;
  accountId?: string;
  envValues?: Record<string, string>;
  actor?: string;
  actorId?: string;
}): Promise<Project> {
  const { owner, repo } = parseRepoUrl(input.url);
  const creds = await resolveCreds(input.githubPat, input.cloudflareToken, input.accountId);
  const client = createClient(creds.pat);
  await checkScopes(client);

  const projectName = validateImportName(input.projectName);
  const meta = await verifyRepoAccess(client, owner, repo);
  const user = await getUser(client);

  const template = syntheticTemplate(input.plan, projectName);
  const hasLockfile = input.plan.packageManager !== null;

  const files: Array<{ path: string; content: string; binary?: boolean }> = [];

  if (!input.plan.alreadyHasCloudflareConfig) {
    files.push({
      path: "wrangler.jsonc",
      content: renderWranglerJsonc(input.plan),
    });
  }

  files.push({
    path: ".github/workflows/deploy.yml",
    content: renderDeployWorkflow(template, {
      projectName,
      hasLockfile,
      provision: template.type === "worker",
    }),
  });

  if (input.plan.envVars.length > 0 && Object.keys(input.envValues ?? {}).length > 0) {
    const values: string[] = [];
    for (const v of input.plan.envVars) {
      const val = (input.envValues ?? {})[v.key];
      if (val !== undefined && val !== "") {
        await setRepoSecret(client, owner, repo, v.key, val);
        values.push(v.key);
      }
    }
    void values;
  }

  await setRepoSecret(client, owner, repo, "CLOUDFLARE_API_TOKEN", creds.cloudflareToken);
  await setRepoSecret(client, owner, repo, "CLOUDFLARE_ACCOUNT_ID", creds.accountId);

  await pushFilesToExistingRepo(
    client,
    owner,
    repo,
    files,
    user,
    "Deploy to Cloudflare via Launchpad",
    meta.defaultBranch
  );

  let liveUrl: string | null = null;
  try {
    const subdomain = await getWorkersSubdomain(creds.cloudflareToken, creds.accountId);
    liveUrl = buildLiveUrl(template.type, projectName, subdomain);
  } catch {
    liveUrl = null;
  }

  const project: Project = {
    id: crypto.randomUUID(),
    name: projectName,
    templateId: template.id,
    templateName: template.name,
    type: template.type,
    provider: "cloudflare",
    route: null,
    owner,
    repo,
    githubUrl: `https://github.com/${owner}/${repo}`,
    createdAt: new Date().toISOString(),
    liveUrl,
    imported: true,
    previewEnabled: false,
    ...(input.actorId ? { createdBy: input.actorId } : {}),
  };

  await addProject(project);
  await rememberPat(project.id, creds.pat);

  if (input.actorId) {
    await ensureProjectOwner({
      projectId: project.id,
      projectName: project.name,
      userId: input.actorId,
      username: input.actor ?? "admin",
    }).catch((err) => console.error("Failed to create owner membership", err));
  }

  recordAudit({
    actor: input.actor ?? "admin",
    action: "launch",
    project: projectName,
    detail: `Imported ${owner}/${repo} → ${projectName} (${template.type})`,
    outcome: "ok",
  });

  return project;
}

function validateImportName(name: string): string {
  const trimmed = (name ?? "").trim().toLowerCase();
  if (!trimmed) throw new ImportError("Project name is required.");
  if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(trimmed) || trimmed.length > 40) {
    throw new ImportError(
      "Project name may only contain lowercase letters, numbers, and hyphens (40 chars or fewer)."
    );
  }
  return trimmed;
}

function renderWranglerJsonc(plan: DeployPlan): string {
  const runtime =
    plan.runtime === "python"
      ? { compatibility_date: "2026-08-15", compatibility_flags: ["python_workers"] }
      : { compatibility_date: "2026-08-15", compatibility_flags: ["nodejs_compat"] };
  const props: Record<string, unknown> = {
    name: "${PROJECT_NAME}",
    main: "src/index.js",
    ...runtime,
  };
  if (plan.outputDir) {
    props.assets = { directory: plan.outputDir, binding: "ASSETS" };
  }
  return JSON.stringify(props, null, 2) + "\n";
}
