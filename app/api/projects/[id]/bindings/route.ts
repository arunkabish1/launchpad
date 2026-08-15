import { NextRequest, NextResponse } from "next/server";
import { getProject, updateProject } from "@/lib/store";
import { getCloudflareToken, deriveLiveUrl } from "@/lib/cf";
import { getDefaultAccountId } from "@/lib/config";
import { requireAuth, authRequiredResponse, verifyOrigin } from "@/lib/auth";
import { resolvePat } from "@/lib/status";
import { createClient } from "@/lib/github";
import { recordAudit } from "@/lib/audit";
import { setProjectEnvVar } from "@/lib/envops";
import {
  findWranglerConfig,
  readRepoWrangler,
  parseBindings,
  renderBindings,
  updateRepoWrangler,
  ensureResource,
  listKvNamespaces,
  listD1Databases,
  listR2Buckets,
  listTurnstileWidgets,
  listAiSearchInstances,
  getTurnstileSecret,
  createTurnstileWidget,
  ensureAiSearch,
  validateBindingName,
  validateResourceName,
} from "@/lib/bindings";
import type { Binding, BindingResource, BindingType, Project } from "@/lib/types";

export const runtime = "nodejs";

const BINDING_TYPES: BindingType[] = ["kv", "d1", "r2", "turnstile", "ai_search"];
const HOSTNAME_REGEX = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*$/i;

function liveUrlHost(project: Project): string | null {
  const url = deriveLiveUrl(project);
  if (!url) return null;
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}

export async function GET(req: NextRequest, ctx: RouteContext<"/api/projects/[id]/bindings">) {
  const auth = requireAuth(req);
  if (!auth.ok) return authRequiredResponse();

  const { id } = await ctx.params;
  const project = await getProject(id);
  if (!project) {
    return NextResponse.json({ error: "Project not found." }, { status: 404 });
  }

  const pat = await resolvePat(project.id);
  if (!pat) {
    return NextResponse.json(
      { error: "No GitHub token is available for this project." },
      { status: 400 }
    );
  }

  const client = createClient(pat);
  let configRef = null;
  try {
    configRef = await findWranglerConfig(client, project.owner, project.repo);
  } catch (err) {
    return NextResponse.json(
      { error: `Failed to read the repo: ${(err as Error).message}` },
      { status: 500 }
    );
  }

  let bindings: Binding[] = [];
  if (configRef) {
    try {
      const { text } = await readRepoWrangler(client, project.owner, project.repo, configRef);
      bindings = parseBindings(text, configRef.kind);
    } catch (err) {
      return NextResponse.json(
        { error: `Failed to read wrangler config: ${(err as Error).message}` },
        { status: 500 }
      );
    }
  }

  for (const sb of project.serviceBindings ?? []) {
    bindings.push({ type: sb.type, name: sb.name, resource: sb.resource, id: sb.id });
  }

  const token = getCloudflareToken();
  const accountId = await getDefaultAccountId();
  let resources: BindingResource[] = [];
  if (token && accountId) {
    const [kv, d1, r2, turnstile, aiSearch] = await Promise.all([
      listKvNamespaces(token, accountId).catch(() => []),
      listD1Databases(token, accountId).catch(() => []),
      listR2Buckets(token, accountId).catch(() => []),
      listTurnstileWidgets(token, accountId).catch(() => []),
      listAiSearchInstances(token, accountId).catch(() => []),
    ]);
    resources = [...kv, ...d1, ...r2, ...turnstile, ...aiSearch];
    const nameById = new Map(resources.map((r) => [r.id, r.name]));
    bindings = bindings.map((b) => ({
      ...b,
      resource: b.type === "kv" && nameById.has(b.resource) ? nameById.get(b.resource)! : b.resource,
    }));
  }

  return NextResponse.json({ bindings, configPath: configRef?.path ?? null, resources });
}

