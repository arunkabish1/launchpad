export type DeployTarget = "worker" | "pages" | "lambda" | "amplify";

export type Provider = "cloudflare" | "aws";

export function providerForTarget(type: DeployTarget): Provider {
  return type === "lambda" || type === "amplify" ? "aws" : "cloudflare";
}

export type ProjectStatus =
  | "queued"
  | "running"
  | "success"
  | "failure"
  | "cancelled"
  | "no-runs"
  | "unknown";

export type TemplateSource = "local" | "c3" | "aws";

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
  provider: Provider;
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

export interface AwsConfig {
  accessKeyEnv: string;
  secretKeyEnv: string;
  defaultRegion: string;
}

export interface GithubConfig {
  patEnvVar: string;
  org: string;
}

export interface LaunchpadConfig {
  cloudflare: CloudflareConfig;
  aws: AwsConfig;
  github: GithubConfig;
}

export interface ConfigStatus {
  adminPasswordSet: boolean;
  patEnvSet: boolean;
  cloudflareTokenSet: boolean;
  defaultAccountId: string;
  secretKeySet: boolean;
  org: string;
  awsAccessKeySet: boolean;
  awsSecretKeySet: boolean;
  awsRegion: string;
}

export type GlobalRole = "admin" | "member";

export interface SessionUser {
  id: string;
  username: string;
  globalRole: GlobalRole;
}

export type ProjectRole = "owner" | "member";

export type SiteAccessMode = "public" | "org" | "members";

export type GithubInviteState = "none" | "pending" | "active" | "failed";

export interface UserRecord {
  id: string;
  username: string;
  githubUsername: string | null;
  globalRole: GlobalRole;
  createdAt: string;
  createdBy: string | null;
}

export interface Membership {
  projectId: string;
  userId: string;
  username: string;
  role: ProjectRole;
  githubUsername: string | null;
  githubInviteState: GithubInviteState;
  githubInviteError?: string;
  createdAt: string;
}

export interface Invite {
  tokenHash: string;
  projectId: string;
  projectName: string;
  role: ProjectRole;
  createdBy: string;
  createdAt: string;
  expiresAt: string;
  acceptedAt: string | null;
  acceptedBy: string | null;
}

export interface Project {
  id: string;
  name: string;
  templateId: string;
  templateName: string;
  type: DeployTarget;
  provider: Provider;
  route: string | null;
  owner: string;
  repo: string;
  githubUrl: string;
  createdAt: string;
  liveUrl: string | null;
  createdBy?: string;
  patEnc?: string;
  awsAccessKeyEnc?: string;
  awsSecretKeyEnc?: string;
  awsRegion?: string;
  envVars?: StoredEnvVar[];
  serviceBindings?: ServiceBinding[];
  previewEnabled?: boolean;
  previewKeyEnc?: string;
  imported?: boolean;
  configApplied?: boolean;
  siteAccess?: SiteAccessMode;
  siteAccessKey?: string;
  siteAccessKeyEnc?: string;
  siteAccessPrevMain?: string;
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
  liveUrl?: string | null;
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
  | "provision_disable"
  | "config_applied"
  | "invite_create"
  | "invite_revoke"
  | "invite_accept"
  | "member_add"
  | "member_remove"
  | "member_role_change"
  | "collaborator_add"
  | "collaborator_remove"
  | "site_access_enable"
  | "site_access_disable"
  | "site_access_rotate";

export interface AuditEntry {
  at: string;
  actor: string;
  action: AuditAction;
  project: string;
  detail: string;
  outcome: "ok" | "error";
}

export interface LaunchBindingConfig {
  type: Exclude<BindingType, "turnstile">;
  name: string;
  resource: string;
}

export interface LaunchEnvVarConfig {
  key: string;
  value: string;
  kind: "secret" | "text";
}

export interface LaunchConfig {
  envVars?: LaunchEnvVarConfig[];
  bindings?: LaunchBindingConfig[];
  previewEnabled?: boolean;
  provisionEnabled?: boolean;
}

export interface LaunchRequest {
  templateId: string;
  projectName: string;
  route?: string;
  private?: boolean;
  githubPat?: string;
  cloudflareToken?: string;
  accountId?: string;
  awsAccessKey?: string;
  awsSecretKey?: string;
  awsRegion?: string;
  config?: LaunchConfig;
  actor?: string;
  actorId?: string;
}

export interface ProjectDetail {
  project: Project;
  status: ProjectStatusResult;
  template: TemplateInfo;
}

export type ImportDeployKind = "static" | "worker" | "pages" | "needs-adaptation" | "unsupported";

export interface DetectedEnvVar {
  key: string;
  kind: "secret" | "text";
}

export interface Detection {
  framework: string | null;
  deployKind: ImportDeployKind;
  buildCommand: string;
  outputDir: string | null;
  runtime: "node" | "python" | "other";
  packageManager: string | null;
  hasLockfile: boolean;
  alreadyHasCloudflareConfig: boolean;
  envVars: DetectedEnvVar[];
  serverOnlyDeps: string[];
  blockers: string[];
}

export interface DeployPlan {
  deployKind: ImportDeployKind;
  framework: string | null;
  buildCommand: string;
  outputDir: string | null;
  deployCommand: string;
  packageManager: string | null;
  runtime: "node" | "python" | "other";
  envVars: DetectedEnvVar[];
  alreadyHasCloudflareConfig: boolean;
  summary: string;
  notes: string[];
  model: string;
}

export interface GuidedFix {
  reason: string;
  instruction: string;
  effort: "easy" | "medium" | "hard";
}

export interface ImportAnalysis {
  detection: Detection;
  plan: DeployPlan | null;
  guidedFix: GuidedFix | null;
  files: string[];
  defaultBranch: string;
  repoTitle: string;
}
