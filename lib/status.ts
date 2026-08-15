import { createClient, listWorkflowRuns } from "./github";
import { getEnvPat } from "./config";
import { encrypt, decrypt, hasSecretKey } from "./crypto";
import { updateProject, getProject } from "./store";
import type { DeployRun, ProjectStatus, ProjectStatusResult } from "./types";

const patsByProject = new Map<string, string>();

export function hasSecretPersistence(): boolean {
  return hasSecretKey();
}

export async function rememberPat(projectId: string, pat: string): Promise<void> {
  patsByProject.set(projectId, pat);
  if (hasSecretKey()) {
    try {
      const patEnc = await encrypt(pat);
      await updateProject(projectId, { patEnc });
    } catch (err) {
      console.error("Failed to persist GitHub token for project", projectId, err);
    }
  }
}

export async function forgetPat(projectId: string): Promise<void> {
  patsByProject.delete(projectId);
  await updateProject(projectId, { patEnc: undefined });
}

export async function resolvePat(projectId: string): Promise<string | null> {
  const cached = patsByProject.get(projectId);
  if (cached) return cached;

  const project = await getProject(projectId);
  if (project?.patEnc && hasSecretKey()) {
    try {
      const decrypted = await decrypt(project.patEnc);
      patsByProject.set(projectId, decrypted);
      return decrypted;
    } catch {
      // Fall through to env PAT below.
    }
  }

  return await getEnvPat();
}

function mapStatus(run: DeployRun | null, totalRuns: number): ProjectStatus {
  if (!run) return totalRuns > 0 ? "unknown" : "no-runs";
  switch (run.status) {
    case "queued":
      return "queued";
    case "in_progress":
      return "running";
    case "completed":
      if (run.conclusion === "success") return "success";
      if (run.conclusion === "failure") return "failure";
      return (run.conclusion ?? "unknown") as ProjectStatus;
    default:
      return "unknown";
  }
}

export async function getProjectStatus(
  owner: string,
  repo: string,
  pat: string
): Promise<ProjectStatusResult> {
  const client = createClient(pat);
  const runs = await listWorkflowRuns(client, owner, repo, 10);
  const latest = runs[0] ?? null;
  return {
    latest,
    status: mapStatus(latest, runs.length),
    totalRuns: runs.length,
    runs,
  };
}
