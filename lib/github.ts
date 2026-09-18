import { Octokit } from "@octokit/rest";
import { sealBox } from "./crypto";
import type { DeployRun } from "./types";
import type { ScaffoldedFile } from "./scaffold";

export interface RepoInfo {
  owner: string;
  repo: string;
  htmlUrl: string;
}

export interface GithubUser {
  login: string;
  name: string;
  email: string;
}

const REQUIRED_SCOPES = ["repo", "workflow"];

export function createClient(pat: string): Octokit {
  return new Octokit({ auth: pat });
}

export async function validatePat(client: Octokit): Promise<{ scopes: string[] | null }> {
  const res = await client.rest.users.getAuthenticated();
  const scopesHeader = res.headers["x-oauth-scopes"];
  const scopes = typeof scopesHeader === "string" && scopesHeader.length > 0
    ? scopesHeader.split(",").map((s) => s.trim()).filter(Boolean)
    : null;
  return { scopes };
}

export async function getUser(client: Octokit): Promise<GithubUser> {
  const { data } = await client.rest.users.getAuthenticated();
  const email =
    data.email ??
    (data.login ? `${data.login}@users.noreply.github.com` : "launchpad@users.noreply.github.com");
  return {
    login: data.login,
    name: data.name || data.login || "Launchpad",
    email,
  };
}

export async function createRepo(
  client: Octokit,
  name: string,
  isPrivate: boolean,
  org?: string
): Promise<RepoInfo> {
  if (org) {
    const { data } = await client.rest.repos.createInOrg({
      org,
      name,
      private: isPrivate,
      description: `Launched by Cloudflare Launchpad`,
      auto_init: true,
    });
    return { owner: data.owner.login, repo: data.name, htmlUrl: data.html_url };
  }
  const { data } = await client.rest.repos.createForAuthenticatedUser({
    name,
    private: isPrivate,
    description: `Launched by Cloudflare Launchpad`,
    auto_init: true,
  });
  return { owner: data.owner.login, repo: data.name, htmlUrl: data.html_url };
}

export async function deleteRepo(client: Octokit, owner: string, repo: string): Promise<void> {
  await client.rest.repos.delete({ owner, repo });
}

export type CollaboratorPermission = "pull" | "triage" | "push" | "maintain" | "admin";

export async function addRepoCollaborator(
  client: Octokit,
  owner: string,
  repo: string,
  username: string,
  permission: CollaboratorPermission = "push"
): Promise<number> {
  const res = await client.rest.repos.addCollaborator({
    owner,
    repo,
    username,
    permission,
  });
  return res.status;
}

export async function removeRepoCollaborator(
  client: Octokit,
  owner: string,
  repo: string,
  username: string
): Promise<void> {
  await client.rest.repos.removeCollaborator({ owner, repo, username });
}

export interface RepoBranch {
  name: string;
  sha: string;
  url: string;
}

export async function listRepoBranches(
  client: Octokit,
  owner: string,
  repo: string
): Promise<RepoBranch[]> {
  const branches: RepoBranch[] = [];
  for await (const res of client.paginate.iterator(client.rest.repos.listBranches, {
    owner,
    repo,
    per_page: 100,
  })) {
    for (const b of res.data) {
      branches.push({ name: b.name, sha: b.commit.sha, url: b.commit.url });
    }
  }
  return branches;
}

export async function getDefaultBranch(
  client: Octokit,
  owner: string,
  repo: string
): Promise<string> {
  const { data } = await client.rest.repos.get({ owner, repo });
  return data.default_branch ?? "main";
}

export interface RepoBranchDetail {
  name: string;
  sha: string;
  message: string;
  authorName: string | null;
  authorDate: string | null;
  htmlUrl: string;
  protected: boolean;
}

export async function getBranchDetail(
  client: Octokit,
  owner: string,
  repo: string,
  branch: string
): Promise<RepoBranchDetail> {
  const { data } = await client.rest.repos.getBranch({ owner, repo, branch });
  return {
    name: data.name,
    sha: data.commit.sha,
    message: data.commit.commit.message ?? "",
    authorName: data.commit.commit.author?.name ?? null,
    authorDate: data.commit.commit.author?.date ?? null,
    htmlUrl: data.commit.html_url ?? `https://github.com/${owner}/${repo}/tree/${branch}`,
    protected: Boolean(data.protected),
  };
}

