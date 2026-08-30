import { resolvePat } from "./status";
import { createClient, deleteRepo } from "./github";
import { deleteCloudflareProject } from "./cf";
import { deleteAwsProject, resolveAwsCredentials } from "./aws";
import type { Project } from "./types";

export interface DeleteProjectOptions {
  deleteRepo?: boolean;
  deleteCloudflare?: boolean;
  deleteAws?: boolean;
}

export interface DeleteProjectResult {
  repoDeleted: boolean;
  cloudflareDeleted: boolean;
  awsDeleted: boolean;
  warnings: string[];
}

export async function deleteProjectResources(
  project: Project,
  options: DeleteProjectOptions
): Promise<DeleteProjectResult> {
  const {
    deleteRepo: requestedRepo = !project.imported,
    deleteCloudflare: removeCf = true,
    deleteAws: removeAws = true,
  } = options;
  const warnings: string[] = [];
  let repoDeleted = false;
  let cloudflareDeleted = false;
  let awsDeleted = false;

  // Imported projects keep their GitHub source repo by default; the caller can
  // opt in to deleting it explicitly via deleteRepo: true.
  const removeRepo = options.deleteRepo !== undefined ? options.deleteRepo : requestedRepo;

  if (removeRepo) {
    const pat = await resolvePat(project.id);
    if (pat) {
      try {
        await deleteRepo(createClient(pat), project.owner, project.repo);
        repoDeleted = true;
      } catch (err) {
        warnings.push(`GitHub repo not deleted: ${(err as Error).message}`);
      }
    } else {
      warnings.push("GitHub repo not deleted: no token available for this project.");
    }
  }

  if (removeCf && project.provider === "cloudflare") {
    const token = process.env.CLOUDFLARE_API_TOKEN?.trim();
    const accountId = process.env.CLOUDFLARE_ACCOUNT_ID?.trim();
    if (token && accountId) {
      try {
        await deleteCloudflareProject(project.type, project.name, token, accountId);
        cloudflareDeleted = true;
      } catch (err) {
        warnings.push((err as Error).message);
      }
    } else {
      warnings.push("Cloudflare project not deleted: CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID not set.");
    }
  }

  if (removeAws && project.provider === "aws") {
    const creds = await resolveAwsCredentials(project);
    if (creds) {
      try {
        await deleteAwsProject(project.type, project.name, creds);
        awsDeleted = true;
      } catch (err) {
        warnings.push((err as Error).message);
      }
    } else {
      warnings.push("AWS project not deleted: no AWS credentials configured for this project.");
    }
  }

  return { repoDeleted, cloudflareDeleted, awsDeleted, warnings };
}
