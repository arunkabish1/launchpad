import { getCloudflareToken } from "./cf";
import { getDefaultAccountId } from "./config";
import { decrypt, hasSecretKey } from "./crypto";
import { setProjectEnvVar } from "./envops";
import { updateProject } from "./store";
import { recordAudit } from "./audit";
import type { Project, ProjectStatusResult } from "./types";

export async function applyPendingConfig(
  project: Project,
  status: ProjectStatusResult
): Promise<void> {
  if (project.provider !== "cloudflare") return;
  if (project.configApplied) return;

  if (!project.envVars?.length) {
    await updateProject(project.id, { configApplied: true }).catch(() => {});
    return;
  }

  if (status.status !== "success") return;

  const token = getCloudflareToken();
  const accountId = await getDefaultAccountId();
  if (!token || !accountId || !hasSecretKey()) return;

  let allApplied = true;
  for (const v of project.envVars) {
    if (!v.valueEnc) continue;
    try {
      const value = await decrypt(v.valueEnc);
      await setProjectEnvVar(project.id, v.key, value, v.kind === "secret");
    } catch (err) {
      allApplied = false;
      console.error("Failed to apply queued env var", project.id, v.key, err);
    }
  }

  if (!allApplied) return;

  await updateProject(project.id, { configApplied: true });
  recordAudit({
    actor: "system",
    action: "config_applied",
    project: project.name,
    detail: `Applied ${project.envVars.length} queued environment variable(s) after the first successful deploy`,
    outcome: "ok",
  });
}