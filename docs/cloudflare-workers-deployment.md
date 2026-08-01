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

Configure this Supabase value as a Cloudflare Worker secret:

- `SUPABASE_SERVICE_ROLE_KEY`

This server-only key is required to generate single-use password setup links for pre-created invited accounts. Do not commit it to Wrangler plaintext variables, browser code, or logs.

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

## Non-production Worker previews

Use `npm run deploy:preview` only from a supported Linux environment, or run
the manual **Upload Cloudflare Worker preview** GitHub Actions workflow on the
feature branch. The command builds Astro and runs `wrangler versions upload`;
it does not run `wrangler deploy` or `wrangler versions deploy`, so it cannot
change traffic served by `https://watch-tower.co.uk`.

Preview uploads target the separately named `watchtower-preview` Worker rather
than the production Worker. This keeps Preview-only Supabase bindings and
secrets isolated from the production Worker while retaining the same Astro
Worker SSR architecture. The uploaded version receives an immutable Workers
preview URL and an optional stable alias URL.

Before enabling the workflow, create the GitHub Actions environment
`cloudflare-preview` and configure its Preview-only values:

- variables: `WATCHTOWER_PREVIEW_WORKER_NAME`,
  `WATCHTOWER_PREVIEW_ALIAS`, `WATCHTOWER_PREVIEW_ORIGIN`,
  `WATCHTOWER_PREVIEW_SUPABASE_URL`, and
  `WATCHTOWER_PREVIEW_SUPABASE_ANON_KEY`;
- secret: `WATCHTOWER_PREVIEW_SUPABASE_SERVICE_ROLE_KEY`;
- optional secret: `WATCHTOWER_PREVIEW_RESEND_API_KEY` only when Preview email
  delivery is deliberately enabled.

`WATCHTOWER_PREVIEW_ORIGIN` must be the exact stable alias URL for the
dedicated Worker, in the form
`https://<alias>-watchtower-preview.<account-subdomain>.workers.dev`.
`watchtower-preview` has no production custom domain and must not be attached
to `watch-tower.co.uk`.

The Preview worker defaults email delivery to safe record-only handling when
the optional Preview Resend secret is absent. It must use a separate Supabase
project before Preview use expands beyond controlled testing. See
`docs/delivery/WT-CLOUDFLARE-WORKER-PREVIEW-001-delivery-note.md` for the full
operational and security requirements.

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
