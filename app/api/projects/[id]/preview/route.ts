import { NextRequest, NextResponse } from "next/server";
import { getProject, updateProject } from "@/lib/store";
import { getCloudflareToken } from "@/lib/cf";
import { getDefaultAccountId } from "@/lib/config";
import { requireAuth, authRequiredResponse, verifyOrigin } from "@/lib/auth";
import { resolvePat } from "@/lib/status";
import { createClient } from "@/lib/github";
import { recordAudit } from "@/lib/audit";
import { hasSecretKey } from "@/lib/crypto";
import {
  commitPreviewFiles,
  removePreviewFiles,
  syncPreviewEnvValues,
  listPreviewDeployments,
  type PreviewDeployment,
} from "@/lib/preview";

export const runtime = "nodejs";

export async function GET(req: NextRequest, ctx: RouteContext<"/api/projects/[id]/preview">) {
  const auth = requireAuth(req);
  if (!auth.ok) return authRequiredResponse();

  const { id } = await ctx.params;
  const project = await getProject(id);
  if (!project) {
    return NextResponse.json({ error: "Project not found." }, { status: 404 });
  }

  const token = getCloudflareToken();
  const accountId = await getDefaultAccountId();
  let previews: PreviewDeployment[] = [];
  let warning: string | null = null;
  if (project.type === "worker" && token && accountId) {
    try {
      const pat = await resolvePat(project.id);
      if (pat) {
        const result = await listPreviewDeployments(project, token, accountId, createClient(pat));
        previews = result.deployments;
        warning = result.warning;
      } else {
        warning = "No GitHub token is available, so branch info could not be loaded.";
      }
    } catch {
      warning = "Could not fully load preview branches; showing available workers.";
    }
  }

  return NextResponse.json({ enabled: Boolean(project.previewEnabled), previews, warning });
}

export async function POST(req: NextRequest, ctx: RouteContext<"/api/projects/[id]/preview">) {
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
  if (project.type !== "worker") {
    return NextResponse.json(
      { error: "Per-branch preview deployments are not supported for Pages projects." },
      { status: 400 }
    );
  }

  let body: { enabled?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const enabled = Boolean(body.enabled);

  const pat = await resolvePat(project.id);
  if (!pat) {
    return NextResponse.json(
      { error: "No GitHub token is available for this project." },
      { status: 400 }
    );
  }
  const client = createClient(pat);

  try {
    if (enabled) {
      await commitPreviewFiles(client, project);
      if (hasSecretKey()) {
        await syncPreviewEnvValues(client, project);
      }
      await updateProject(project.id, { previewEnabled: true });
      recordAudit({
        actor: auth.actor,
        action: "preview_enable",
        project: project.name,
        detail: "Per-branch preview deployments enabled",
        outcome: "ok",
      });
    } else {
      await removePreviewFiles(client, project);
      await updateProject(project.id, { previewEnabled: false });
      recordAudit({
        actor: auth.actor,
        action: "preview_disable",
        project: project.name,
        detail: "Per-branch preview deployments disabled",
        outcome: "ok",
      });
    }
    return NextResponse.json({ ok: true, enabled });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
