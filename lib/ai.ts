import { getCloudflareContext } from "@opennextjs/cloudflare";
import type { Detection, DeployPlan, GuidedFix } from "./types";

export interface AiBinding {
  run(model: string, options: { messages?: Array<{ role: string; content: string }>; prompt?: string }): Promise<{ response?: string; result?: unknown }>;
}

let cachedBinding: AiBinding | null | undefined;

export function getAiBinding(): AiBinding | null {
  if (cachedBinding !== undefined) return cachedBinding;
  try {
    const { env } = getCloudflareContext();
    cachedBinding = (env as { AI?: AiBinding }).AI ?? null;
  } catch {
    cachedBinding = null;
  }
  return cachedBinding;
}

export function isAiAvailable(): boolean {
  return getAiBinding() !== null;
}

export const LLM_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";

export class AiUnavailableError extends Error {}

async function runLlm(system: string, user: string): Promise<string> {
  const ai = getAiBinding();
  if (!ai) throw new AiUnavailableError("Cloudflare AI is not configured on this deployment.");
  const res = await ai.run(LLM_MODEL, {
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
  });
  return res?.response ?? "";
}

function extractJson(text: string): string {
  const cleaned = text.trim();
  const fenced = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) return fenced[1].trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start >= 0 && end > start) return cleaned.slice(start, end + 1);
  return cleaned;
}

const ALLOWED_BUILD_PREFIXES = ["npm ", "pnpm ", "yarn ", "bun ", "npx "];
const ALLOWED_DEPLOY_CMDS = ["wrangler", "npx wrangler", "npm run deploy", "pnpm run deploy", "yarn run deploy", "bun run deploy"];

