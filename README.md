# Launchpad

Internal launchpad for scaffolding apps and deploying them to **Cloudflare** (Workers and Pages)
and **AWS** (Lambda + API Gateway via SAM, and Amplify). Pick a language and template, configure
deployment options, and Launchpad:

1. Scaffolds the project (built-in templates or `create-cloudflare`/live scaffolders).
2. Creates a GitHub repo — under your account, or a configured org (`launchpad.json` → `github.org`).
3. Sets deploy secrets on the repo (GitHub-encrypted) — Cloudflare depends on `CLOUDFLARE_API_TOKEN`
   / `CLOUDFLARE_ACCOUNT_ID`; AWS uses `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` / `AWS_REGION`.
4. Pushes the code; a GitHub Actions workflow deploys it to the chosen provider.

## Getting Started

```bash
cp .env.example .env     # fill in credentials (see below)
npm install
npm run dev
```

Open http://localhost:3000 and sign in with the shared password from `LAUNCHPAD_ADMIN_PASSWORD` and
a username. The first person to sign in (or the one using `LAUNCHPAD_ADMIN_USER`, default `admin`)
becomes the global admin.

## Required credentials

| Variable | Purpose |
| --- | --- |
| `GITHUB_PAT` | Create repos, set repo secrets, read deploy status. Scopes: `repo`, `workflow`. |
| `CLOUDFLARE_API_TOKEN` | Create/delete Cloudflare projects, manage env vars. Edit perms on the account. |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare account the projects are deployed to. |
| `AWS_ACCESS_KEY_ID` | AWS access key used to manage/deploy Lambda (SAM) and Amplify projects. |
| `AWS_SECRET_ACCESS_KEY` | AWS secret key paired with `AWS_ACCESS_KEY_ID`. |
| `AWS_REGION` | Default AWS region (defaults to `us-east-1`). Overridable per project at launch. |
| `LAUNCHPAD_ADMIN_PASSWORD` | Password for signing in to the Launchpad UI. |
| `LAUNCHPAD_ADMIN_USER` | Username that is granted the global admin role on sign-in (default `admin`). |
| `LAUNCHPAD_SECRET` | Key used to encrypt per-project GitHub tokens at rest (`data/`). |
| `LAUNCHPAD_SESSION_SECRET` | Optional; defaults to `LAUNCHPAD_SECRET`. Signs login sessions. |

> The AWS env var *names* (`accessKeyEnv` / `secretKeyEnv`) and the default region are configurable
> in `launchpad.json` → `aws` (and overridable via the Settings panel). AWS keys can also be entered
> per project at launch; if provided, they are encrypted at rest on the project and take precedence
> over the server env vars.

Generate a secret key:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

## Security model

- **Login**: single shared org password plus a per-user username (HMAC-signed session cookie, 8h
  TTL, HttpOnly, SameSite=Strict). Unknown usernames are rejected unless they are the global admin
  or the very first user. All `/api/*` endpoints require a valid session; mutating endpoints also
  reject cross-origin requests. Failed logins are rate-limited per IP.
- **Project access**: each project has members (`owner` / `member`). Owners create single-use invite
  links (7-day TTL) that grant Launchpad access and, when the invitee supplies a GitHub handle,
  add them as a repo collaborator (`admin` for owners, `push` for members). Non-admins only see
  projects they belong to; global admins see everything.
- **Credentials at rest**: any GitHub token entered at launch time is encrypted with
  `LAUNCHPAD_SECRET` before being written to `data/projects.json`. If `LAUNCHPAD_SECRET` is not
  set, per-project tokens are not persisted (the server-side `GITHUB_PAT` is used instead).
- **Deploy secrets**: provider credentials are set as repo secrets on each launched repo, which
  GitHub stores encrypted — Cloudflare (`CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID`) for CF
  projects, AWS (`AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` / `AWS_REGION`) for AWS projects.
  They are never returned by Launchpad APIs. AWS keys provided at launch are additionally encrypted
  at rest on the project (`LAUNCHPAD_SECRET`).
