import crypto from "node:crypto";
import {
  createClient,
  validatePat,
  getUser,
  createRepo,
  deleteRepo,
  setRepoSecret,
  pushScaffoldToRepo,
  requiredScopes,
} from "./github";
import { buildScaffoldFiles, type ScaffoldedFile } from "./scaffold";
import { getTemplate } from "./templates";
import { getEnvPat, getDefaultAccountId, getDefaultAwsRegion, getOrgName } from "./config";
import { getWorkersSubdomain, buildLiveUrl } from "./cf";
import { addProject } from "./store";
import { rememberPat } from "./status";
import { recordAudit } from "./audit";
import { encrypt, hasSecretKey } from "./crypto";
import { renderPreviewWorkflow, renderDeployWorkflow } from "./workflow";
import { getPreviewScript, getProvisionScript } from "./template-assets";
import { encryptEnvValues } from "./preview";
import type { LaunchRequest, Project } from "./types";

const NAME_REGEX = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;
const LOCKFILES = new Set(["package-lock.json", "npm-shrinkwrap.json", "yarn.lock", "pnpm-lock.yaml"]);

export class LaunchError extends Error {}

export function validateProjectName(name: string): string {
  const trimmed = (name ?? "").trim().toLowerCase();
  if (!trimmed) throw new LaunchError("Project name is required.");
  if (trimmed.length > 40) {
    throw new LaunchError("Project name must be 40 characters or fewer.");
  }
  if (!NAME_REGEX.test(trimmed)) {
    throw new LaunchError(
      "Project name may only contain lowercase letters, numbers, and hyphens (e.g. my-api)."
    );
  }
  return trimmed;
}

