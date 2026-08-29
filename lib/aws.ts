import crypto from "node:crypto";
import { getConfig } from "./config";
import type { BindingResource, DeployTarget, EnvVar, Project } from "./types";

export interface AwsCredentials {
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
}

export async function resolveAwsCredentials(project?: Project | null): Promise<AwsCredentials | null> {
  const cfg = await getConfig();
  const accessKeyEnv = cfg.aws.accessKeyEnv || "AWS_ACCESS_KEY_ID";
  const secretKeyEnv = cfg.aws.secretKeyEnv || "AWS_SECRET_ACCESS_KEY";

  let accessKeyId = process.env[accessKeyEnv]?.trim() || "";
  let secretAccessKey = process.env[secretKeyEnv]?.trim() || "";
  const region = project?.awsRegion || cfg.aws.defaultRegion || "us-east-1";

  if (project?.awsAccessKeyEnc || project?.awsSecretKeyEnc) {
    const { decrypt, hasSecretKey } = await import("./crypto");
    if (hasSecretKey()) {
      if (project.awsAccessKeyEnc) {
        try {
          accessKeyId = (await decrypt(project.awsAccessKeyEnc)).trim() || accessKeyId;
        } catch {
          // fall back to env
        }
      }
      if (project.awsSecretKeyEnc) {
        try {
          secretAccessKey = (await decrypt(project.awsSecretKeyEnc)).trim() || secretAccessKey;
        } catch {
          // fall back to env
        }
      }
    }
  }

  if (!accessKeyId || !secretAccessKey) return null;
  return { accessKeyId, secretAccessKey, region };
}

// ── SigV4 (hand-rolled, no SDK) ─────────────────────────────────────────────

type SignOptions = {
  method: string;
  service: string;
  host: string;
  path: string;
  query?: string;
  headers?: Record<string, string>;
  body?: string | null;
};

function hmac(key: Buffer | string, data: string | Buffer): Buffer {
  return crypto.createHmac("sha256", key).update(data).digest();
}

function sha256(data: string | Buffer): Buffer {
  return crypto.createHash("sha256").update(data).digest();
}

function amortize(value: string): string {
  return value.replace(/[^a-z0-9-]/g, (c) => {
    const code = c.charCodeAt(0).toString(16).toUpperCase();
    return code.length === 1 ? `%0${code}` : `%${code}`;
  });
}

function canonicalUri(path: string): string {
  return path
    .split("/")
    .map((seg) => (seg === "" ? seg : amortize(seg)))
    .join("/");
}

function signRequest(creds: AwsCredentials, opts: SignOptions): Record<string, string> {
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = amzDate.slice(0, 8);
  const region = creds.region;
  const service = opts.service;
  const scope = `${dateStamp}/${region}/${service}/aws4_request`;

  const host = opts.host;
  const method = opts.method.toUpperCase();
  const uri = canonicalUri(opts.path || "/");
  const query = opts.query ?? "";
  const payloadHash = sha256(opts.body ?? "").toString("hex");

  const contentType = opts.headers?.["content-type"] ?? (opts.body ? "application/json" : "");
  const target = opts.headers?.["x-amz-target"];

  let canonicalHeaders = `host:${host}\n`;
  let signedHeaders = "host";
  if (contentType) {
    canonicalHeaders += `content-type:${contentType}\n`;
    signedHeaders += ";content-type";
  }
  if (target) {
    canonicalHeaders += `x-amz-target:${target}\n`;
    signedHeaders += ";x-amz-target";
  }
  canonicalHeaders += `x-amz-content-sha256:${payloadHash}\n`;
  canonicalHeaders += `x-amz-date:${amzDate}\n`;
  signedHeaders += ";x-amz-content-sha256;x-amz-date";

  const canonicalRequest = [
    method,
    uri,
    query,
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");

  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    scope,
    sha256(canonicalRequest).toString("hex"),
  ].join("\n");

  const kDate = hmac(`AWS4${creds.secretAccessKey}`, dateStamp);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, service);
  const kSigning = hmac(kService, "aws4_request");
  const signature = hmac(kSigning, stringToSign).toString("hex");

  return {
    "x-amz-date": amzDate,
    "x-amz-content-sha256": payloadHash,
    host,
    ...(contentType ? { "content-type": contentType } : {}),
    ...(target ? { "x-amz-target": target } : {}),
    authorization: `AWS4-HMAC-SHA256 Credential=${creds.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };
}

type AwsResult = { status: number; ok: boolean; json: unknown; text: string };

async function awsFetch(
  creds: AwsCredentials,
  opts: SignOptions,
  hostPort?: string
): Promise<AwsResult> {
  const signed = signRequest(creds, opts);
  const schemeHost = `https://${opts.host}${hostPort ?? ""}`;
  const url = `${schemeHost}${opts.path}${opts.query ? `?${opts.query}` : ""}`;
  const res = await fetch(url, {
    method: opts.method,
    headers: signed,
    body: opts.body ?? undefined,
  });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { status: res.status, ok: res.ok, json, text };
}

