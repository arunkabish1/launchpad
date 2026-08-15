# __PROJECT_NAME__

A Cloudflare Worker (TypeScript) launched with Cloudflare Launchpad.

## Local development

```bash
npm ci
npm run dev
```

## Deploy

Pushing to `main` triggers the `Deploy to Cloudflare Workers` GitHub Action, which runs `wrangler deploy`.

Manual re-deploy is available via the Actions tab (`workflow_dispatch`).
