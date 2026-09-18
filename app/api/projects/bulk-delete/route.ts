import { NextRequest, NextResponse } from "next/server";
import { getProject, removeProject } from "@/lib/store";
import { forgetPat } from "@/lib/status";
import { deleteProjectResources } from "@/lib/delete-project";
import { requireAuth, authRequiredResponse, verifyOrigin } from "@/lib/auth";
import { requireProjectRole } from "@/lib/membership";
import { recordAudit } from "@/lib/audit";

export const runtime = "nodejs";

interface BulkDeleteResult {
  ok: boolean;
  deleted: number;
  failed: Array<{ name: string; error: string }>;
  warnings: string[];
}

export async function POST(request: NextRequest) {
  const auth = requireAuth(request);
  if (!auth.ok) return authRequiredResponse();
  if (!verifyOrigin(request)) {
    return NextResponse.json({ error: "Cross-origin request rejected." }, { status: 403 });
  }

  let body: { ids?: unknown; deleteRepo?: boolean; deleteCloudflare?: boolean } = {};
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const ids = Array.isArray(body.ids) ? body.ids.filter((x) => typeof x === "string") : [];
  if (ids.length === 0) {
    return NextResponse.json({ error: "No projects selected." }, { status: 400 });
  }

  const result: BulkDeleteResult = { ok: true, deleted: 0, failed: [], warnings: [] };

  for (const id of ids) {
    const project = await getProject(id);
    if (!project) {
      result.failed.push({ name: id, error: "Project not found." });
      continue;
    }
    const access = await requireProjectRole(auth.user, id, "owner");
    if (!access.ok) {
      result.failed.push({ name: project.name, error: access.error });
      continue;
    }
    try {
      const { repoDeleted, cloudflareDeleted, warnings } = await deleteProjectResources(project, {
        deleteRepo: body.deleteRepo,
        deleteCloudflare: body.deleteCloudflare,
      });
      await forgetPat(project.id);
      await removeProject(project.id);
      result.warnings.push(...warnings);
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
      result.deleted += 1;
    } catch (err) {
      result.failed.push({ name: project.name, error: (err as Error).message });
    }
  }

  result.ok = result.deleted > 0 || result.failed.length === 0;
  return NextResponse.json(result);
}