export async function launchProject(request: LaunchRequest): Promise<Project> {
  const template = getTemplate(request.templateId);
  if (!template) throw new LaunchError(`Template "${request.templateId}" not found.`);

  const projectName = validateProjectName(request.projectName);
  const route = request.route?.trim() || null;
  const org = await getOrgName();

  const pat = (request.githubPat ?? "").trim() || (await getEnvPat());
  if (!pat) throw new LaunchError("A GitHub Personal Access Token is required.");

  const provider = template.provider;

  let cloudflareToken = "";
  let accountId = "";
  let awsAccessKey = "";
  let awsSecretKey = "";
  let awsRegion = "";

  if (provider === "aws") {
    awsAccessKey = (request.awsAccessKey ?? "").trim() || process.env.AWS_ACCESS_KEY_ID || "";
    awsSecretKey = (request.awsSecretKey ?? "").trim() || process.env.AWS_SECRET_ACCESS_KEY || "";
    if (!awsAccessKey || !awsSecretKey) {
      throw new LaunchError("AWS access key and secret key are required.");
    }
    awsRegion = (request.awsRegion ?? "").trim() || (await getDefaultAwsRegion());
  } else {
    cloudflareToken = (request.cloudflareToken ?? "").trim() || process.env.CLOUDFLARE_API_TOKEN || "";
    if (!cloudflareToken) throw new LaunchError("A Cloudflare API token is required.");
    accountId = (request.accountId ?? "").trim() || (await getDefaultAccountId());
    if (!accountId) throw new LaunchError("A Cloudflare account ID is required.");
  }

  const previewMasterKey =
    template.type === "worker" ? crypto.randomBytes(32).toString("base64") : null;

  const files = buildScaffoldFiles(template, { projectName, route });
  const hasLockfile = files.some((f) => LOCKFILES.has(f.path.split("/").pop() ?? ""));

  if (!files.some((f) => f.path === ".github/workflows/deploy.yml")) {
    files.push({
      path: ".github/workflows/deploy.yml",
      content: renderDeployWorkflow(template, {
        projectName,
        hasLockfile,
        provision: template.type !== "pages",
      }),
    });
  }

  if (previewMasterKey) {
    const injected: ScaffoldedFile[] = [
      {
        path: ".launchpad/preview.mjs",
        content: getPreviewScript(),
      },
      {
        path: ".launchpad/provision.mjs",
        content: getProvisionScript(),
      },
      {
        path: ".github/workflows/preview.yml",
        content: renderPreviewWorkflow(template, { projectName, hasLockfile }),
      },
    ];
    if (hasSecretKey()) {
      injected.push({
        path: ".launchpad/env-values.enc",
        content: await encryptEnvValues({}, previewMasterKey),
      });
    }
    files.push(...injected);
  } else if (provider === "aws" && template.type === "amplify") {
    files.push({
      path: ".github/workflows/preview.yml",
      content: renderPreviewWorkflow(template, { projectName, hasLockfile }),
    });
  }

  try {
    const client = createClient(pat);

    const { scopes } = await validatePat(client).catch(() => ({ scopes: null as string[] | null }));
    if (scopes) {
      const missing = requiredScopes().filter((s) => !scopes.includes(s));
      if (missing.length > 0) {
        throw new LaunchError(
          `Your GitHub token is missing the ${missing.join(" and ")} scope(s). ` +
            `Recreate the token with repo + workflow scopes.`
        );
      }
    }

    const user = await getUser(client);

    let repoInfo;
    try {
      repoInfo = await createRepo(client, projectName, request.private ?? true, org);
    } catch (err) {
      const status = (err as { status?: number }).status;
      if (status === 422) {
        throw new LaunchError(
          `GitHub repo "${projectName}" already exists. Choose a different project name.`
        );
      }
      if (status === 401 || status === 403 || status === 404) {
        throw new LaunchError(
          org
            ? `GitHub rejected the token for org "${org}". Make sure the org exists and that the token can create repositories in it (repo + workflow scopes).`
            : "GitHub rejected the token. Make sure it's valid and has repo + workflow scopes."
        );
      }
      throw err;
    }

    try {
      if (provider === "aws") {
        await setRepoSecret(client, repoInfo.owner, repoInfo.repo, "AWS_ACCESS_KEY_ID", awsAccessKey);
        await setRepoSecret(client, repoInfo.owner, repoInfo.repo, "AWS_SECRET_ACCESS_KEY", awsSecretKey);
        await setRepoSecret(client, repoInfo.owner, repoInfo.repo, "AWS_REGION", awsRegion);
      } else {
        await setRepoSecret(client, repoInfo.owner, repoInfo.repo, "CLOUDFLARE_API_TOKEN", cloudflareToken);
        await setRepoSecret(client, repoInfo.owner, repoInfo.repo, "CLOUDFLARE_ACCOUNT_ID", accountId);
        if (previewMasterKey) {
          await setRepoSecret(client, repoInfo.owner, repoInfo.repo, "LP_ENV_MASTER_KEY", previewMasterKey);
        }
      }

      await pushScaffoldToRepo(client, repoInfo.owner, repoInfo.repo, files, user);
    } catch (err) {
      try {
        await deleteRepo(client, repoInfo.owner, repoInfo.repo);
      } catch {
        // Best-effort cleanup; surface the original error below.
      }
      throw new LaunchError(
        `Failed to prepare the repo "${repoInfo.owner}/${repoInfo.repo}" (it was deleted again). ${(err as Error).message}`
      );
    }

    let workersSubdomain: string | null = null;
    let liveUrl: string | null = null;
    if (provider === "aws") {
      liveUrl = null; // resolved lazily from the deployed stack / Amplify app
    } else {
      try {
        workersSubdomain = await getWorkersSubdomain(cloudflareToken, accountId);
      } catch {
        // Best effort: without the subdomain we just skip the live URL for workers.
      }
      liveUrl = buildLiveUrl(template.type, projectName, workersSubdomain);
    }

    const previewKeyEnc =
      previewMasterKey && hasSecretKey()
        ? await encrypt(previewMasterKey).catch(() => undefined)
        : undefined;

    const awsAccessKeyEnc =
      provider === "aws" && hasSecretKey()
        ? await encrypt(awsAccessKey).catch(() => undefined)
        : undefined;
    const awsSecretKeyEnc =
      provider === "aws" && hasSecretKey()
        ? await encrypt(awsSecretKey).catch(() => undefined)
        : undefined;

    const project: Project = {
      id: crypto.randomUUID(),
      name: projectName,
      templateId: template.id,
      templateName: template.name,
      type: template.type,
      provider: template.provider,
      route,
      owner: repoInfo.owner,
      repo: repoInfo.repo,
      githubUrl: repoInfo.htmlUrl,
      createdAt: new Date().toISOString(),
      liveUrl,
      previewEnabled: template.type === "worker" || (provider === "aws" && template.type === "amplify"),
      ...(previewKeyEnc ? { previewKeyEnc } : {}),
      ...(provider === "aws" ? { awsRegion } : {}),
      ...(awsAccessKeyEnc ? { awsAccessKeyEnc } : {}),
      ...(awsSecretKeyEnc ? { awsSecretKeyEnc } : {}),
    };

    await addProject(project);
    await rememberPat(project.id, pat);

    recordAudit({
      actor: request.actor ?? "admin",
      action: "launch",
      project: projectName,
      detail: `${template.name} → ${org ? `${org}/` : ""}${projectName} (${project.type})`,
      outcome: "ok",
    });

    return project;
  } catch (err) {
    if (err instanceof LaunchError) {
      recordAudit({
        actor: request.actor ?? "admin",
        action: "launch_failed",
        project: projectName,
        detail: err.message,
        outcome: "error",
      });
    }
    throw err;
  }
}
