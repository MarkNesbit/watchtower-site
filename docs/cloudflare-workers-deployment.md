# Cloudflare Workers deployment

Watchtower deploys the Astro server output as a Cloudflare Worker with Wrangler. Do not deploy this server-rendered build through the old Cloudflare Pages project.

## Required GitHub secrets

Create these repository secrets in GitHub before enabling the workflow:

- `CLOUDFLARE_API_TOKEN` — a Cloudflare API token that can deploy the Worker.
- `CLOUDFLARE_ACCOUNT_ID` — the Cloudflare account ID for the Worker.

## Required Supabase configuration

The app expects these public Supabase environment values during the Astro build and at Worker runtime:

- `PUBLIC_SUPABASE_URL`
- `PUBLIC_SUPABASE_ANON_KEY`

Set them as GitHub repository variables so the GitHub Actions build can read them. Also configure the same values in the deployed Cloudflare Worker environment variables so server-rendered routes have them at runtime. These are public browser-facing values, but they should still be managed through deployment configuration rather than committed to the repository.

## Manual setup steps

1. In Cloudflare, create or select the `watchtower-site` Worker.
2. In GitHub, add the required Cloudflare secrets:
   - `CLOUDFLARE_API_TOKEN`
   - `CLOUDFLARE_ACCOUNT_ID`
3. In GitHub, add repository variables:
   - `PUBLIC_SUPABASE_URL`
   - `PUBLIC_SUPABASE_ANON_KEY`
4. In Cloudflare Workers settings, add matching environment variables:
   - `PUBLIC_SUPABASE_URL`
   - `PUBLIC_SUPABASE_ANON_KEY`
5. Push to `main`. The GitHub Actions workflow runs:
   - `npm ci`
   - `npm test`
   - `npm run build`
   - `npx wrangler deploy`
6. Validate the Worker URL and custom domain routes, including `/`, `/register`, `/login`, `/forgot-password`, `/reset-password`, and `/app`.

## Existing Cloudflare Pages project

Leave the existing Cloudflare Pages project disconnected from production traffic once the Worker deployment is confirmed. Until the Worker URL and custom domain are validated, leave the Pages project in place but disable automatic production deployments if possible to avoid publishing stale assets-only builds.
