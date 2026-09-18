import { NextRequest, NextResponse } from "next/server";
import { getProject, updateProject } from "@/lib/store";
import { getCloudflareToken } from "@/lib/cf";
import { getDefaultAccountId } from "@/lib/config";
import { requireAuth, authRequiredResponse, verifyOrigin } from "@/lib/auth";
import { requireProjectRole } from "@/lib/membership";
import { resolvePat } from "@/lib/status";
import { createClient } from "@/lib/github";
import { recordAudit } from "@/lib/audit";
import { removeProjectEnvVar } from "@/lib/envops";
import {
  findWranglerConfig,
  readRepoWrangler,
  parseBindings,
  renderBindings,
  updateRepoWrangler,
  deleteTurnstileWidget,
  deleteAiSearchInstance,
} from "@/lib/bindings";

export const runtime = "nodejs";

export async function DELETE(
  req: NextRequest,
  ctx: RouteContext<"/api/projects/[id]/bindings/[name]">
) {
  const auth = requireAuth(req);
  if (!auth.ok) return authRequiredResponse();
  if (!verifyOrigin(req)) {
    return NextResponse.json({ error: "Cross-origin request rejected." }, { status: 403 });
  }

  const { id, name } = await ctx.params;
  const project = await getProject(id);
  if (!project) {
    return NextResponse.json({ error: "Project not found." }, { status: 404 });
  }

  const access = await requireProjectRole(auth.user, id, "member");
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: 403 });
  }

  if (project.provider !== "cloudflare") {
    return NextResponse.json(
      { error: "Bindings are managed in the AWS SAM / Amplify templates for AWS projects." },
      { status: 400 }
    );
  }

  const pat = await resolvePat(project.id);
  if (!pat) {
    return NextResponse.json(
      { error: "No GitHub token is available for this project." },
      { status: 400 }
    );
  }

  const token = getCloudflareToken();
  const accountId = await getDefaultAccountId();
  if (!token || !accountId) {
    return NextResponse.json(
      {
        error:
          "Cloudflare credentials are not configured on the server (CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID).",
      },
      { status: 400 }
    );
  }

  const serviceBinding = project.serviceBindings?.find((b) => b.name === name);

  if (serviceBinding && serviceBinding.type === "turnstile") {
    let warning: string | null = null;
    try {
      await deleteTurnstileWidget(token, accountId, serviceBinding.id);
    } catch (err) {
      warning = `The widget could not be deleted: ${(err as Error).message}`;
    }
    for (const key of [`${name}_SITE_KEY`, `${name}_SECRET_KEY`]) {
      try {
        await removeProjectEnvVar(id, key);
      } catch (err) {
        warning = warning ?? `Failed to remove env var ${key}: ${(err as Error).message}`;
      }
    }
    await updateProject(id, {
      serviceBindings: project.serviceBindings?.filter((b) => b.name !== name),
    });

    recordAudit({
      actor: auth.actor,
      action: "binding_remove",
      project: project.name,
      detail: `turnstile ${name} → ${serviceBinding.resource}`,
      outcome: "ok",
    });
    return NextResponse.json({ ok: true, binding: serviceBinding, warning });
  }

  const client = createClient(pat);
  let configRef;
  try {
    configRef = await findWranglerConfig(client, project.owner, project.repo);
  } catch (err) {
    return NextResponse.json(
      { error: `Failed to read the repo: ${(err as Error).message}` },
      { status: 500 }
    );
  }
  if (!configRef) {
    return NextResponse.json(
      { error: "This project has no wrangler config file in the repo root." },
      { status: 400 }
    );
  }

  try {
    const { text, sha } = await readRepoWrangler(client, project.owner, project.repo, configRef);
    const bindings = parseBindings(text, configRef.kind);
    const removed = bindings.find((b) => b.name === name);
    if (!removed) {
      return NextResponse.json({ error: `No binding named "${name}".` }, { status: 404 });
    }

    const rendered = renderBindings(
      text,
      configRef.kind,
      bindings.filter((b) => b.name !== name)
    );
    await updateRepoWrangler(client, project.owner, project.repo, configRef, rendered, sha);

    let warning: string | null = null;
    if (removed.type === "ai_search" && (removed.id ?? removed.resource)) {
      try {
        await deleteAiSearchInstance(token, accountId, removed.id ?? removed.resource);
      } catch (err) {
        warning = `The instance could not be deleted: ${(err as Error).message}`;
      }
    }

    recordAudit({
      actor: auth.actor,
      action: "binding_remove",
      project: project.name,
      detail: `${removed.type} ${name} → ${removed.resource}`,
      outcome: "ok",
    });
    return NextResponse.json({ ok: true, binding: removed, warning });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
