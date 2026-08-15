import { NextRequest, NextResponse } from "next/server";
import { getProject } from "@/lib/store";
import { resolvePat } from "@/lib/status";
import {
  createClient,
  findDeployWorkflow,
  triggerWorkflowDispatch,
  validatePat,
} from "@/lib/github";
import { requireAuth, authRequiredResponse, verifyOrigin } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";

export const runtime = "nodejs";

export async function POST(req: NextRequest, ctx: RouteContext<"/api/projects/[id]/redeploy">) {
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

  const pat = await resolvePat(project.id);
  if (!pat) {
    return NextResponse.json(
      { error: "No GitHub token available for this project (set GITHUB_PAT in .env)." },
      { status: 400 }
    );
  }

  try {
    const client = createClient(pat);
    const { scopes } = await validatePat(client);
    if (scopes && !scopes.includes("workflow")) {
      return NextResponse.json(
        { error: "Your GitHub token is missing the workflow scope, which is required to trigger re-deploys." },
        { status: 400 }
      );
    }

    const workflow = await findDeployWorkflow(client, project.owner, project.repo);
    if (!workflow) {
      return NextResponse.json(
        { error: "No deploy workflow found in the repo." },
        { status: 404 }
      );
    }

    await triggerWorkflowDispatch(client, project.owner, project.repo, workflow.id, "main");
    recordAudit({
      actor: auth.actor,
      action: "redeploy",
      project: project.name,
      detail: `Triggered ${workflow.path}`,
      outcome: "ok",
    });
    return NextResponse.json({ ok: true, workflow });
  } catch (err) {
    return NextResponse.json(
      { error: "Failed to trigger re-deploy: " + (err as Error).message },
      { status: 500 }
    );
  }
}