export async function setRepoSecret(
  client: Octokit,
  owner: string,
  repo: string,
  secretName: string,
  secretValue: string
): Promise<void> {
  const { data: keyData } = await client.rest.actions.getRepoPublicKey({ owner, repo });

  const publicKey = Uint8Array.from(Buffer.from(keyData.key, "base64"));
  const encrypted = sealBox(new TextEncoder().encode(secretValue), publicKey);
  const encryptedValue = Buffer.from(encrypted).toString("base64");

  await client.rest.actions.createOrUpdateRepoSecret({
    owner,
    repo,
    secret_name: secretName,
    key_id: keyData.key_id,
    encrypted_value: encryptedValue,
  });
}

export async function listWorkflowRuns(
  client: Octokit,
  owner: string,
  repo: string,
  perPage = 10
): Promise<DeployRun[]> {
  const { data } = await client.rest.actions.listWorkflowRunsForRepo({
    owner,
    repo,
    per_page: perPage,
  });
  return data.workflow_runs.map((run) => ({
    status: run.status ?? "unknown",
    conclusion: run.conclusion ?? null,
    runId: run.id,
    htmlUrl: run.html_url,
    createdAt: run.created_at ?? null,
    updatedAt: run.updated_at ?? null,
    headSha: run.head_sha ?? null,
    name: run.name ?? "",
  }));
}

const jobLogsUrl = (owner: string, repo: string, jobId: number) =>
  `https://api.github.com/repos/${owner}/${repo}/actions/jobs/${jobId}/logs`;

export async function getRunLogs(
  client: Octokit,
  owner: string,
  repo: string,
  runId: number
): Promise<{ steps: Array<{ name: string; status: string; conclusion: string | null }>; text: string }> {
  const jobsRes = await client.rest.actions.listJobsForWorkflowRun({ owner, repo, run_id: runId });
  const steps = jobsRes.data.jobs.flatMap((j) =>
    (j.steps ?? []).map((s) => ({
      name: s.name,
      status: s.status,
      conclusion: s.conclusion ?? null,
    }))
  );

  const authResult = (await client.auth()) as { token?: string };
  const pat = authResult?.token ?? "";

  let text = "";
  for (const job of jobsRes.data.jobs) {
    try {
      const res = await fetch(jobLogsUrl(owner, repo, job.id), {
        headers: {
          Authorization: `Bearer ${pat}`,
          Accept: "application/vnd.github.v3+json",
          "User-Agent": "cloudflare-launchpad",
        },
        redirect: "follow",
      });
      if (res.ok) {
        text += `\n===== ${job.name} =====\n${await res.text()}\n`;
      }
    } catch {
      // Best-effort per job; keep other jobs' logs.
    }
  }
  return { steps, text };
}

export async function triggerWorkflowDispatch(
  client: Octokit,
  owner: string,
  repo: string,
  workflowId: number | string,
  ref: string
): Promise<void> {
  await client.rest.actions.createWorkflowDispatch({
    owner,
    repo,
    workflow_id: workflowId,
    ref,
  });
}

export async function findDeployWorkflow(
  client: Octokit,
  owner: string,
  repo: string
): Promise<{ id: number; path: string } | null> {
  const { data } = await client.rest.actions.listRepoWorkflows({ owner, repo });
  const deploy = data.workflows.find((w) => w.name.toLowerCase().includes("deploy"));
  if (!deploy) return null;
  return { id: deploy.id, path: deploy.path };
}

export function requiredScopes(): string[] {
  return REQUIRED_SCOPES;
}

