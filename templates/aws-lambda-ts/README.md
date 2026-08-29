# AWS Lambda (TypeScript)

A minimal TypeScript Lambda deployed via AWS SAM.

## Develop

```bash
npm install
npm run dev
```

## Deploy

Every push to `main` runs a GitHub Action:

```bash
npm run build
sam build
sam deploy --no-confirm-changeset --no-fail-on-empty-changeset --capabilities CAPABILITY_IAM
```
