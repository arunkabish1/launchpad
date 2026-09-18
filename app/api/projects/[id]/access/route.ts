import { NextRequest, NextResponse } from "next/server";
import { getProject } from "@/lib/store";
import {
  createClient,
  getRepoFileContent,
  getUser,
  pushFilesToExistingRepo,
} from "@/lib/github";
import { requireAuth, authRequiredResponse, verifyOrigin } from "@/lib/auth";
import { requireProjectRole } from "@/lib/membership";
import { resolvePat } from "@/lib/status";
import { recordAudit } from "@/lib/audit";
import {
  buildSiteAccessFiles,
  buildSiteAccessRemoval,
  generateAccessKey,
  persistSiteAccessKey,
  siteAccessKeyForProject,
  siteAccessSupported,
  type WranglerConfigRef,
} from "@/lib/site-access";
import { updateProject } from "@/lib/store";
import type { Project, SiteAccessMode } from "@/lib/types";

export const runtime = "nodejs";

async function readWranglerConfig(
  client: ReturnType<typeof createClient>,
  owner: string,
  repo: string
): Promise<WranglerConfigRef | null> {
  const jsonc = await getRepoFileContent(client, owner, repo, "wrangler.jsonc");
  if (jsonc != null) return { path: "wrangler.jsonc", content: jsonc };
  const toml = await getRepoFileContent(client, owner, repo, "wrangler.toml");
  if (toml != null) return { path: "wrangler.toml", content: toml };
  return null;
}

export async function GET(req: NextRequest, ctx: RouteContext<"/api/projects/[id]/access">) {
  const auth = requireAuth(req);
  if (!auth.ok) return authRequiredResponse();

  const { id } = await ctx.params;
  const project = await getProject(id);
  if (!project) {
    return NextResponse.json({ error: "Project not found." }, { status: 404 });
  }

  const access = await requireProjectRole(auth.user, id, "member");
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: 403 });
  }

  const mode: SiteAccessMode = project.siteAccess ?? "public";
  const key =
    (access.role === "owner" || mode === "members") && mode !== "public"
      ? await siteAccessKeyForProject(project)
      : null;

  return NextResponse.json({
    mode,
    key,
    supported: siteAccessSupported(project.templateId),
  });
}

export async function PUT(req: NextRequest, ctx: RouteContext<"/api/projects/[id]/access">) {
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

  const access = await requireProjectRole(auth.user, id, "owner");
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: 403 });
  }

  let body: { mode?: string; rotate?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const mode: SiteAccessMode =
    body.mode === "org" ? "org" : body.mode === "members" ? "members" : "public";

  if (mode !== "public" && !siteAccessSupported(project.templateId)) {
    return NextResponse.json(
      {
        error:
          "Site access isn't supported for this template yet (Next.js, Astro, and AWS targets are not covered in v1).",
      },
      { status: 400 }
    );
  }

  const pat = await resolvePat(project.id);
  if (!pat) {
    return NextResponse.json(
      { error: "No GitHub token available for this project." },
      { status: 409 }
    );
  }

  try {
    const client = createClient(pat);
    const author = await getUser(client);
    const config =
      project.type === "worker"
        ? await readWranglerConfig(client, project.owner, project.repo)
        : null;

    let files;
    let nextPatch: Partial<Project>;

    if (mode === "public") {
      // Disabling: restore the previous entry (workers) or neutralize the Pages middleware.
      const removal = buildSiteAccessRemoval({
        templateId: project.templateId,
        projectType: project.type,
        prevMain: project.siteAccessPrevMain,
        config,
      });
      files = removal.files;
      nextPatch = {
        siteAccess: "public",
        siteAccessKey: undefined,
        siteAccessKeyEnc: undefined,
        siteAccessPrevMain: undefined,
      };
    } else {
      const currentKey = await siteAccessKeyForProject(project);
      const key =
        currentKey && !body.rotate ? currentKey : generateAccessKey();
      const realm = project.name;

      const result = buildSiteAccessFiles({
        templateId: project.templateId,
        projectType: project.type,
        key,
        realm,
        config,
      });

      if (!result.supported) {
        return NextResponse.json(
          { error: result.reason ?? "Site access is not supported for this project." },
          { status: 400 }
        );
      }
      files = result.files;
      const keyPatch = await persistSiteAccessKey(project, key);
      nextPatch = {
        siteAccess: mode,
        siteAccessPrevMain: result.prevMain ?? project.siteAccessPrevMain,
        ...keyPatch,
      };
    }

    if (files.length > 0) {
      await pushFilesToExistingRepo(client, project.owner, project.repo, files, author, "Site access (Launchpad)", "main");
    }

    await updateProject(project.id, nextPatch);

    if (mode === "public") {
      recordAudit({
        actor: auth.actor,
        action: "site_access_disable",
        project: project.name,
        detail: "Site access disabled",
        outcome: "ok",
      });
    } else {
      const isRotate = project.siteAccess && project.siteAccess !== "public";
      recordAudit({
        actor: auth.actor,
        action: isRotate ? "site_access_rotate" : "site_access_enable",
        project: project.name,
        detail: `${mode} access${isRotate ? " (rotated key)" : ""}`,
        outcome: "ok",
      });
    }

    const key = mode === "public" ? null : await siteAccessKeyForProject({ ...project, ...nextPatch });

    return NextResponse.json({ ok: true, mode, key });
  } catch (err) {
    console.error("Site access update failed:", err);
    return NextResponse.json(
      { error: `Failed to update site access: ${(err as Error).message}` },
      { status: 500 }
    );
  }
}