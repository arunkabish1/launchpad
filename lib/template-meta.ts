import type { TemplateCategory, TemplateInfo } from "./types";

export interface CategoryMeta {
  id: TemplateCategory;
  label: string;
  description: string;
}

export const CATEGORIES: CategoryMeta[] = [
  { id: "javascript", label: "JavaScript", description: "Plain JavaScript Workers and apps." },
  { id: "typescript", label: "TypeScript", description: "Typed Workers and full-stack starters." },
  { id: "python", label: "Python", description: "Python Workers on the edge." },
  { id: "framework", label: "Frameworks", description: "Astro, Hono, Next.js and Express apps." },
  { id: "static", label: "Static", description: "Static sites served by Cloudflare Pages." },
];

const STACK_LABELS: Record<string, string> = {
  "c3-worker-ts": "TypeScript",
  "c3-worker-js": "JavaScript",
  "c3-worker-python": "Python",
  "c3-astro": "Astro",
  "c3-hono": "Hono",
  "c3-next": "Next.js",
  "worker-ts": "TypeScript",
  "worker-js": "JavaScript",
  "node-express": "Express",
  "pages-static": "HTML/CSS",
};

export function templateStack(t: Pick<TemplateInfo, "id" | "type" | "deploy">): string {
  if (t.deploy?.runtime === "python") return "Python";
  return STACK_LABELS[t.id] ?? (t.type === "pages" ? "Static" : "Worker");
}
