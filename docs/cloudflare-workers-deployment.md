# Cloudflare Workers deployment

Watchtower is deployed as a Cloudflare Worker using the Astro Cloudflare adapter.

The production site is served from the Cloudflare Worker deployment at `https://watch-tower.co.uk`.

## Production custom domain rule

The production custom domain `https://watch-tower.co.uk` must be attached to the Cloudflare Worker domain/routing configuration.

Do not attach the production custom domain to the old Cloudflare Pages project unless the deployment strategy is intentionally changed. The old Pages project can otherwise serve stale asset-only deployments and should not be treated as the production target.

## Required GitHub repository secrets

Add these under GitHub repository settings:

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

## Required GitHub repository variables

Add these under GitHub repository settings:

- `PUBLIC_SUPABASE_URL`
- `PUBLIC_SUPABASE_ANON_KEY`

These public Supabase variables are provided at build time through GitHub repository variables and are needed during the Astro build.

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
- `/forgot-password`
- `/app`
- `/app/projects`
- `/app/projects/new`
- `/app/workspaces/{workspaceSlug}/projects/{projectSlug}` for an accessible project
- `/app/workspaces/{workspaceSlug}/projects/{projectSlug}/narrative` when Project Narrative is enabled or available in preview

Also confirm that `https://watch-tower.co.uk` resolves to the Worker deployment, not the old Cloudflare Pages deployment.
