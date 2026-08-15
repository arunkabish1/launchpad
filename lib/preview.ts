import crypto from "node:crypto";
import { Octokit } from "@octokit/rest";
import {
  setRepoSecret,
  getUser,
  listRepoBranches,
  getDefaultBranch,
  getBranchDetail,
} from "./github";
import { encrypt, decrypt, hasSecretKey } from "./crypto";
import { getTemplate } from "./templates";
import { updateProject } from "./store";
import { renderPreviewWorkflow } from "./workflow";
import { getPreviewScript } from "./template-assets";
import {
  listKvNamespaces,
  listD1Databases,
  listR2Buckets,
  listAiSearchInstances,
  listTurnstileWidgets,
} from "./bindings";
import { listEnvVars } from "./cf";
import type { BindingResource, Project, TemplateInfo } from "./types";

const CF_API_BASE = "https://api.cloudflare.com/client/v4";
const ENV_VALUES_PATH = ".launchpad/env-values.enc";
const PREVIEW_WORKFLOW_PATH = ".github/workflows/preview.yml";
const PREVIEW_SCRIPT_REPO_PATH = ".launchpad/preview.mjs";

export function readPreviewScript(): string {
  return getPreviewScript();
}

export function encryptEnvValues(values: Record<string, string>, masterKey: string): string {
  const key = crypto.createHash("sha256").update(masterKey).digest();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(JSON.stringify(values), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64")}.${tag.toString("base64")}.${enc.toString("base64")}`;
}

export async function upsertRepoFile(
  client: Octokit,
  owner: string,
  repo: string,
  filePath: string,
  content: string,
  message: string
): Promise<void> {
  const author = await getUser(client);
  let sha: string | undefined;
  try {
    const res = await client.rest.repos.getContent({ owner, repo, path: filePath });
    const data = res.data as { sha?: string } | Array<unknown>;
    if (!Array.isArray(data) && data?.sha) sha = data.sha;
  } catch {
    sha = undefined;
  }
  await client.rest.repos.createOrUpdateFileContents({
    owner,
    repo,
    path: filePath,
    message,
    content: Buffer.from(content, "utf8").toString("base64"),
    ...(sha ? { sha } : {}),
    branch: "main",
    author: { name: author.name, email: author.email },
    committer: { name: author.name, email: author.email },
  });
}

export async function deleteRepoFile(
  client: Octokit,
  owner: string,
  repo: string,
  filePath: string,
  message: string
): Promise<boolean> {
  let sha: string;
  try {
    const res = await client.rest.repos.getContent({ owner, repo, path: filePath });
    const data = res.data as { sha?: string } | Array<unknown>;
    if (Array.isArray(data) || !data?.sha) return false;
    sha = data.sha;
  } catch {
    return false;
  }
  const author = await getUser(client);
  await client.rest.repos.deleteFile({
    owner,
    repo,
    path: filePath,
    message,
    sha,
    branch: "main",
    author: { name: author.name, email: author.email },
    committer: { name: author.name, email: author.email },
  });
  return true;
}

export function templateForPreview(project: Project): TemplateInfo {
  const found = getTemplate(project.templateId);
  if (found && found.type === "worker") return found;
  return {
    id: project.templateId,
    name: project.templateName,
    description: "",
    type: "worker",
    category: "javascript",
    deployCommand: "deploy",
    buildCommand: "",
    requiresRoute: false,
    files: [],
    source: "local",
  };
}

export async function getOrCreatePreviewMasterKey(
  client: Octokit,
  project: Project
): Promise<string> {
  if (project.previewKeyEnc && hasSecretKey()) {
    try {
      return await decrypt(project.previewKeyEnc);
    } catch {
      // fall through and rotate below
    }
  }
  if (!hasSecretKey()) {
    throw new Error("LAUNCHPAD_SECRET is not set; cannot manage preview env vars.");
  }
  const key = crypto.randomBytes(32).toString("base64");
  await setRepoSecret(client, project.owner, project.repo, "LP_ENV_MASTER_KEY", key);
  const previewKeyEnc = await encrypt(key);
  await updateProject(project.id, { previewKeyEnc });
  return key;
}

export async function syncPreviewEnvValues(client: Octokit, project: Project): Promise<void> {
  const masterKey = await getOrCreatePreviewMasterKey(client, project);
  const values: Record<string, string> = {};
  for (const v of project.envVars ?? []) {
    if (v.valueEnc && hasSecretKey()) {
      try {
        values[v.key] = await decrypt(v.valueEnc);
      } catch {
        // skip unreadable values
      }
    }
  }
  await upsertRepoFile(
    client,
    project.owner,
    project.repo,
    ENV_VALUES_PATH,
    encryptEnvValues(values, masterKey),
    "Update preview env values via Launchpad"
  );
}

export async function commitPreviewFiles(client: Octokit, project: Project): Promise<void> {
  const template = templateForPreview(project);
  const message = "Enable per-branch preview deployments via Launchpad";
  await upsertRepoFile(
    client,
    project.owner,
    project.repo,
    PREVIEW_WORKFLOW_PATH,
    renderPreviewWorkflow(template, { projectName: project.name, hasLockfile: false }),
    message
  );
  await upsertRepoFile(
    client,
    project.owner,
    project.repo,
    PREVIEW_SCRIPT_REPO_PATH,
    readPreviewScript(),
    message
  );
}

export async function removePreviewFiles(client: Octokit, project: Project): Promise<void> {
  const message = "Disable per-branch preview deployments via Launchpad";
  await deleteRepoFile(client, project.owner, project.repo, PREVIEW_WORKFLOW_PATH, message);
  await deleteRepoFile(client, project.owner, project.repo, PREVIEW_SCRIPT_REPO_PATH, message);
}

export function sanitizeBranch(branch: string): string {
  let s = String(branch || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!s) s = "branch";
  if (s.length > 40) s = s.slice(0, 40).replace(/-+$/g, "");
  return s;
}

export function previewWorkerName(projectName: string, branch: string): string {
  let name = `${projectName}-${sanitizeBranch(branch)}`;
  if (name.length > 63) name = name.slice(0, 63).replace(/-+$/g, "");
  return name;
}

export interface PreviewWorkerInfo {
  name: string;
  url: string | null;
  createdOn: string | null;
  modifiedOn: string | null;
}

export async function listPreviewWorkers(
  project: Project,
  token: string,
  accountId: string
): Promise<PreviewWorkerInfo[]> {
  const res = await fetch(`${CF_API_BASE}/accounts/${accountId}/workers/scripts`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { errors?: Array<{ message?: string }> } | null;
    const detail = body?.errors?.map((e) => e.message).join(", ") || `HTTP ${res.status}`;
    throw new Error(`Failed to list preview workers: ${detail}`);
  }
  const body = (await res.json()) as {
    result?: Array<{ id?: string; created_on?: string; modified_on?: string }>;
  };
  const subdomainRes = await fetch(`${CF_API_BASE}/accounts/${accountId}/workers/subdomain`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const subdomainBody = (await subdomainRes.json().catch(() => null)) as {
    result?: { subdomain?: string };
  } | null;
  const subdomain = subdomainBody?.result?.subdomain ?? null;
  const prefix = `${project.name}-`;
  return (body.result ?? [])
    .map((w) => w.id ?? "")
    .filter((id) => id.startsWith(prefix))
    .sort()
    .map((name) => ({
      name,
      url: subdomain ? `https://${name}.${subdomain}.workers.dev` : null,
      createdOn: body.result?.find((w) => w.id === name)?.created_on ?? null,
      modifiedOn: body.result?.find((w) => w.id === name)?.modified_on ?? null,
    }));
}

export interface PreviewDeployment {
  branch: string;
  previewName: string;
  url: string | null;
  running: boolean;
  sha: string;
  createdOn: string | null;
  modifiedOn: string | null;
}

export async function listPreviewDeployments(
  project: Project,
  token: string,
  accountId: string,
  client: Octokit
): Promise<{ deployments: PreviewDeployment[]; warning: string | null }> {
  const [workers, branches, defaultBranch] = await Promise.all([
    listPreviewWorkers(project, token, accountId),
    listRepoBranches(client, project.owner, project.repo),
    getDefaultBranch(client, project.owner, project.repo).catch(() => "main"),
  ]);
  const workerByName = new Map(workers.map((w) => [w.name, w]));
  const deployments: PreviewDeployment[] = branches
    .filter((b) => b.name !== defaultBranch)
    .map((b) => {
      const previewName = previewWorkerName(project.name, b.name);
      const worker = workerByName.get(previewName);
      return {
        branch: b.name,
        previewName,
        url: worker?.url ?? null,
        running: Boolean(worker),
        sha: b.sha,
        createdOn: worker?.createdOn ?? null,
        modifiedOn: worker?.modifiedOn ?? null,
      };
    })
    .sort((a, b) => (a.running === b.running ? a.branch.localeCompare(b.branch) : a.running ? -1 : 1));
  const runningButGone = workers.filter((w) => !branches.some((b) => previewWorkerName(project.name, b.name) === w.name));
  const warning =
    runningButGone.length > 0
      ? `${runningButGone.length} preview worker${runningButGone.length === 1 ? "" : "s"} exist without a matching GitHub branch.`
      : null;
  return { deployments, warning };
}

export interface PreviewDeployRun {
  runId: number;
  status: string;
  conclusion: string | null;
  htmlUrl: string;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface PreviewBranchDetail {
  branch: string;
  previewName: string;
  url: string | null;
  running: boolean;
  worker: { createdOn: string | null; modifiedOn: string | null } | null;
  deploy: PreviewDeployRun | null;
  git: {
    name: string;
    sha: string;
    message: string;
    authorName: string | null;
    authorDate: string | null;
    htmlUrl: string;
    protected: boolean;
  } | null;
  resources: BindingResource[];
  secrets: string[];
  warnings: string[];
}

export async function getPreviewBranchDetail(
  project: Project,
  token: string,
  accountId: string,
  client: Octokit,
  branch: string
): Promise<PreviewBranchDetail> {
  const previewName = previewWorkerName(project.name, branch);
  const warnings: string[] = [];

  const git = await getBranchDetail(client, project.owner, project.repo, branch).catch(() => null);

  let worker: PreviewWorkerInfo | null = null;
  try {
    worker = (await listPreviewWorkers(project, token, accountId)).find((w) => w.name === previewName) ?? null;
  } catch {
    warnings.push("Could not reach Cloudflare to inspect the preview worker.");
  }

  let deploy: PreviewDeployRun | null = null;
  try {
    const { data } = await client.rest.actions.listWorkflowRunsForRepo({
      owner: project.owner,
      repo: project.repo,
      branch,
      per_page: 5,
    });
    const run = data.workflow_runs[0];
    if (run) {
      deploy = {
        runId: run.id,
        status: run.status ?? "unknown",
        conclusion: run.conclusion ?? null,
        htmlUrl: run.html_url,
        createdAt: run.created_at ?? null,
        updatedAt: run.updated_at ?? null,
      };
    }
  } catch {
    warnings.push("Could not load the latest deploy run from GitHub.");
  }

  const resourceLists = await Promise.all([
    listKvNamespaces(token, accountId).catch(() => []),
    listD1Databases(token, accountId).catch(() => []),
    listR2Buckets(token, accountId).catch(() => []),
    listAiSearchInstances(token, accountId).catch(() => []),
    listTurnstileWidgets(token, accountId).catch(() => []),
  ]);
  const resources: BindingResource[] = resourceLists.flat().filter((r) => {
    if (r.type === "turnstile") return r.name.startsWith(`${previewName}-`);
    return r.name === previewName;
  });

  let secrets: string[] = [];
  try {
    secrets = (await listEnvVars("worker", previewName, token, accountId)).map((v) => v.key);
  } catch {
    warnings.push("Could not list the preview worker's secrets.");
  }

  return {
    branch,
    previewName,
    url: worker?.url ?? null,
    running: Boolean(worker),
    worker: worker ? { createdOn: worker.createdOn, modifiedOn: worker.modifiedOn } : null,
    deploy,
    git,
    resources,
    secrets,
    warnings,
  };
}
