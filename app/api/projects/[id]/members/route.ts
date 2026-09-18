import { NextRequest, NextResponse } from "next/server";
import { getProject } from "@/lib/store";
import { requireAuth, authRequiredResponse, verifyOrigin } from "@/lib/auth";
import { listMembershipsForProject, requireProjectRole } from "@/lib/membership";
import { createInvite, inviteState, listInvitesForProject } from "@/lib/invites";
import { recordAudit } from "@/lib/audit";
import type { ProjectRole } from "@/lib/types";

export const runtime = "nodejs";

export async function GET(req: NextRequest, ctx: RouteContext<"/api/projects/[id]/members">) {
  const auth = requireAuth(req);
  if (!auth.ok) return authRequiredResponse();

  const { id } = await ctx.params;
  const project = await getProject(id);
  if (!project) {
    return NextResponse.json({ error: "Project not found." }, { status: 404 });
  }

  const access = await requireProjectRole(auth.user, id, "member");
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: 403 });
  }

  const members = await listMembershipsForProject(id);
  const canManage = access.role === "owner";
  const invites = canManage
    ? (await listInvitesForProject(id)).map((inv) => ({
        tokenHash: inv.tokenHash,
        role: inv.role,
        createdBy: inv.createdBy,
        createdAt: inv.createdAt,
        expiresAt: inv.expiresAt,
        state: inviteState(inv),
      }))
    : [];

  return NextResponse.json({
    members,
    invites,
    role: access.role,
    canManage,
    project: { id: project.id, name: project.name, owner: project.owner, repo: project.repo },
  });
}

export async function POST(req: NextRequest, ctx: RouteContext<"/api/projects/[id]/members">) {
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

  const access = await requireProjectRole(auth.user, id, "owner");
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: 403 });
  }

  let body: { role?: string } = {};
  try {
    body = await req.json();
  } catch {
    // Defaults apply.
  }
  const role: ProjectRole = body.role === "owner" ? "owner" : "member";

  const { token, invite } = await createInvite({
    projectId: project.id,
    projectName: project.name,
    role,
    createdBy: auth.actor,
  });

  const origin = req.headers.get("origin") || new URL(req.url).origin;
  const url = `${origin.replace(/\/$/, "")}/invite/${token}`;

  recordAudit({
    actor: auth.actor,
    action: "invite_create",
    project: project.name,
    detail: `${role} invite created`,
    outcome: "ok",
  });

  return NextResponse.json(
    { ok: true, token, url, role: invite.role, expiresAt: invite.expiresAt },
    { status: 201 }
  );
}
