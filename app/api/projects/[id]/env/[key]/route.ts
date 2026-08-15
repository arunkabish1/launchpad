import { NextRequest, NextResponse } from "next/server";
import { getProject } from "@/lib/store";
import { requireAuth, authRequiredResponse, verifyOrigin } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";
import { removeProjectEnvVar } from "@/lib/envops";

export const runtime = "nodejs";

export async function DELETE(
  req: NextRequest,
  ctx: RouteContext<"/api/projects/[id]/env/[key]">
) {
  const auth = requireAuth(req);
  if (!auth.ok) return authRequiredResponse();
  if (!verifyOrigin(req)) {
    return NextResponse.json({ error: "Cross-origin request rejected." }, { status: 403 });
  }

  const { id, key } = await ctx.params;
  const project = await getProject(id);
  if (!project) {
    return NextResponse.json({ error: "Project not found." }, { status: 404 });
  }

  try {
    await removeProjectEnvVar(id, key);

    recordAudit({
      actor: auth.actor,
      action: "env_delete",
      project: project.name,
      detail: key,
      outcome: "ok",
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
