# __PROJECT_NAME__

A static site on Cloudflare Pages, launched with Cloudflare Launchpad.

## Deploy

Pushing to `main` triggers the `Deploy to Cloudflare Pages` GitHub Action, which runs:

```bash
wrangler pages deploy public --project-name=__PROJECT_NAME__
```

Edit the files in `public/` and push to update the live site.