export async function POST(req: NextRequest, ctx: RouteContext<"/api/projects/[id]/bindings">) {
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

  let body: { type?: string; name?: string; resource?: string; domain?: string; existing?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const type = body.type as BindingType;
  if (!BINDING_TYPES.includes(type)) {
    return NextResponse.json(
      { error: "Binding type must be one of: kv, d1, r2, turnstile, ai_search." },
      { status: 400 }
    );
  }
  const nameError = validateBindingName(body.name);
  if (nameError) return NextResponse.json({ error: nameError }, { status: 400 });
  const resourceError = validateResourceName(type, body.resource);
  if (resourceError) return NextResponse.json({ error: resourceError }, { status: 400 });
  const bindingName = (body.name ?? "").trim();
  const resourceName = (body.resource ?? "").trim();

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

  const client = createClient(pat);

  if (type === "turnstile") {
    if (project.serviceBindings?.some((b) => b.name === bindingName)) {
      return NextResponse.json(
        { error: `A binding named "${bindingName}" already exists.` },
        { status: 400 }
      );
    }
    try {
      const existing = body.existing === true;
      let sitekey: string;
      let secret: string;
      let siteName: string;
      if (existing) {
        sitekey = resourceName;
        const widget = (await listTurnstileWidgets(token, accountId)).find((w) => w.id === sitekey);
        if (!widget) {
          return NextResponse.json(
            { error: "The selected Turnstile widget no longer exists on this account." },
            { status: 400 }
          );
        }
        siteName = widget.name;
        secret = await getTurnstileSecret(token, accountId, sitekey);
      } else {
        const domain = body.domain?.trim() || liveUrlHost(project) || "";
        if (!domain) {
          return NextResponse.json(
            { error: "A Turnstile domain is required when the project has no live URL." },
            { status: 400 }
          );
        }
        if (!HOSTNAME_REGEX.test(domain)) {
          return NextResponse.json({ error: "Turnstile domain must be a hostname." }, { status: 400 });
        }
        siteName = resourceName;
        let created: { sitekey: string; secret: string };
        try {
          created = await createTurnstileWidget(token, accountId, siteName, [domain]);
        } catch (err) {
          throw new Error(
            `${(err as Error).message}. The Launchpad Cloudflare token needs the "Account:Turnstile:Edit" permission.`
          );
        }
        sitekey = created.sitekey;
        secret = created.secret;
      }
      const serviceBindings = [...(project.serviceBindings ?? [])];
      serviceBindings.push({ type: "turnstile", name: bindingName, resource: siteName, id: sitekey });
      await updateProject(project.id, { serviceBindings });

      const siteKeyWarning = await setProjectEnvVar(id, `${bindingName}_SITE_KEY`, sitekey, false);
      const secretWarning = await setProjectEnvVar(id, `${bindingName}_SECRET_KEY`, secret, true);

      recordAudit({
        actor: auth.actor,
        action: "binding_add",
        project: project.name,
        detail: `turnstile ${bindingName} → ${siteName}`,
        outcome: "ok",
      });
      return NextResponse.json({
        ok: true,
        binding: { type: "turnstile", name: bindingName, resource: siteName, id: sitekey } as Binding,
        warning: siteKeyWarning || secretWarning,
      });
    } catch (err) {
      return NextResponse.json({ error: (err as Error).message }, { status: 500 });
    }
  }

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
      {
        error:
          "This project has no wrangler config file (wrangler.toml / wrangler.jsonc) in the repo root, so bindings can't be added.",
      },
      { status: 400 }
    );
  }

  try {
    const { text, sha } = await readRepoWrangler(client, project.owner, project.repo, configRef);
    const bindings = parseBindings(text, configRef.kind);
    if (bindings.some((b) => b.name === bindingName)) {
      return NextResponse.json(
        { error: `A binding named "${bindingName}" already exists.` },
        { status: 400 }
      );
    }

    let binding: Binding;
    if (type === "ai_search") {
      let instance: BindingResource;
      try {
        instance = await ensureAiSearch(token, accountId, resourceName);
      } catch (err) {
        throw new Error(
          `${(err as Error).message}. The Launchpad Cloudflare token needs the "AI Search:Edit" and "AI Search:Run" permissions.`
        );
      }
      binding = { type: "ai_search", name: bindingName, resource: instance.name, id: instance.id };
    } else {
      const resource = await ensureResource(type, resourceName, token, accountId);
      binding = { type, name: bindingName, resource: resource.name, id: resource.id };
    }
    const rendered = renderBindings(text, configRef.kind, [...bindings, binding]);
    await updateRepoWrangler(client, project.owner, project.repo, configRef, rendered, sha);

    recordAudit({
      actor: auth.actor,
      action: "binding_add",
      project: project.name,
      detail: `${type} ${bindingName} → ${binding.resource}`,
      outcome: "ok",
    });
    return NextResponse.json({ ok: true, binding });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
