import { getProject, updateProject } from "./store";
import { setEnvVar, deleteEnvVar, getCloudflareToken } from "./cf";
import { getDefaultAccountId } from "./config";
import { setEnvVar as setAwsEnvVar, deleteEnvVar as deleteAwsEnvVar, resolveAwsCredentials } from "./aws";
import { encrypt, hasSecretKey } from "./crypto";
import { resolvePat } from "./status";
import { createClient } from "./github";
import { syncPreviewEnvValues } from "./preview";

export async function setProjectEnvVar(
  projectId: string,
  key: string,
  value: string,
  isSecret: boolean
): Promise<string | null> {
  const project = await getProject(projectId);
  if (!project) throw new Error("Project not found.");

  if (project.provider === "aws") {
    const creds = await resolveAwsCredentials(project);
    if (!creds) throw new Error("AWS credentials are not configured for this project.");
    await setAwsEnvVar(project.type, project.name, key, value, isSecret, creds);

    let awsWarning: string | null = null;
    if (hasSecretKey()) {
      try {
        const valueEnc = await encrypt(value);
        const next = (project.envVars ?? []).filter((v) => v.key !== key);
        next.push({ key, kind: isSecret ? "secret" : "text", valueEnc });
        await updateProject(projectId, { envVars: next });
      } catch (err) {
        awsWarning = `Env var set, but its value could not be stored locally: ${(err as Error).message}`;
      }
    }
    return awsWarning;
  }

  const token = getCloudflareToken();
  const accountId = await getDefaultAccountId();
  if (!token || !accountId) {
    throw new Error(
      "Cloudflare credentials are not configured on the server (CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID)."
    );
  }
  await setEnvVar(project.type, project.name, key, value, isSecret, token, accountId);

  let warning: string | null = null;
  if (hasSecretKey()) {
    try {
      const valueEnc = await encrypt(value);
      const next = (project.envVars ?? []).filter((v) => v.key !== key);
      next.push({ key, kind: isSecret ? "secret" : "text", valueEnc });
      await updateProject(projectId, { envVars: next });
      const pat = await resolvePat(projectId);
      if (project.previewEnabled && pat) {
        try {
          await syncPreviewEnvValues(createClient(pat), { ...project, envVars: next });
        } catch (err) {
          warning = `Stored locally, but syncing preview env values failed: ${(err as Error).message}`;
        }
      }
    } catch (err) {
      warning = `Env var set, but its value could not be stored for previews: ${(err as Error).message}`;
    }
  }
  return warning;
}

export async function removeProjectEnvVar(projectId: string, key: string): Promise<void> {
  const project = await getProject(projectId);
  if (!project) throw new Error("Project not found.");

  if (project.provider === "aws") {
    const creds = await resolveAwsCredentials(project);
    if (!creds) throw new Error("AWS credentials are not configured for this project.");
    await deleteAwsEnvVar(project.type, project.name, key, creds);
    if (hasSecretKey()) {
      const next = (project.envVars ?? []).filter((v) => v.key !== key);
      await updateProject(projectId, { envVars: next });
    }
    return;
  }

  const token = getCloudflareToken();
  const accountId = await getDefaultAccountId();
  if (!token || !accountId) {
    throw new Error(
      "Cloudflare credentials are not configured on the server (CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID)."
    );
  }
  await deleteEnvVar(project.type, project.name, key, token, accountId);

  if (hasSecretKey()) {
    const next = (project.envVars ?? []).filter((v) => v.key !== key);
    await updateProject(projectId, { envVars: next });
    const pat = await resolvePat(projectId);
    if (project.previewEnabled && pat) {
      try {
        await syncPreviewEnvValues(createClient(pat), { ...project, envVars: next });
      } catch {
        // best-effort: previews fall back to whatever values are already synced
      }
    }
  }
}
