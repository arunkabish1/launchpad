# Cloudflare Launchpad

Internal launchpad for scaffolding apps and deploying them to Cloudflare (Workers and Pages).
Pick a language and template, configure deployment options, and Launchpad:

1. Scaffolds the project (built-in templates or `create-cloudflare`).
2. Creates a GitHub repo — under your account, or a configured org (`launchpad.json` → `github.org`).
3. Sets deploy secrets (`CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`) on the repo (GitHub-encrypted).
4. Pushes the code; a GitHub Actions workflow deploys it to Cloudflare.

## Getting Started

```bash
cp .env.example .env     # fill in credentials (see below)
npm install
npm run dev
```

Open http://localhost:3000 and sign in with the password from `LAUNCHPAD_ADMIN_PASSWORD`.

## Required credentials

| Variable | Purpose |
| --- | --- |
| `GITHUB_PAT` | Create repos, set repo secrets, read deploy status. Scopes: `repo`, `workflow`. |
| `CLOUDFLARE_API_TOKEN` | Create/delete projects, manage env vars. Edit perms on the account. |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare account the projects are deployed to. |
| `LAUNCHPAD_ADMIN_PASSWORD` | Password for signing in to the Launchpad UI. |
| `LAUNCHPAD_SECRET` | Key used to encrypt per-project GitHub tokens at rest (`data/`). |
| `LAUNCHPAD_SESSION_SECRET` | Optional; defaults to `LAUNCHPAD_SECRET`. Signs login sessions. |

Generate a secret key:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

## Security model

- **Login**: single shared org password, HMAC-signed session cookie (8h TTL, HttpOnly,
  SameSite=Strict). All `/api/*` endpoints require a valid session; mutating endpoints also
  reject cross-origin requests. Failed logins are rate-limited per IP.
- **Credentials at rest**: any GitHub token entered at launch time is encrypted with
  `LAUNCHPAD_SECRET` before being written to `data/projects.json`. If `LAUNCHPAD_SECRET` is not
  set, per-project tokens are not persisted (the server-side `GITHUB_PAT` is used instead).
- **Deploy secrets**: `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` are set as repo secrets on
  each launched repo, which GitHub stores encrypted. They are never returned by Launchpad APIs.
- **Audit log**: sign-ins, sign-outs, launches, re-deploys, deletes, and env-var changes are
  appended to `data/audit.jsonl` (viewable under Settings → Recent activity).
- **Least privilege**: give the GitHub token only `repo` + `workflow` on the org/account it needs,
  and give the Cloudflare token only the Edit permissions needed for Workers and Pages. A token
  with org-wide admin powers grants whoever knows the Launchpad password full access to those
  resources.

## Hosting

This app **cannot** run on Cloudflare Workers/Pages itself — it uses the local filesystem
(`data/`, `templates/`) and spawns `npm create cloudflare` when scaffolding C3 templates. Deploy it
to any Node host: a VPS, Docker, Fly.io, Railway, Render, or similar.

Env vars should be set on the host platform's secret store, not committed anywhere. `data/` and
`.env` are gitignored; keep `.env` permissions at `600`.

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
