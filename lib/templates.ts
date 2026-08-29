import { getTemplateMetaJson, listTemplateFiles, listTemplateIds } from "./template-assets";
import type { TemplateInfo } from "./types";

export const TEMPLATES_ROOT = "";
export const TEMPLATE_META_FILE = "template.json";

interface TemplateMeta {
  id: string;
  name: string;
  description: string;
  type: TemplateInfo["type"];
  provider?: TemplateInfo["provider"];
  category: TemplateInfo["category"];
  deployCommand: string;
  buildCommand?: string;
  requiresRoute?: boolean;
  source?: TemplateInfo["source"];
  c3?: TemplateInfo["c3"];
  deploy?: TemplateInfo["deploy"];
}

export function listTemplates(): TemplateInfo[] {
  const templates: TemplateInfo[] = [];
  for (const id of listTemplateIds()) {
    const template = getTemplate(id);
    if (template) templates.push(template);
  }
  return templates.sort((a, b) => a.name.localeCompare(b.name));
}

export function getTemplate(id: string): TemplateInfo | null {
  const meta = getTemplateMetaJson(id) as TemplateMeta | null;
  if (!meta) return null;
  return {
    id: meta.id,
    name: meta.name,
    description: meta.description,
    type: meta.type,
    provider: meta.provider ?? (meta.type === "lambda" || meta.type === "amplify" ? "aws" : "cloudflare"),
    category: meta.category,
    deployCommand: meta.deployCommand,
    buildCommand: meta.buildCommand ?? "",
    requiresRoute: meta.requiresRoute ?? false,
    source: meta.source ?? "local",
    c3: meta.c3,
    deploy: meta.deploy,
    files: listTemplateFiles(id),
  };
}

export { templateStack } from "./template-meta";
