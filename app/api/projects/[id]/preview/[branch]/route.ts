import { NextRequest, NextResponse } from "next/server";
import { getProject } from "@/lib/store";
import { getCloudflareToken } from "@/lib/cf";
import { getDefaultAccountId } from "@/lib/config";
import { requireAuth, authRequiredResponse } from "@/lib/auth";
import { requireProjectRole } from "@/lib/membership";
import { resolvePat } from "@/lib/status";
import { createClient } from "@/lib/github";
import { getPreviewBranchDetail } from "@/lib/preview";

export const runtime = "nodejs";

export async function GET(req: NextRequest, ctx: RouteContext<"/api/projects/[id]/preview/[branch]">) {
  const auth = requireAuth(req);
  if (!auth.ok) return authRequiredResponse();

  const { id, branch } = await ctx.params;
  const project = await getProject(id);
  if (!project) {
    return NextResponse.json({ error: "Project not found." }, { status: 404 });
  }

  const access = await requireProjectRole(auth.user, id, "member");
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: 403 });
  }

  if (project.provider !== "cloudflare" || project.type !== "worker") {
    return NextResponse.json(
      { error: "Per-branch preview deployments are only supported for Cloudflare Workers projects." },
      { status: 400 }
    );
  }

  const token = getCloudflareToken();
  const accountId = await getDefaultAccountId();
  const pat = await resolvePat(project.id);
  if (!token || !accountId || !pat) {
    return NextResponse.json(
      { error: "Preview details are unavailable right now (missing Cloudflare token or GitHub token)." },
      { status: 400 }
    );
  }

  try {
    const detail = await getPreviewBranchDetail(project, token, accountId, createClient(pat), branch);
    return NextResponse.json(detail);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
