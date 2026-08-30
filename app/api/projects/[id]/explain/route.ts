import { NextRequest, NextResponse } from "next/server";
import { getProject } from "@/lib/store";
import { resolvePat } from "@/lib/status";
import { createClient, getRunLogs } from "@/lib/github";
import { explainFailure, isAiAvailable } from "@/lib/ai";
import { requireAuth, authRequiredResponse } from "@/lib/auth";

export const runtime = "nodejs";

export async function GET(req: NextRequest, ctx: RouteContext<"/api/projects/[id]/explain">) {
  const auth = requireAuth(req);
  if (!auth.ok) return authRequiredResponse();

  const { id } = await ctx.params;
  const project = await getProject(id);
  if (!project) {
    return NextResponse.json({ error: "Project not found." }, { status: 404 });
  }

  const runId = Number(req.nextUrl.searchParams.get("run"));
  if (!Number.isInteger(runId) || runId <= 0) {
    return NextResponse.json({ error: "A valid run id is required (?run=<id>)." }, { status: 400 });
  }

  if (!isAiAvailable()) {
    return NextResponse.json(
      { error: "Cloudflare AI is not configured on this deployment." },
      { status: 400 }
    );
  }

  const pat = await resolvePat(project.id);
  if (!pat) {
    return NextResponse.json(
      { error: "No GitHub token available for this project (set GITHUB_PAT in .env)." },
      { status: 400 }
    );
  }

  try {
    const log = await getRunLogs(createClient(pat), project.owner, project.repo, runId);
    const explanation = await explainFailure(log.text, null);
    return NextResponse.json({ explanation, log });
  } catch (err) {
    return NextResponse.json(
      { error: "Failed to explain the failure: " + (err as Error).message },
      { status: 500 }
    );
  }
}
