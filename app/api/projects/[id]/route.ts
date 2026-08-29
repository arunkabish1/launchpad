import { NextRequest, NextResponse } from "next/server";
import { getProject, removeProject } from "@/lib/store";
import { getTemplate } from "@/lib/templates";
import { resolvePat, getProjectStatus, forgetPat } from "@/lib/status";
import { deleteProjectResources } from "@/lib/delete-project";
import { requireAuth, authRequiredResponse, verifyOrigin } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";
import type { ProjectDetail } from "@/lib/types";

export const runtime = "nodejs";

export async function GET(req: NextRequest, ctx: RouteContext<"/api/projects/[id]">) {
  const auth = requireAuth(req);
  if (!auth.ok) return authRequiredResponse();

  const { id } = await ctx.params;

  const project = await getProject(id);
  if (!project) {
    return NextResponse.json({ error: "Project not found." }, { status: 404 });
  }

  const template = getTemplate(project.templateId);

  const pat = await resolvePat(project.id);
  let statusResult = null;
  if (pat) {
    try {
      statusResult = await getProjectStatus(project.owner, project.repo, pat);
    } catch (err) {
      statusResult = {
        latest: null,
        status: "unknown" as const,
        totalRuns: 0,
        runs: [],
        error: "Failed to fetch deploy status: " + (err as Error).message,
      };
    }
  } else {
    statusResult = {
      latest: null,
      status: "unknown" as const,
      totalRuns: 0,
      runs: [],
      error: "No GitHub token available for this project (set GITHUB_PAT in .env).",
    };
  }

  const detail: ProjectDetail = {
    project,
    template: template ?? {
      id: project.templateId,
      name: project.templateName,
      description: "",
      type: project.type,
      provider: project.provider,
      category: "static",
      deployCommand: "deploy",
      buildCommand: "",
      requiresRoute: false,
      source: "local",
      files: [],
    },
    status: statusResult,
  };

  return NextResponse.json(detail);
}

export async function DELETE(req: NextRequest, ctx: RouteContext<"/api/projects/[id]">) {
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

  let body: { deleteRepo?: boolean; deleteCloudflare?: boolean } = {};
  try {
    body = await req.json();
  } catch {
    // No body is fine; defaults apply.
  }

  const { repoDeleted, cloudflareDeleted, warnings } = await deleteProjectResources(project, body);

  await forgetPat(project.id);
  await removeProject(project.id);

  recordAudit({
    actor: auth.actor,
    action: "delete",
    project: project.name,
    detail: [
      repoDeleted ? "repo deleted" : "repo kept",
      cloudflareDeleted ? "cloudflare deleted" : "cloudflare kept",
      ...warnings,
    ].join("; "),
    outcome: "ok",
  });

  return NextResponse.json({
    ok: true,
    repoDeleted,
    cloudflareDeleted,
    warnings,
  });
}
