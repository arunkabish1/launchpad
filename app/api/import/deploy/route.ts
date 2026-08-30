import { NextRequest, NextResponse } from "next/server";
import { requireAuth, authRequiredResponse, verifyOrigin } from "@/lib/auth";
import { deployImport, ImportError } from "@/lib/import";
import type { DeployPlan } from "@/lib/types";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const auth = requireAuth(req);
  if (!auth.ok) return authRequiredResponse();
  if (!verifyOrigin(req)) {
    return NextResponse.json({ error: "Cross-origin request rejected." }, { status: 403 });
  }

  let body: {
    url?: string;
    projectName?: string;
    plan?: DeployPlan;
    githubPat?: string;
    cloudflareToken?: string;
    accountId?: string;
    envValues?: Record<string, string>;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  if (!body.url?.trim()) {
    return NextResponse.json({ error: "A GitHub repository URL is required." }, { status: 400 });
  }
  if (!body.projectName?.trim()) {
    return NextResponse.json({ error: "A project name is required." }, { status: 400 });
  }
  if (!body.plan) {
    return NextResponse.json({ error: "A confirmed deploy plan is required." }, { status: 400 });
  }

  try {
    const project = await deployImport({
      url: body.url,
      projectName: body.projectName,
      plan: body.plan,
      githubPat: body.githubPat,
      cloudflareToken: body.cloudflareToken,
      accountId: body.accountId,
      envValues: body.envValues ?? {},
      actor: auth.actor,
    });
    return NextResponse.json({ project }, { status: 201 });
  } catch (err) {
    if (err instanceof ImportError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    console.error("Import deploy failed:", err);
    return NextResponse.json(
      { error: "Deploy failed: " + (err as Error).message },
      { status: 500 }
    );
  }
}