export async function pushScaffoldToRepo(
  client: Octokit,
  owner: string,
  repo: string,
  files: ScaffoldedFile[],
  author: GithubUser
): Promise<void> {
  const blobs: Array<{ path: string; mode: "100644"; type: "blob"; sha: string }> = [];

  for (const file of files) {
    const content = file.binary ? file.content : Buffer.from(file.content, "utf8").toString("base64");
    const { data } = await client.rest.git.createBlob({
      owner,
      repo,
      content,
      encoding: "base64",
    });
    blobs.push({ path: file.path, mode: "100644", type: "blob", sha: data.sha });
  }

  const { data: tree } = await client.rest.git.createTree({
    owner,
    repo,
    tree: blobs,
  });

  const { data: ref } = await client.rest.git.getRef({
    owner,
    repo,
    ref: "heads/main",
  });
  const parentSha = ref.object.sha;

  const { data: commit } = await client.rest.git.createCommit({
    owner,
    repo,
    message: "Initial scaffold via Launchpad",
    tree: tree.sha,
    parents: [parentSha],
    author: { name: author.name, email: author.email },
    committer: { name: author.name, email: author.email },
  });

  try {
    await client.rest.git.updateRef({ owner, repo, ref: "heads/main", sha: commit.sha });
  } catch (err) {
    if ((err as { status?: number }).status !== 422) throw err;
    await client.rest.git.createRef({ owner, repo, ref: "refs/heads/main", sha: commit.sha });
  }
}

export interface ParsedRepoRef {
  owner: string;
  repo: string;
  input: string;
}

