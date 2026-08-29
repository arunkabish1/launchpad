import { Octokit } from "@octokit/rest";
import { getTemplate } from "./templates";
import { upsertRepoFile, deleteRepoFile } from "./preview";
import { getProvisionScript } from "./template-assets";
import type { Project, TemplateInfo } from "./types";

const PROVISION_SCRIPT_REPO_PATH = ".launchpad/provision.mjs";
const DEPLOY_WORKFLOW_PATH = ".github/workflows/deploy.yml";
const PROVISION_STEP_MARKER = "- name: Provision resources";

const PROVISION_STEP = `      - name: Provision resources
        if: hashFiles('.launchpad/provision.mjs') != ''
        run: node .launchpad/provision.mjs
        env:
          CLOUDFLARE_API_TOKEN: \${{ secrets.CLOUDFLARE_API_TOKEN }}
          CLOUDFLARE_ACCOUNT_ID: \${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
          LP_ENV_MASTER_KEY: \${{ secrets.LP_ENV_MASTER_KEY }}
`;

export function readProvisionScript(): string {
  return getProvisionScript();
}

async function readRepoText(
  client: Octokit,
  owner: string,
  repo: string,
  filePath: string
): Promise<string | null> {
  try {
    const res = await client.rest.repos.getContent({ owner, repo, path: filePath });
    const data = res.data as { content?: string; encoding?: string };
    if (data.content && data.encoding === "base64") {
      return Buffer.from(data.content, "base64").toString("utf8");
    }
    return null;
  } catch {
    return null;
  }
}

export function addProvisionStep(workflow: string): string {
  if (workflow.includes(PROVISION_STEP_MARKER)) return workflow;
  const anchor = "      - name: Deploy to Cloudflare";
  const idx = workflow.indexOf(anchor);
  if (idx === -1) return workflow;
  const before = workflow.slice(0, idx);
  const after = workflow.slice(idx);
  return before + PROVISION_STEP + after;
}

export function removeProvisionStep(workflow: string): string {
  const startMarker = "      - name: Provision resources\n";
  const start = workflow.indexOf(startMarker);
  if (start === -1) return workflow;
  let end = start + startMarker.length;
  const lines = workflow.slice(end).split("\n");
  let consumed = 0;
  for (const line of lines) {
    if (line.trim() === "") {
      consumed += 1;
      continue;
    }
    if (line.startsWith("      - ")) break;
    if (line.length > 0 && line[0] === "-") break;
    consumed += 1;
  }
  end += lines.slice(0, consumed).join("\n").length;
  end += consumed > 0 ? 1 : 0;
  return workflow.slice(0, start) + workflow.slice(end);
}

export async function commitProvisionFiles(
  client: Octokit,
  project: Project
): Promise<void> {
  await upsertRepoFile(
    client,
    project.owner,
    project.repo,
    PROVISION_SCRIPT_REPO_PATH,
    readProvisionScript(),
    "Enable provisioning from code via Launchpad"
  );
  const workflow = await readRepoText(client, project.owner, project.repo, DEPLOY_WORKFLOW_PATH);
  if (workflow === null) return;
  const patched = addProvisionStep(workflow);
  if (patched !== workflow) {
    await upsertRepoFile(
      client,
      project.owner,
      project.repo,
      DEPLOY_WORKFLOW_PATH,
      patched,
      "Add resource provisioning step via Launchpad"
    );
  }
}

export async function removeProvisionFiles(
  client: Octokit,
  project: Project
): Promise<void> {
  await deleteRepoFile(
    client,
    project.owner,
    project.repo,
    PROVISION_SCRIPT_REPO_PATH,
    "Disable provisioning from code via Launchpad"
  );
  const workflow = await readRepoText(client, project.owner, project.repo, DEPLOY_WORKFLOW_PATH);
  if (workflow === null) return;
  const patched = removeProvisionStep(workflow);
  if (patched !== workflow) {
    await upsertRepoFile(
      client,
      project.owner,
      project.repo,
      DEPLOY_WORKFLOW_PATH,
      patched,
      "Remove resource provisioning step via Launchpad"
    );
  }
}

export async function provisioningEnabled(
  client: Octokit,
  project: Project
): Promise<boolean> {
  if (project.type === "pages") return false;
  const script = await readRepoText(client, project.owner, project.repo, PROVISION_SCRIPT_REPO_PATH);
  return script !== null;
}

export function templateForProvision(project: Project): TemplateInfo {
  const found = getTemplate(project.templateId);
  if (found) return found;
  return {
    id: project.templateId,
    name: project.templateName,
    description: "",
    type: "worker",
    provider: "cloudflare",
    category: "javascript",
    deployCommand: "deploy",
    buildCommand: "",
    requiresRoute: false,
    files: [],
    source: "local",
  };
}
