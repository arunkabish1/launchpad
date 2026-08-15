import type { TemplateInfo } from "./types";

export interface WorkflowOptions {
  projectName: string;
  hasLockfile: boolean;
  provision?: boolean;
}

const PROVISION_STEP = `      - name: Provision resources
        if: hashFiles('.launchpad/provision.mjs') != ''
        run: node .launchpad/provision.mjs
        env:
          CLOUDFLARE_API_TOKEN: \${{ secrets.CLOUDFLARE_API_TOKEN }}
          CLOUDFLARE_ACCOUNT_ID: \${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
          LP_ENV_MASTER_KEY: \${{ secrets.LP_ENV_MASTER_KEY }}
`;

export function renderDeployWorkflow(
  template: TemplateInfo,
  options: WorkflowOptions
): string {
  const { projectName, hasLockfile, provision } = options;
  const platform = template.type === "pages" ? "Pages" : "Workers";
  const provisionStep = provision && template.type !== "pages" ? PROVISION_STEP : "";

  const setup = template.deploy?.setup ?? "";
  const command = template.deploy?.command ?? template.deployCommand;
  const runtime = template.deploy?.runtime ?? "node";

  const header = `name: Deploy to Cloudflare ${platform}

on:
  push:
    branches: [main]
  workflow_dispatch:

concurrency:
  group: ${projectName}-deploy
  cancel-in-progress: false

jobs:
  deploy:
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@v4
`;

  if (runtime === "python") {
    const runCmd = hasLockfile ? setup.replace("npm install", "npm ci") : setup;
    const cacheLine = hasLockfile ? "          cache: npm\n" : "";
    return `${header}      - uses: actions/setup-node@v4
        with:
          node-version: 22
${cacheLine}
      - name: Install uv
        uses: astral-sh/setup-uv@v10.0.1

      - run: ${runCmd}
${provisionStep}      - name: Deploy to Cloudflare ${platform}
        run: ${command}
        env:
          CLOUDFLARE_API_TOKEN: \${{ secrets.CLOUDFLARE_API_TOKEN }}
          CLOUDFLARE_ACCOUNT_ID: \${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
`;
  }

  const hasNodeSteps = setup.length > 0;
  const wranglerVersion = template.deploy?.wranglerVersion;

  const runCmd = hasLockfile ? setup.replace("npm install", "npm ci") : setup;
  const cacheLine = hasLockfile ? "          cache: npm\n" : "";
  const versionLine = wranglerVersion
    ? `          wranglerVersion: '${wranglerVersion}'\n`
    : "";

  const setupSteps = hasNodeSteps
    ? `      - uses: actions/setup-node@v4
        with:
          node-version: 22
${cacheLine}
      - run: ${runCmd}
`
    : "";

  return `${header}${setupSteps}${provisionStep}      - name: Deploy to Cloudflare ${platform}
        uses: cloudflare/wrangler-action@v3
        with:
          apiToken: \${{ secrets.CLOUDFLARE_API_TOKEN }}
          accountId: \${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
${versionLine}          command: ${command}
`;
}

export interface PreviewWorkflowOptions extends WorkflowOptions {
  runtime?: "node" | "python";
  deployCommand?: string;
}

export function renderPreviewWorkflow(
  template: TemplateInfo,
  options: PreviewWorkflowOptions
): string {
  const { hasLockfile, deployCommand } = options;
  const runtime = template.deploy?.runtime ?? "node";
  const deployCmd =
    deployCommand ??
    (runtime === "python" ? "uv run pywrangler deploy" : "npx wrangler deploy");

  const header = `name: Preview (branch)

on:
  push:
    branches-ignore: [main]
  pull_request:
    types: [opened, synchronize, reopened, closed]
  delete:

concurrency:
  group: preview-\${{ github.event_name == 'pull_request' && github.event.pull_request.head.ref || github.ref_name }}
  cancel-in-progress: true

permissions:
  contents: read

jobs:
  preview:
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@v4
`;

  const setup = template.deploy?.setup ?? "";
  const runCmd = hasLockfile ? setup.replace("npm install", "npm ci") : setup;
  const cacheLine = hasLockfile ? "          cache: npm\n" : "";

  let setupSteps: string;
  if (runtime === "python") {
    setupSteps = `      - uses: actions/setup-node@v4
        with:
          node-version: 22
${cacheLine}
      - uses: astral-sh/setup-uv@v10.0.1

      - run: ${runCmd}
`;
  } else if (setup.length > 0) {
    setupSteps = `      - uses: actions/setup-node@v4
        with:
          node-version: 22
${cacheLine}
      - run: ${runCmd}
`;
  } else {
    setupSteps = "";
  }

  const previewEnv = `        env:
          CLOUDFLARE_API_TOKEN: \${{ secrets.CLOUDFLARE_API_TOKEN }}
          CLOUDFLARE_ACCOUNT_ID: \${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
          LP_ENV_MASTER_KEY: \${{ secrets.LP_ENV_MASTER_KEY }}
          PREVIEW_DEPLOY_CMD: ${deployCmd}
`;

  return `${header}${setupSteps}      - name: Deploy preview
        if: github.event_name != 'delete' && github.event.action != 'closed'
        run: node .launchpad/preview.mjs deploy
${previewEnv}
      - name: Teardown preview
        if: github.event_name == 'delete' || github.event.action == 'closed'
        run: node .launchpad/preview.mjs teardown
${previewEnv}`;
}
