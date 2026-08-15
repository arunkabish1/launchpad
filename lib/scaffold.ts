import { listTemplateFiles, getTemplateAsset } from "./template-assets";
import type { TemplateInfo } from "./types";

export const PROJECT_NAME_PLACEHOLDER = "__PROJECT_NAME__";
export const ROUTE_PLACEHOLDER = "__ROUTE__";

export interface ScaffoldOptions {
  projectName: string;
  route?: string | null;
}

const BINARY_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".woff", ".woff2"]);

export interface ScaffoldedFile {
  path: string;
  content: string;
  binary?: boolean;
}

export function buildScaffoldFiles(template: TemplateInfo, opts: ScaffoldOptions): ScaffoldedFile[] {
  const files: ScaffoldedFile[] = [];
  for (const rel of listTemplateFiles(template.id)) {
    const data = getTemplateAsset(template.id, rel);
    if (!data) continue;
    const dstName = replaceInString(rel, opts);
    const binary = BINARY_EXTENSIONS.has(rel.slice(rel.lastIndexOf(".")).toLowerCase());
    if (binary) {
      files.push({ path: dstName, content: data.toString("base64"), binary: true });
    } else {
      files.push({ path: dstName, content: replaceInString(data.toString("utf8"), opts) });
    }
  }
  return files;
}

function replaceInString(input: string, opts: ScaffoldOptions): string {
  let out = input;
  out = out.split(PROJECT_NAME_PLACEHOLDER).join(opts.projectName);
  if (opts.route) {
    out = out.split(ROUTE_PLACEHOLDER).join(opts.route);
  } else {
    out = out.split(ROUTE_PLACEHOLDER).join("");
  }
  return out;
}
