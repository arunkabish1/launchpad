# __PROJECT_NAME__

An Express (Node.js) app running on Cloudflare Workers, launched with Cloudflare Launchpad.

It uses the `nodejs_compat` compatibility flag so standard Express middleware, routes, and `express.json()` work out of the box.

## Local development

```bash
npm ci
npm run dev
```

## Endpoints

- `GET /` – JSON greeting
- `GET /health` – health check
- `GET /echo` – echoes query params

## Deploy

Pushing to `main` triggers the `Deploy to Cloudflare Workers` GitHub Action, which runs `wrangler deploy`.

Manual re-deploy is available via the Actions tab (`workflow_dispatch`).
