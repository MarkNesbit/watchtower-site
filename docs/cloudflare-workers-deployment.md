# Cloudflare Workers deployment

Watchtower is deployed as a Cloudflare Worker using the Astro Cloudflare adapter.

The GitHub Actions workflow runs on pushes to `main` and can also be triggered manually.

## Required GitHub repository secrets

Add these under GitHub repository settings:

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

## Required GitHub repository variables

Add these under GitHub repository settings:

- `PUBLIC_SUPABASE_URL`
- `PUBLIC_SUPABASE_ANON_KEY`

These are needed during the Astro build.

## Required Cloudflare Worker variables

Configure the same Supabase values in the Cloudflare Worker environment:

- `PUBLIC_SUPABASE_URL`
- `PUBLIC_SUPABASE_ANON_KEY`

These are needed at runtime by server-rendered routes.

## Deployment flow

On push to `main`, GitHub Actions runs:

1. `npm ci`
2. `npm test`
3. `npm run build`
4. `npx wrangler deploy`

## Validation routes

After deployment, test:

- `/`
- `/register`
- `/login`
- `/forgot-pa- `/forgot-pa- `/forgot-pa- `/forgot-pa- `/forgot-e Pages

The existing Cloudflare Pages project should be left alone until the Worker deployment is confirmed.

Once the Worker URL and custom domain are validated, disconnect or disable the old Pages deployment to avoid stale asset-only deployments.