function apiError(res: AwsResult, context: string): Error {
  const message =
    (res.json as { message?: string } | null)?.message ||
    (res.json as { errorMessage?: string } | null)?.errorMessage ||
    (res.json as { Type?: string; message?: string } | null)?.message ||
    (res.ok ? res.text : `HTTP ${res.status}`);
  return new Error(`${context}: ${message}`);
}

// ── Amplify ─────────────────────────────────────────────────────────────────

const amplifyRegionHost = (region: string) => `amplify.${region}.amazonaws.com`;
const amplifyAppName = (projectName: string) => `launchpad-${projectName}`;

async function amplifyRequest(
  creds: AwsCredentials,
  method: string,
  path: string,
  body?: unknown
): Promise<AwsResult> {
  return awsFetch(creds, {
    method,
    service: "amplify",
    host: amplifyRegionHost(creds.region),
    path,
    headers: body !== undefined ? { "content-type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : null,
  });
}

export async function getAmplifyApp(creds: AwsCredentials, projectName: string): Promise<string | null> {
  const want = amplifyAppName(projectName);
  const res = await amplifyRequest(creds, "GET", "/apps");
  if (!res.ok) throw apiError(res, "Failed to list Amplify apps");
  const apps = (res.json as { apps?: Array<{ appId?: string; name?: string }> })?.apps ?? [];
  return apps.find((a) => a.name === want)?.appId ?? null;
}

export async function getAmplifyDefaultDomain(
  creds: AwsCredentials,
  projectName: string
): Promise<string | null> {
  const appId = await getAmplifyApp(creds, projectName);
  if (!appId) return null;
  const res = await amplifyRequest(creds, "GET", `/apps/${encodeURIComponent(appId)}`);
  if (!res.ok) return null;
  const app = res.json as { app?: { defaultDomain?: string } };
  if (!app.app?.defaultDomain) return null;
  return `https://${app.app.defaultDomain}`;
}

export async function getLambdaStackOutputs(
  creds: AwsCredentials,
  projectName: string
): Promise<Record<string, string>> {
  const body = JSON.stringify({
    StackName: `launchpad-${projectName}`,
  });
  const res = await awsFetch(creds, {
    method: "POST",
    service: "cloudformation",
    host: `cloudformation.${creds.region}.amazonaws.com`,
    path: "/",
    headers: {
      "content-type": "application/x-amz-json-1.1",
      "x-amz-target": "CloudFormation.DescribeStacks",
    },
    body,
  });
  if (!res.ok) throw apiError(res, "Failed to describe CloudFormation stack");
  const data = res.json as {
    Stacks?: Array<{ Outputs?: Array<{ OutputKey?: string; OutputValue?: string }> }>;
  };
  const outputs: Record<string, string> = {};
  for (const o of data.Stacks?.[0]?.Outputs ?? []) {
    if (o.OutputKey && o.OutputValue) outputs[o.OutputKey] = o.OutputValue;
  }
  return outputs;
}

export async function getLambdaUrl(creds: AwsCredentials, projectName: string): Promise<string | null> {
  try {
    const outputs = await getLambdaStackOutputs(creds, projectName);
    return outputs.ApiUrl ?? outputs.FunctionUrl ?? null;
  } catch {
    return null;
  }
}

export function deriveLiveUrl(
  project: Pick<Project, "name" | "type" | "liveUrl">
): string | null {
  return project.liveUrl ?? null;
}

export async function deleteAwsProject(
  type: DeployTarget,
  name: string,
  creds: AwsCredentials
): Promise<void> {
  if (type === "amplify") {
    const appId = await getAmplifyApp(creds, name);
    if (!appId) return;
    const res = await amplifyRequest(creds, "DELETE", `/apps/${encodeURIComponent(appId)}`);
    if (!res.ok) throw apiError(res, "Failed to delete Amplify app");
    return;
  }
  const body = JSON.stringify({ StackName: `launchpad-${name}` });
  const res = await awsFetch(creds, {
    method: "POST",
    service: "cloudformation",
    host: `cloudformation.${creds.region}.amazonaws.com`,
    path: "/",
    headers: {
      "content-type": "application/x-amz-json-1.1",
      "x-amz-target": "CloudFormation.DeleteStack",
    },
    body,
  });
  if (!res.ok) throw apiError(res, "Failed to delete CloudFormation stack");
}

export async function listEnvVars(
  type: DeployTarget,
  name: string,
  creds: AwsCredentials
): Promise<EnvVar[]> {
  if (type === "amplify") {
    const appId = await getAmplifyApp(creds, name);
    if (!appId) return [];
    const res = await amplifyRequest(creds, "GET", `/apps/${encodeURIComponent(appId)}`);
    if (!res.ok) throw apiError(res, "Failed to read Amplify app");
    const app = res.json as { app?: { environmentVariables?: Record<string, string> } };
    const env = app.app?.environmentVariables ?? {};
    return Object.keys(env).map((key) => ({ key, kind: "text" as const }));
  }
  try {
    const outputs = await getLambdaStackOutputs(creds, name);
    return Object.keys(outputs)
      .filter((k) => /^Env([A-Z_]+)$/.test(k))
      .map((k) => ({ key: k.replace(/^Env([A-Z_]+)$/, "$1"), kind: "text" as const }));
  } catch {
    return [];
  }
}

export async function setEnvVar(
  type: DeployTarget,
  name: string,
  key: string,
  value: string,
  isSecret: boolean,
  creds: AwsCredentials
): Promise<void> {
  void isSecret;
  if (type === "amplify") {
    const appId = await getAmplifyApp(creds, name);
    if (!appId) throw new Error("Amplify app not found.");
    const get = await amplifyRequest(creds, "GET", `/apps/${encodeURIComponent(appId)}`);
    if (!get.ok) throw apiError(get, "Failed to read Amplify app");
    const app = get.json as { app?: { environmentVariables?: Record<string, string> } };
    const env = { ...(app.app?.environmentVariables ?? {}), [key]: value };
    const res = await amplifyRequest(creds, "PATCH", `/apps/${encodeURIComponent(appId)}`, {
      environmentVariables: env,
    });
    if (!res.ok) throw apiError(res, "Failed to update Amplify app");
    return;
  }
  throw new Error(
    "Setting Lambda env vars directly is not supported; edit the SAM template and push to redeploy."
  );
}

export async function deleteEnvVar(
  type: DeployTarget,
  name: string,
  key: string,
  creds: AwsCredentials
): Promise<void> {
  if (type === "amplify") {
    const appId = await getAmplifyApp(creds, name);
    if (!appId) throw new Error("Amplify app not found.");
    const get = await amplifyRequest(creds, "GET", `/apps/${encodeURIComponent(appId)}`);
    if (!get.ok) throw apiError(get, "Failed to read Amplify app");
    const app = get.json as { app?: { environmentVariables?: Record<string, string> } };
    const env = { ...(app.app?.environmentVariables ?? {}) };
    delete env[key];
    const res = await amplifyRequest(creds, "PATCH", `/apps/${encodeURIComponent(appId)}`, {
      environmentVariables: env,
    });
    if (!res.ok) throw apiError(res, "Failed to update Amplify app");
    return;
  }
  throw new Error(
    "Deleting Lambda env vars directly is not supported; edit the SAM template and push to redeploy."
  );
}

// ── DynamoDB / S3 (resource listing for bindings parity) ────────────────────

export async function listDynamoTables(creds: AwsCredentials): Promise<BindingResource[]> {
  const res = await awsFetch(creds, {
    method: "POST",
    service: "dynamodb",
    host: `dynamodb.${creds.region}.amazonaws.com`,
    path: "/",
    headers: { "content-type": "application/x-amz-json-1.0", "x-amz-target": "DynamoDB_20120810.ListTables" },
    body: "{}",
  });
  if (!res.ok) throw apiError(res, "Failed to list DynamoDB tables");
  const names = (res.json as { TableNames?: string[] })?.TableNames ?? [];
  return names.map((n) => ({ type: "d1" as const, name: n, id: n }));
}

export async function createDynamoTable(creds: AwsCredentials, name: string): Promise<void> {
  const res = await awsFetch(creds, {
    method: "POST",
    service: "dynamodb",
    host: `dynamodb.${creds.region}.amazonaws.com`,
    path: "/",
    headers: { "content-type": "application/x-amz-json-1.0", "x-amz-target": "DynamoDB_20120810.CreateTable" },
    body: JSON.stringify({
      TableName: name,
      AttributeDefinitions: [{ AttributeName: "pk", AttributeType: "S" }],
      KeySchema: [{ AttributeName: "pk", KeyType: "HASH" }],
      BillingMode: "PAY_PER_REQUEST",
    }),
  });
  if (!res.ok) throw apiError(res, "Failed to create DynamoDB table");
}

export async function listS3Buckets(creds: AwsCredentials): Promise<BindingResource[]> {
  const res = await awsFetch(creds, {
    method: "GET",
    service: "s3",
    host: `s3.${creds.region}.amazonaws.com`,
    path: "/",
  });
  if (!res.ok) throw apiError(res, "Failed to list S3 buckets");
  const names = (res.json as { Buckets?: Array<{ Name?: string }> })?.Buckets?.map((b) => b.Name) ?? [];
  const buckets: string[] = [];
  for (const n of names) if (n) buckets.push(n);
  return buckets.map((n) => ({ type: "r2" as const, name: n, id: n }));
}

export async function createS3Bucket(creds: AwsCredentials, name: string): Promise<void> {
  const regional = /^(us-east-2|us-west-1|us-west-2|eu-|ap-|sa-|ca-|me-|af-)/.test(creds.region);
  const host = regional ? `s3.${creds.region}.amazonaws.com` : "s3.amazonaws.com";
  const res = await awsFetch(creds, {
    method: "PUT",
    service: "s3",
    host,
    path: `/${name}`,
  });
  if (!res.ok) throw apiError(res, "Failed to create S3 bucket");
}

export async function listCfnStacks(creds: AwsCredentials): Promise<string[]> {
  const res = await awsFetch(creds, {
    method: "POST",
    service: "cloudformation",
    host: `cloudformation.${creds.region}.amazonaws.com`,
    path: "/",
    headers: { "content-type": "application/x-amz-json-1.1", "x-amz-target": "CloudFormation.DescribeStacks" },
    body: "{}",
  });
  if (!res.ok) throw apiError(res, "Failed to list CloudFormation stacks");
  const stacks = (res.json as { Stacks?: Array<{ StackName?: string; StackStatus?: string }> })?.Stacks ?? [];
  return stacks
    .filter((s) => s.StackStatus && s.StackStatus !== "DELETE_COMPLETE")
    .map((s) => s.StackName ?? "");
}
