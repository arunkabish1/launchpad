# AWS Amplify Next.js

A Next.js app deployed to AWS Amplify (Gen 2) hosting.

## Deploy

Every push to `main` runs a GitHub Action:

```bash
npx -y @aws-amplify/cli init --yes
npx -y @aws-amplify/cli push --yes
```

Amplify provisions the hosting backend from `amplify/backend.ts` and builds the Next.js `app/` via `amplify.yml`.
