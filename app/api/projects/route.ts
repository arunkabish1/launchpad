import { NextRequest, NextResponse } from "next/server";
import { listProjects } from "@/lib/store";
import { launchProject, LaunchError } from "@/lib/launch";
import { getTemplate } from "@/lib/templates";
import { requireAuth, authRequiredResponse, verifyOrigin } from "@/lib/auth";
import { filterAccessibleProjects } from "@/lib/membership";
import type { LaunchRequest } from "@/lib/types";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const auth = requireAuth(request);
  if (!auth.ok) return authRequiredResponse();
  const projects = await filterAccessibleProjects(auth.user, await listProjects());
  return NextResponse.json({ projects });
}

export async function POST(request: NextRequest) {
  const auth = requireAuth(request);
  if (!auth.ok) return authRequiredResponse();
  if (!verifyOrigin(request)) {
    return NextResponse.json({ error: "Cross-origin request rejected." }, { status: 403 });
  }

  let body: LaunchRequest;
  try {
    body = (await request.json()) as LaunchRequest;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const template = getTemplate(body.templateId);
  if (!template) {
    return NextResponse.json({ error: "Template not found." }, { status: 404 });
  }
  if (template.provider === "aws" && template.type === "amplify") {
    return NextResponse.json({ error: "AWS Amplify templates are not yet available (Coming Soon)." }, { status: 400 });
  }

  try {
    const project = await launchProject({ ...body, actor: auth.actor, actorId: auth.user.id });
    return NextResponse.json({ project }, { status: 201 });
  } catch (err) {
    if (err instanceof LaunchError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    console.error("Launch failed:", err);
    return NextResponse.json(
      { error: "Launch failed: " + (err as Error).message },
      { status: 500 }
    );
  }
}