function isSafeBuildCommand(cmd: string): boolean {
  const c = cmd.trim();
  return ALLOWED_BUILD_PREFIXES.some((p) => c.startsWith(p)) && !/&&|;|\||>|<|\$\(|`/g.test(c);
}

function isSafeDeployCommand(cmd: string): boolean {
  const c = cmd.trim();
  return ALLOWED_DEPLOY_CMDS.some((p) => c.startsWith(p)) && !/&&|;|\||>|<|\$\(|`/g.test(c);
}

const MODEL = LLM_MODEL;

export async function generateDeployPlan(detection: Detection, sampleKey: string): Promise<DeployPlan> {
  const system =
    "You are a deployment assistant for Cloudflare. Given a structured analysis of a code repository, " +
    "produce a concise JSON deploy plan. Never suggest arbitrary commands. " +
    'Return strict JSON with keys: buildCommand (string), outputDir (string|null), deployCommand (string), ' +
    'summary (short human explanation), and notes (array of strings). ' +
    "Only use npm/pnpm/yarn/bun install and build commands, and wrangler deploy / wrangler pages deploy for deployCommand. " +
    "If no build step is needed, buildCommand may be an empty string. outputDir is null unless a static build output exists.";

  const user = [
    "Repository analysis:",
    JSON.stringify(
      {
        framework: detection.framework,
        deployKind: detection.deployKind,
        buildCommand: detection.buildCommand,
        outputDir: detection.outputDir,
        runtime: detection.runtime,
        packageManager: detection.packageManager,
        hasLockfile: detection.hasLockfile,
        alreadyHasCloudflareConfig: detection.alreadyHasCloudflareConfig,
        envVarNames: detection.envVars.map((e) => e.key),
      },
      null,
      2
    ),
    "",
    "Key file sample:",
    sampleKey.slice(0, 2000),
    "",
    "Return JSON only.",
  ].join("\n");

  const raw = await runLlm(system, user);
  let parsed: {
    buildCommand?: string;
    outputDir?: string | null;
    deployCommand?: string;
    summary?: string;
    notes?: string[];
  };
  try {
    parsed = JSON.parse(extractJson(raw));
  } catch {
    parsed = {
      buildCommand: detection.buildCommand ?? "",
      outputDir: detection.outputDir ?? null,
      deployCommand: detection.deployKind === "pages" ? "wrangler pages deploy ./out" : "npx wrangler deploy",
      summary: "The AI could not be parsed cleanly; using a safe detected fallback.",
      notes: ["AI output could not be parsed; using safely detected build/deploy defaults."],
    };
  }

  let buildCommand = (parsed.buildCommand ?? "").trim();
  if (buildCommand && !isSafeBuildCommand(buildCommand)) {
    buildCommand = detection.buildCommand ?? "";
  }

  let deployCommand = (parsed.deployCommand ?? "").trim().replace("__PROJECT_NAME__", "");
  if (!deployCommand || !isSafeDeployCommand(deployCommand)) {
    deployCommand =
      detection.deployKind === "pages"
        ? `wrangler pages deploy ${(parsed.outputDir ?? detection.outputDir ?? "dist").trim() || "."}`
        : "npx wrangler deploy";
  }

  const outputDir = parsed.outputDir ?? detection.outputDir ?? null;
  const summary =
    (parsed.summary ?? "").trim() ||
    `Detected ${detection.framework ?? "app"} (${detection.deployKind}) and prepared a Cloudflare ${detection.deployKind === "pages" ? "Pages" : "Workers"} deploy.`;

  return {
    deployKind: detection.deployKind,
    framework: detection.framework,
    buildCommand,
    outputDir,
    deployCommand,
    packageManager: detection.packageManager,
    runtime: detection.runtime,
    envVars: detection.envVars,
    alreadyHasCloudflareConfig: detection.alreadyHasCloudflareConfig,
    summary,
    notes: Array.isArray(parsed.notes) ? parsed.notes : [],
    model: MODEL,
  };
}

export async function generateGuidedFix(detection: Detection): Promise<GuidedFix> {
  const system =
    "You are a deployment assistant. A repository is not directly deployable to Cloudflare Workers/Pages " +
    "as-is. Produce a short, concrete instruction a non-technical user can paste back into their AI coding " +
    "tool to make the project deployable. Return strict JSON with keys: reason (string), instruction (string), " +
    "and effort (one of: easy|medium|hard).";

  const user = [
    "Repository analysis:",
    JSON.stringify(
      {
        framework: detection.framework,
        deployKind: detection.deployKind,
        runtime: detection.runtime,
        blockers: detection.blockers,
        serverOnlyDeps: detection.serverOnlyDeps,
      },
      null,
      2
    ),
    "",
    "Return JSON only.",
  ].join("\n");

  try {
    const raw = await runLlm(system, user);
    let parsed: { reason?: string; instruction?: string; effort?: string };
    try {
      parsed = JSON.parse(extractJson(raw));
    } catch {
      parsed = { reason: "Unknown.", instruction: "Ask your AI tool to make this project deployable to Cloudflare.", effort: "medium" };
    }
    return {
      reason: parsed.reason || "This project uses patterns that Cloudflare Workers/Pages cannot host as-is.",
      instruction:
        parsed.instruction ||
        "Ask your AI tool to convert this project so it runs on Cloudflare Workers or Pages.",
      effort: (["easy", "medium", "hard"] as const).includes(parsed.effort as "easy") ? (parsed.effort as "easy" | "medium" | "hard") : "medium",
    };
  } catch (err) {
    if (err instanceof AiUnavailableError) throw err;
    return {
      reason: "This project uses patterns that Cloudflare Workers/Pages cannot host as-is.",
      instruction:
        "Ask your AI tool to convert this project so it runs on Cloudflare Workers or Pages. The detector found it depends on " +
        (detection.blockers.join(", ") || "server-only runtime"),
      effort: "medium",
    };
  }
}

export async function explainFailure(logTail: string, detection: Detection | null): Promise<string> {
  const system =
    "You are a deployment assistant. Given the tail of a failed deploy log and optional repo analysis, " +
    "explain in one short paragraph, in plain language for a non-technical user, what likely went wrong " +
    "and what to try next.";

  const user = [
    "Optional repo analysis:",
    detection ? JSON.stringify({ framework: detection.framework, deployKind: detection.deployKind }) : "none",
    "",
    "Failed log tail (last 4000 chars):",
    logTail.slice(-4000),
    "",
    "Respond in plain text only.",
  ].join("\n");

  try {
    return (await runLlm(system, user)).trim() || "The deploy failed; check the GitHub Actions log for details.";
  } catch {
    return "The deploy failed. Open the run in GitHub Actions to see the exact error.";
  }
}
