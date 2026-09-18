import { NextRequest, NextResponse } from "next/server";
import { getProject } from "@/lib/store";
import { requireAuth, authRequiredResponse, verifyOrigin } from "@/lib/auth";
import {
  countProjectOwners,
  getMembership,
  requireProjectRole,
  removeProjectMember,
  syncGithubCollaborator,
  updateMembershipRole,
} from "@/lib/membership";
import { recordAudit } from "@/lib/audit";
import type { ProjectRole } from "@/lib/types";

export const runtime = "nodejs";

export async function PATCH(
  req: NextRequest,
  ctx: RouteContext<"/api/projects/[id]/members/[userId]">
) {
  const auth = requireAuth(req);
  if (!auth.ok) return authRequiredResponse();
  if (!verifyOrigin(req)) {
    return NextResponse.json({ error: "Cross-origin request rejected." }, { status: 403 });
  }

  const { id, userId } = await ctx.params;
  const project = await getProject(id);
  if (!project) {
    return NextResponse.json({ error: "Project not found." }, { status: 404 });
  }

  const access = await requireProjectRole(auth.user, id, "owner");
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: 403 });
  }

  const membership = await getMembership(id, userId);
  if (!membership) {
    return NextResponse.json({ error: "Member not found." }, { status: 404 });
  }

  let body: { role?: string } = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const role: ProjectRole = body.role === "owner" ? "owner" : "member";

  if (membership.role === "owner" && role === "member") {
    const owners = await countProjectOwners(id);
    if (owners <= 1) {
      return NextResponse.json(
        { error: "A project must keep at least one owner." },
        { status: 400 }
      );
    }
  }

  await updateMembershipRole(id, userId, role);
  // Re-sync the GitHub collaborator permission to match the new role.
  await syncGithubCollaborator(id, userId, "add").catch(() => {});

  recordAudit({
    actor: auth.actor,
    action: "member_role_change",
    project: project.name,
    detail: `${membership.username} → ${role}`,
    outcome: "ok",
  });

  return NextResponse.json({ ok: true, role });
}

export async function DELETE(
  req: NextRequest,
  ctx: RouteContext<"/api/projects/[id]/members/[userId]">
) {
  const auth = requireAuth(req);
  if (!auth.ok) return authRequiredResponse();
  if (!verifyOrigin(req)) {
    return NextResponse.json({ error: "Cross-origin request rejected." }, { status: 403 });
  }

  const { id, userId } = await ctx.params;
  const project = await getProject(id);
  if (!project) {
    return NextResponse.json({ error: "Project not found." }, { status: 404 });
  }

  const access = await requireProjectRole(auth.user, id, "owner");
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: 403 });
  }

  const membership = await getMembership(id, userId);
  if (!membership) {
    return NextResponse.json({ error: "Member not found." }, { status: 404 });
  }

  if (membership.role === "owner") {
    const owners = await countProjectOwners(id);
    if (owners <= 1) {
      return NextResponse.json(
        { error: "A project must keep at least one owner." },
        { status: 400 }
      );
    }
  }

  const removed = await removeProjectMember(id, userId);
  if (!removed) {
    return NextResponse.json({ error: "Member not found." }, { status: 404 });
  }

  recordAudit({
    actor: auth.actor,
    action: "member_remove",
    project: project.name,
    detail: `Removed ${removed.username}`,
    outcome: "ok",
  });

  return NextResponse.json({ ok: true });
}
