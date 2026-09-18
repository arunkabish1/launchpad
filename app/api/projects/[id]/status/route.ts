import { NextRequest, NextResponse } from "next/server";
import { getProject } from "@/lib/store";
import { resolvePat, getProjectStatus, resolveProjectLiveUrl } from "@/lib/status";
import { applyPendingConfig } from "@/lib/runtime-config";
import { requireAuth, authRequiredResponse } from "@/lib/auth";
import { requireProjectRole } from "@/lib/membership";

export const runtime = "nodejs";

export async function GET(req: NextRequest, ctx: RouteContext<"/api/projects/[id]/status">) {
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

  const pat = await resolvePat(project.id);
  if (!pat) {
    return NextResponse.json(
      { error: "No GitHub token available for this project (set GITHUB_PAT in .env)." },
      { status: 400 }
    );
  }

  try {
    const status = await getProjectStatus(project.owner, project.repo, pat);
    status.liveUrl = await resolveProjectLiveUrl(project);
    if (status.status === "success") {
      await applyPendingConfig(project, status).catch(() => {});
    }
    return NextResponse.json(status);
  } catch (err) {
    return NextResponse.json(
      { error: "Failed to fetch deploy status: " + (err as Error).message },
      { status: 500 }
    );
  }
}
