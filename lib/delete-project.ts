import { resolvePat } from "./status";
import { createClient, deleteRepo } from "./github";
import { deleteCloudflareProject } from "./cf";
import type { Project } from "./types";

export interface DeleteProjectOptions {
  deleteRepo?: boolean;
  deleteCloudflare?: boolean;
}

export interface DeleteProjectResult {
  repoDeleted: boolean;
  cloudflareDeleted: boolean;
  warnings: string[];
}

export async function deleteProjectResources(
  project: Project,
  options: DeleteProjectOptions
): Promise<DeleteProjectResult> {
  const { deleteRepo: removeRepo = true, deleteCloudflare: removeCf = true } = options;
  const warnings: string[] = [];
  let repoDeleted = false;
  let cloudflareDeleted = false;

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

  if (removeCf) {
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

  return { repoDeleted, cloudflareDeleted, warnings };
}
