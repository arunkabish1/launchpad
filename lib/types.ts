export type DeployTarget = "worker" | "pages";

export type ProjectStatus =
  | "queued"
  | "running"
  | "success"
  | "failure"
  | "cancelled"
  | "no-runs"
  | "unknown";

export type TemplateSource = "local" | "c3";

export type TemplateCategory =
  | "javascript"
  | "typescript"
  | "python"
  | "framework"
  | "static";

export interface C3Config {
  args: string[];
  platform: "workers" | "pages";
}

export interface DeployConfig {
  setup: string;
  command: string;
  wranglerVersion?: string;
  runtime?: "node" | "python";
}

export interface TemplateInfo {
  id: string;
  name: string;
  description: string;
  type: DeployTarget;
  category: TemplateCategory;
  deployCommand: string;
  buildCommand: string;
  requiresRoute: boolean;
  files: string[];
  source: TemplateSource;
  c3?: C3Config;
  deploy?: DeployConfig;
}

export interface CloudflareConfig {
  defaultAccountId: string;
}

export interface GithubConfig {
  patEnvVar: string;
  org: string;
}

export interface LaunchpadConfig {
  cloudflare: CloudflareConfig;
  github: GithubConfig;
}

export interface ConfigStatus {
  adminPasswordSet: boolean;
  patEnvSet: boolean;
  cloudflareTokenSet: boolean;
  defaultAccountId: string;
  secretKeySet: boolean;
  org: string;
}

export interface Project {
  id: string;
  name: string;
  templateId: string;
  templateName: string;
  type: DeployTarget;
  route: string | null;
  owner: string;
  repo: string;
  githubUrl: string;
  createdAt: string;
  liveUrl: string | null;
  patEnc?: string;
  envVars?: StoredEnvVar[];
  serviceBindings?: ServiceBinding[];
  previewEnabled?: boolean;
  previewKeyEnc?: string;
}

export interface StoredEnvVar {
  key: string;
  kind: "secret" | "text";
  valueEnc?: string;
}

export interface DeployRun {
  status: string;
  conclusion: string | null;
  runId: number;
  htmlUrl: string;
  createdAt: string | null;
  updatedAt: string | null;
  headSha: string | null;
  name: string;
}

export interface ProjectStatusResult {
  latest: DeployRun | null;
  status: ProjectStatus;
  totalRuns: number;
  runs: DeployRun[];
  error?: string;
}

export interface JobStep {
  name: string;
  status: string;
  conclusion: string | null;
}

export interface RunLog {
  steps: JobStep[];
  text: string;
}

export interface EnvVar {
  key: string;
  kind: "secret" | "text";
}

export type BindingType = "kv" | "d1" | "r2" | "turnstile" | "ai_search";

export interface ServiceBinding {
  type: "turnstile";
  name: string;
  resource: string;
  id: string;
}

export interface Binding {
  type: BindingType;
  name: string;
  resource: string;
  id?: string;
}

export interface BindingResource {
  type: BindingType;
  name: string;
  id?: string;
}

export type AuditAction =
  | "login"
  | "logout"
  | "launch"
  | "launch_failed"
  | "redeploy"
  | "delete"
  | "env_set"
  | "env_delete"
  | "binding_add"
  | "binding_remove"
  | "preview_enable"
  | "preview_disable"
  | "provision_enable"
  | "provision_disable";

export interface AuditEntry {
  at: string;
  actor: string;
  action: AuditAction;
  project: string;
  detail: string;
  outcome: "ok" | "error";
}

export interface LaunchRequest {
  templateId: string;
  projectName: string;
  route?: string;
  private?: boolean;
  githubPat?: string;
  cloudflareToken?: string;
  accountId?: string;
  actor?: string;
}

export interface ProjectDetail {
  project: Project;
  status: ProjectStatusResult;
  template: TemplateInfo;
}
