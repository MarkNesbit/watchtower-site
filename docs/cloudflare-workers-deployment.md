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

## Invitation email delivery

WT-WORKSPACE-TEAM-008A uses Resend through a direct HTTPS request from the Cloudflare Worker. The production sender is:

- From name: `Watchtower`
- From email: `invitations@watch-tower.co.uk`

The non-secret Worker variables are committed in `wrangler.toml` under `[vars]` so a GitHub/Wrangler deployment preserves them. Do not manage these production plaintext values only through the Cloudflare dashboard; Wrangler deployments replace dashboard-only plaintext variables. `keep_vars` is intentionally not enabled because the production deployment treats explicit Wrangler configuration as the source of truth for plaintext bindings.

Configure this Worker secret before production invitation validation:

- `WATCHTOWER_RESEND_API_KEY` as a Worker secret

The committed non-secret values are:

- `WATCHTOWER_EMAIL_PROVIDER=resend`
- `WATCHTOWER_EMAIL_FROM_NAME=Watchtower`
- `WATCHTOWER_EMAIL_FROM_ADDRESS=invitations@watch-tower.co.uk`
- `WATCHTOWER_INVITATION_REPLY_TO=mark.nesbit.professional@gmail.com`
- `WATCHTOWER_SITE_URL=https://watch-tower.co.uk`

The invitation acceptance URL is generated server-side from `WATCHTOWER_SITE_URL` and is accepted only when it resolves to the production HTTPS origin `https://watch-tower.co.uk`. Browser request origin is not used for production provider email.

Resend must have the sending domain configured and verified before live use. Complete the provider-side DNS records for `watch-tower.co.uk`, including SPF/DKIM alignment and DMARC posture, then send a single staged invitation first. Do not bulk-send the remaining pending invitations until Ruby Atkinson and one second shared-inbox identity have been validated end to end. Provider acceptance records the email as sent and awaiting acceptance; it does not prove mailbox delivery and does not activate workspace access.

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