- **Audit log**: sign-ins, sign-outs, launches, re-deploys, deletes, and env-var changes are
  appended to `data/audit.jsonl` (viewable under Settings → Recent activity).
- **Least privilege**: give the GitHub token only `repo` + `workflow` on the org/account it needs,
  the Cloudflare token only the Edit permissions needed for Workers and Pages, and the AWS key only
  the IAM permissions needed for Lambda/SAM/Amplify. A credential with org-wide or account-wide
  admin powers grants whoever knows the Launchpad password full access to those resources.

## Hosting

This app **cannot** run on Cloudflare Workers/Pages itself — it uses the local filesystem
(`data/`, `templates/`) and spawns `npm create cloudflare` when scaffolding C3 templates. Deploy it
to any Node host: a VPS, Docker, Fly.io, Railway, Render, or similar.

Env vars should be set on the host platform's secret store, not committed anywhere. `data/` and
`.env` are gitignored; keep `.env` permissions at `600`.

## AWS deployments

Launchpad can also deploy to AWS alongside Cloudflare. AWS templates are marked `provider: "aws"`
and target one of two targets:

- **AWS Lambda (SAM)** — a serverless REST/function app. The scaffold includes a SAM
  `template.yaml` + `samconfig.toml` and a GitHub Actions workflow that runs `sam build` /
  `sam deploy`, creating the deployed Lambda function, API Gateway, and env vars. The live URL
  comes from the stack's `ApiUrl` output. Requires `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, and
  `AWS_REGION` repo secrets (set at launch).
- **AWS Amplify** — a static site / Next.js app. The scaffold includes an Amplify backend
  (`backend.ts` or `amplify.yml`) plus a workflow that deploys via the Amplify CLI / CodeBuild. Its
  repo runs GitHub Actions with the same `AWS_*` repo secrets.

Notes:

- **Credentials**: Launchpad resolves AWS access keys from the server env vars, or from encrypted
  per-project keys if provided at launch (precedence: project keys, then env). The project stores
  only encrypted key material; raw keys are never persisted.
- **Env vars** are managed directly on Amplify apps. For Lambda/SAM projects, edit the SAM template
  and push to redeploy (direct env-var editing is not supported).
- **Delete** tears down the Amplify app or CloudFormation stack per target.
- **Preview deployments, provisioning, and live logs** are Cloudflare-only features; they are
  hidden for AWS projects. AWS deploy/preview tooling is best-effort and driven by the repo's
  GitHub Actions workflow.

## Provisioning from pushed code

Besides adding bindings in the Launchpad UI, developers can provision resources by editing files
and pushing to `main` (no Launchpad access needed):

- **KV / D1 / R2** — add a binding without a resource ID to `wrangler.toml`; Wrangler ≥ 4.45
  creates it automatically on `wrangler deploy` (e.g.
  `[[kv_namespaces]] binding = "CACHE"`).
- **AI Search** — add `[[ai_search]] binding = "SEARCH"` (optionally with `instance_name`); the
  `Provision resources` workflow step creates the instance if it does not exist.
- **Turnstile** — add `CONTACT_SITE_KEY` / `CONTACT_SECRET_KEY` pairs to
  `.launchpad/env-values.enc` (via the Env tab with previews enabled); the step provisions a
  `{project}-CONTACT` widget and injects the keys as secrets.

The `Provision resources` step is included in the Deploy workflow for new Workers projects and can
be toggled per project from the project page ("Provisioning from code"). It requires the repo's
`CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` secrets (set at launch) and, for Turnstile, the
`LP_ENV_MASTER_KEY` secret. Note: the Launchpad Cloudflare token needs `AI Search:Edit` and
`AI Search:Run` permissions to create AI Search instances.

## Templates

Templates live in `templates/<id>/` with a `template.json` manifest. Built-in templates are
under `templates/`, and C3-based templates scaffold live from `create-cloudflare` at launch time.
Manifests carry a `provider` field — `"cloudflare"` (Workers/Pages) or `"aws"` (Lambda/Amplify).
`scripts/embed-templates.mjs` regenerates `lib/template-assets.gen.ts` after any template changes.
