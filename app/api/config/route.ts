import { NextRequest, NextResponse } from "next/server";
import { getConfig, saveConfig, getConfigStatus } from "@/lib/config";
import { requireAuth, authRequiredResponse, verifyOrigin } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const auth = requireAuth(req);
  if (!auth.ok) return authRequiredResponse();
  return NextResponse.json({ status: await getConfigStatus() });
}

export async function PATCH(req: NextRequest) {
  const auth = requireAuth(req);
  if (!auth.ok) return authRequiredResponse();
  if (!verifyOrigin(req)) {
    return NextResponse.json({ error: "Cross-origin request rejected." }, { status: 403 });
  }

  let body: { defaultAccountId?: string; patEnvVar?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const config = await getConfig();
  if (body.defaultAccountId !== undefined) {
    config.cloudflare.defaultAccountId = body.defaultAccountId.trim();
  }
  if (body.patEnvVar !== undefined) {
    config.github.patEnvVar = body.patEnvVar.trim() || "GITHUB_PAT";
  }

  await saveConfig(config);
  recordAudit({
    actor: auth.actor,
    action: "env_set",
    project: "-",
    detail: "Updated launchpad config",
    outcome: "ok",
  });
  return NextResponse.json({ ok: true, status: await getConfigStatus() });
}
