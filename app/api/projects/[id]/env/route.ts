import { NextRequest, NextResponse } from "next/server";
import { getProject } from "@/lib/store";
import { listEnvVars, getCloudflareToken } from "@/lib/cf";
import { getDefaultAccountId } from "@/lib/config";
import { requireAuth, authRequiredResponse, verifyOrigin } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";
import { setProjectEnvVar } from "@/lib/envops";

export const runtime = "nodejs";

function missingCfCredentials(): NextResponse {
  return NextResponse.json(
    {
      error: "Cloudflare credentials are not configured on the server (CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID).",
    },
    { status: 400 }
  );
}

export async function GET(req: NextRequest, ctx: RouteContext<"/api/projects/[id]/env">) {
  const auth = requireAuth(req);
  if (!auth.ok) return authRequiredResponse();

  const { id } = await ctx.params;
  const project = await getProject(id);
  if (!project) {
    return NextResponse.json({ error: "Project not found." }, { status: 404 });
  }

  const token = getCloudflareToken();
  const accountId = await getDefaultAccountId();
  if (!token || !accountId) return missingCfCredentials();

  try {
    const env = await listEnvVars(project.type, project.name, token, accountId);
    return NextResponse.json({ env });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

export async function POST(req: NextRequest, ctx: RouteContext<"/api/projects/[id]/env">) {
  const auth = requireAuth(req);
  if (!auth.ok) return authRequiredResponse();
  if (!verifyOrigin(req)) {
    return NextResponse.json({ error: "Cross-origin request rejected." }, { status: 403 });
  }

  const { id } = await ctx.params;
  const project = await getProject(id);
  if (!project) {
    return NextResponse.json({ error: "Project not found." }, { status: 404 });
  }

  let body: { key?: string; value?: string; secret?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const key = body.key?.trim();
  if (!key || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
    return NextResponse.json({ error: "Env var key must match [A-Za-z_][A-Za-z0-9_]*" }, { status: 400 });
  }
  if (typeof body.value !== "string" || body.value.length === 0) {
    return NextResponse.json({ error: "Env var value is required." }, { status: 400 });
  }

  try {
    const warning = await setProjectEnvVar(id, key, body.value, body.secret !== false);

    recordAudit({
      actor: auth.actor,
      action: "env_set",
      project: project.name,
      detail: `${key} (${body.secret !== false ? "secret" : "text"})`,
      outcome: "ok",
    });
    return NextResponse.json({ ok: true, warning });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
