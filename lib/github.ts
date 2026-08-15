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