export function parseRepoUrl(input: string): ParsedRepoRef {
  const trimmed = (input ?? "").trim().replace(/\/+$/, "");
  if (!trimmed) throw new Error("Please enter a GitHub repository URL.");
  const m = trimmed.match(/(?:github\.com\/|^)([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)(?:\.git)?\/?$/);
  if (!m) {
    throw new Error(
      "That doesn't look like a GitHub repository. Enter something like https://github.com/owner/repo"
    );
  }
  return { owner: m[1], repo: m[2], input: trimmed };
}

export async function verifyRepoAccess(
  client: Octokit,
  owner: string,
  repo: string
): Promise<{ defaultBranch: string; private: boolean; title: string }> {
  try {
    const { data } = await client.rest.repos.get({ owner, repo });
    return {
      defaultBranch: data.default_branch ?? "main",
      private: Boolean(data.private),
      title: data.name || repo,
    };
  } catch (err) {
    const status = (err as { status?: number }).status;
    if (status === 404) throw new Error(`Repository "${owner}/${repo}" not found.`);
    if (status === 401 || status === 403) {
      throw new Error(
        `No access to "${owner}/${repo}". The token needs repo scope, or the repo is private and the token can't read it.`
      );
    }
    throw new Error(`Could not read "${owner}/${repo}".`);
  }
}

const MAX_REPO_BYTES = 20 * 1024 * 1024;
const MAX_TREE_ENTRIES = 4000;
const IGNORED_PATHS = /(^|\/)(\.git|node_modules|\.next|dist|build|out|coverage|\.cache|\.venv|venv)(\/|$)/;

export interface ImportedFile {
  path: string;
  content: string;
  size: number;
}

export async function downloadRepo(
  client: Octokit,
  owner: string,
  repo: string,
  defaultBranch: string
): Promise<{ files: ImportedFile[]; tree: Array<{ path: string; size: number }> }> {
  const { data: treeData } = await client.rest.git.getTree({
    owner,
    repo,
    tree_sha: defaultBranch,
    recursive: "1",
  });
  const entries = (treeData.tree ?? []).filter((e) => e.type === "blob" && e.path);
  if (entries.length > MAX_TREE_ENTRIES) {
    throw new Error("This repository has too many files to analyze automatically.");
  }

  const tree = entries
    .map((e) => ({ path: e.path as string, size: e.size ?? 0 }))
    .filter((f) => !IGNORED_PATHS.test(f.path));

  const totalPkg = tree.filter((f) => f.path === "package.json" || f.path === ".env.example").reduce((a, f) => a + (f.size || 0), 0);

  const keyPaths = findKeyPaths(tree);
  let total = totalPkg;
  const selected: Array<{ path: string; size: number }> = [];
  for (const f of keyPaths) {
    if (total + f.size > MAX_REPO_BYTES) break;
    total += f.size;
    selected.push(f);
  }

  const files: ImportedFile[] = [];
  for (const f of selected) {
    if (f.path === ".env.example") {
      files.push({ path: f.path, content: readEnvExamplePlaceholder(), size: f.size });
      continue;
    }
    const res = await client.rest.repos.getContent({
      owner,
      repo,
      path: f.path,
      ref: defaultBranch,
    });
    const data = res.data as { type?: string; content?: string; size?: number; encoding?: string };
    if (Array.isArray(res.data)) continue;
    if (data.type !== "file" || !data.content) continue;
    const content =
      data.encoding === "base64"
        ? Buffer.from(data.content, "base64").toString("utf8")
        : data.content;
    files.push({ path: f.path, content, size: data.size ?? 0 });
  }

  return { files, tree };
}

function findKeyPaths(tree: Array<{ path: string; size: number }>): Array<{ path: string; size: number }> {
  const preferred = [
    "package.json",
    "package-lock.json",
    "pnpm-lock.yaml",
    "yarn.lock",
    ".env.example",
    "wrangler.toml",
    "wrangler.jsonc",
    "wrangler.json",
    "next.config.js",
    "next.config.mjs",
    "next.config.ts",
    "astro.config.mjs",
    "astro.config.js",
    "vite.config.ts",
    "vite.config.js",
    "tsconfig.json",
    "requirements.txt",
    "pyproject.toml",
    "index.html",
    "public/index.html",
  ];
  const picks: Array<{ path: string; size: number }> = [];
  const picked = new Set<string>();
  for (const p of preferred) {
    const f = tree.find((x) => x.path === p);
    if (f) {
      picked.add(f.path);
      picks.push(f);
    }
  }
  for (const f of tree) {
    if (picked.has(f.path)) continue;
    const lower = f.path;
    if (/^src\/|^lib\/|^app\//.test(lower) && /\.(ts|tsx|js|jsx|mjs|cjs|py)$/.test(f.path)) {
      const rel = lower.split("/").pop() ?? "";
      if (/^(index|main|worker|server|app)\.(ts|tsx|js|jsx|mjs|cjs|py)$/.test(rel)) {
        picked.add(f.path);
        picks.push(f);
        if (picks.length >= 14) break;
      }
    }
  }
  for (const f of tree) {
    if (picked.has(f.path)) continue;
    if (/\.(md|txt)$/.test(f.path) && /^README/i.test(f.path.split("/").pop() ?? "")) {
      picked.add(f.path);
      picks.push(f);
      if (picks.length >= 20) break;
    }
  }
  return picks;
}

function readEnvExamplePlaceholder(): string {
  return "# .env.example — variable names only; values are never read by Launchpad\n";
}

export interface ExistingAuthor {
  name: string;
  email: string;
}

export async function getRepoFileContent(
  client: Octokit,
  owner: string,
  repo: string,
  path: string
): Promise<string | null> {
  try {
    const { data } = await client.rest.repos.getContent({ owner, repo, path });
    if (Array.isArray(data) || !("content" in data) || data.type !== "file") return null;
    return Buffer.from(data.content, "base64").toString("utf8");
  } catch {
    return null;
  }
}

export async function pushFilesToExistingRepo(
  client: Octokit,
  owner: string,
  repo: string,
  files: ScaffoldedFile[],
  author: ExistingAuthor,
  message: string,
  branch: string
): Promise<void> {
  const { data: headRef } = await client.rest.git.getRef({
    owner,
    repo,
    ref: `heads/${branch}`,
  });
  const headCommitSha = headRef.object.sha;
  const { data: headCommit } = await client.rest.git.getCommit({
    owner,
    repo,
    commit_sha: headCommitSha,
  });

  const baseTreeSha = headCommit.tree.sha;
  const blobs: Array<{ path: string; mode: "100644"; type: "blob"; sha: string }> = [];
  for (const file of files) {
    const content = file.binary ? file.content : Buffer.from(file.content, "utf8").toString("base64");
    const { data } = await client.rest.git.createBlob({
      owner,
      repo,
      content,
      encoding: "base64",
    });
    blobs.push({ path: file.path, mode: "100644", type: "blob", sha: data.sha });
  }

  const { data: tree } = await client.rest.git.createTree({
    owner,
    repo,
    base_tree: baseTreeSha,
    tree: blobs,
  });

  const { data: commit } = await client.rest.git.createCommit({
    owner,
    repo,
    message,
    tree: tree.sha,
    parents: [headCommitSha],
    author: { name: author.name, email: author.email },
    committer: { name: author.name, email: author.email },
  });

  await client.rest.git.updateRef({
    owner,
    repo,
    ref: `heads/${branch}`,
    sha: commit.sha,
  });
}
