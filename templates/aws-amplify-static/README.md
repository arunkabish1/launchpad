# AWS Amplify (Static)

A static site hosted on AWS Amplify (S3 + CloudFront). Drop files into `public/` and push to main.

## Deploy

Every push to `main` runs a GitHub Action:

```bash
npx -y @aws-amplify/cli push --yes
```

The published `WebsiteURL` (CloudFront domain) is shown on the project's live URL.
