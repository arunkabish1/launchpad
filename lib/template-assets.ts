import {
  TEMPLATE_ASSETS,
  TEMPLATE_META,
  PROVISION_SCRIPT,
  PREVIEW_SCRIPT,
} from "./template-assets.gen";

function decode(b64: string): Buffer {
  return Buffer.from(b64, "base64");
}

export function getTemplateMetaJson(templateId: string): unknown | null {
  return TEMPLATE_META[templateId] ?? null;
}

export function listTemplateIds(): string[] {
  return Object.keys(TEMPLATE_META).sort();
}

export function listTemplateFiles(templateId: string): string[] {
  const prefix = `${templateId}/`;
  return Object.keys(TEMPLATE_ASSETS)
    .filter((k) => k.startsWith(prefix))
    .map((k) => k.slice(prefix.length))
    .sort();
}

export function getTemplateAsset(templateId: string, relPath: string): Buffer | null {
  const b64 = TEMPLATE_ASSETS[`${templateId}/${relPath}`];
  return b64 ? decode(b64) : null;
}

export function getProvisionScript(): string {
  return PROVISION_SCRIPT;
}

export function getPreviewScript(): string {
  return PREVIEW_SCRIPT;
}
