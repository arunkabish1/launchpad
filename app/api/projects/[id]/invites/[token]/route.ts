import { NextRequest, NextResponse } from "next/server";
import { getProject } from "@/lib/store";
import { requireAuth, authRequiredResponse, verifyOrigin } from "@/lib/auth";
import { requireProjectRole } from "@/lib/membership";
import { revokeInviteByHash } from "@/lib/invites";
import { recordAudit } from "@/lib/audit";

export const runtime = "nodejs";

export async function DELETE(
  req: NextRequest,
  ctx: RouteContext<"/api/projects/[id]/invites/[token]">
) {
  const auth = requireAuth(req);
  if (!auth.ok) return authRequiredResponse();
  if (!verifyOrigin(req)) {
    return NextResponse.json({ error: "Cross-origin request rejected." }, { status: 403 });
  }

  const { id, token } = await ctx.params;
  const project = await getProject(id);
  if (!project) {
    return NextResponse.json({ error: "Project not found." }, { status: 404 });
  }

  const access = await requireProjectRole(auth.user, id, "owner");
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: 403 });
  }

  const revoked = await revokeInviteByHash(id, token);
  if (!revoked) {
    return NextResponse.json({ error: "Invite not found." }, { status: 404 });
  }

  recordAudit({
    actor: auth.actor,
    action: "invite_revoke",
    project: project.name,
    detail: "Invite revoked",
    outcome: "ok",
  });

  return NextResponse.json({ ok: true });
}
