# AWS Lambda (Python)

A minimal Python Lambda deployed via AWS SAM.

## Deploy

Every push to `main` runs a GitHub Action:

```bash
sam build
sam deploy --no-confirm-changeset --no-fail-on-empty-changeset --capabilities CAPABILITY_IAM
```
