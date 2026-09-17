import { encrypt, hasSecretKey } from "./crypto";
import {
  findScaffoldWrangler,
  parseBindings,
  renderBindings,
  ensureResource,
  ensureAiSearch,
  validateBindingName,
  validateResourceName,
} from "./bindings";
import type { ScaffoldedFile } from "./scaffold";
import type { Binding, LaunchConfig, StoredEnvVar } from "./types";

const ENV_KEY_REGEX = /^[A-Za-z_][A-Za-z0-9_]*$/;

export async function applyLaunchConfig(
  files: ScaffoldedFile[],
  cfg: LaunchConfig | undefined,
  token: string,
  accountId: string
): Promise<StoredEnvVar[]> {
  if (!cfg) return [];

  const bindings = cfg.bindings ?? [];
  const envVars = cfg.envVars ?? [];

  if (!hasSecretKey() && (bindings.length > 0 || envVars.length > 0)) {
    throw new Error(
      "Configuring resources at launch requires LAUNCHPAD_SECRET to be set, so encrypted values can be stored."
    );
  }

  const storedEnvVars: StoredEnvVar[] = [];

  if (bindings.length > 0) {
    const ref = findScaffoldWrangler(files);
    if (!ref) {
      throw new Error(
        "This template has no wrangler config (wrangler.toml / wrangler.jsonc), so bindings can't be added."
      );
    }
    const target = files.find((f) => f.path === ref.path);
    if (!target) {
      throw new Error(`Wrangler config "${ref.path}" was not found in the scaffold.`);
    }
    const existing = parseBindings(target.content, ref.kind);
    const next: Binding[] = [...existing];

    for (const b of bindings) {
      const nameError = validateBindingName(b.name);
      if (nameError) throw new Error(nameError);
      const resourceError = validateResourceName(b.type, b.resource);
      if (resourceError) throw new Error(resourceError);
      const bindingName = b.name.trim();
      const resourceName = b.resource.trim();
      if (next.some((x) => x.name === bindingName)) {
        throw new Error(`A binding named "${bindingName}" already exists.`);
      }
      if (b.type === "ai_search") {
        const instance = await ensureAiSearch(token, accountId, resourceName);
        next.push({
          type: "ai_search",
          name: bindingName,
          resource: instance.name,
          id: instance.id,
        });
      } else {
        const res = await ensureResource(b.type, resourceName, token, accountId);
        next.push({ type: b.type, name: bindingName, resource: res.name, id: res.id ?? resourceName });
      }
    }

    target.content = renderBindings(target.content, ref.kind, next);
  }

  if (envVars.length > 0) {
    const seen = new Set<string>();
    for (const v of envVars) {
      const key = v.key.trim();
      if (!key) throw new Error("Environment variable keys cannot be empty.");
      if (!ENV_KEY_REGEX.test(key)) {
        throw new Error(`Environment variable key "${key}" is invalid (use [A-Za-z_][A-Za-z0-9_]*).`);
      }
      if (seen.has(key)) throw new Error(`Environment variable "${key}" is defined more than once.`);
      seen.add(key);
      storedEnvVars.push({
        key,
        kind: v.kind,
        valueEnc: await encrypt(v.value ?? ""),
      });
    }
  }

  return storedEnvVars;
}