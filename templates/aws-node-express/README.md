# AWS Node.js Express

An Express app running on AWS Lambda behind an HTTP API via AWS SAM.

## Develop

```bash
npm install
npm run dev
```

## Deploy

Every push to `main` triggers a GitHub Action that builds and deploys with SAM:

```bash
npm run build
sam build
sam deploy --no-confirm-changeset --no-fail-on-empty-changeset --capabilities CAPABILITY_IAM
```

The endpoint URL is exported from the stack as `ApiUrl`.
