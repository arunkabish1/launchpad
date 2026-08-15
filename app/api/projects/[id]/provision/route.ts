import { NextRequest, NextResponse } from "next/server";
import { getProject } from "@/lib/store";
import { requireAuth, authRequiredResponse, verifyOrigin } from "@/lib/auth";
import { resolvePat } from "@/lib/status";
import { createClient } from "@/lib/github";
import { recordAudit } from "@/lib/audit";
import { hasSecretKey } from "@/lib/crypto";
import { getOrCreatePreviewMasterKey, syncPreviewEnvValues } from "@/lib/preview";
import {
  commitProvisionFiles,
  removeProvisionFiles,
  provisioningEnabled,
} from "@/lib/provision";

export const runtime = "nodejs";

export async function GET(req: NextRequest, ctx: RouteContext<"/api/projects/[id]/provision">) {
  const auth = requireAuth(req);
  if (!auth.ok) return authRequiredResponse();

  const { id } = await ctx.params;
  const project = await getProject(id);
  if (!project) {
    return NextResponse.json({ error: "Project not found." }, { status: 404 });
  }

  let enabled = false;
  if (project.type === "worker") {
    const pat = await resolvePat(project.id);
    if (pat) {
      try {
        enabled = await provisioningEnabled(createClient(pat), project);
      } catch {
        enabled = false;
      }
    }
  }

  return NextResponse.json({ enabled });
}

export async function POST(req: NextRequest, ctx: RouteContext<"/api/projects/[id]/provision">) {
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
      { error: "Provisioning from code is not supported for Pages projects." },
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
      await commitProvisionFiles(client, project);
      if (hasSecretKey()) {
        await getOrCreatePreviewMasterKey(client, project);
        await syncPreviewEnvValues(client, project);
      }
      recordAudit({
        actor: auth.actor,
        action: "provision_enable",
        project: project.name,
        detail: "Provisioning from pushed code enabled",
        outcome: "ok",
      });
    } else {
      await removeProvisionFiles(client, project);
      recordAudit({
        actor: auth.actor,
        action: "provision_disable",
        project: project.name,
        detail: "Provisioning from pushed code disabled",
        outcome: "ok",
      });
    }
    return NextResponse.json({ ok: true, enabled });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
