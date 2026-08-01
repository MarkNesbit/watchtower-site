# WT-CLOUDFLARE-WORKER-PREVIEW-001 delivery note

## Decision

Watchtower Preview uses the existing Astro 6 Cloudflare **Worker** SSR model,
but uploads versions to a dedicated non-production Worker named
`watchtower-preview`. Each upload uses `wrangler versions upload`, receives an
immutable Workers preview URL, and may assign a stable branch or staging alias.

This is deliberately not a Cloudflare Pages deployment. The prior Pages
investigation found that Pages uploaded the Worker SSR output as static assets
and returned a Cloudflare 404 before Astro executed.

## Why the dedicated Preview Worker is required

Cloudflare Worker versions are safe to upload without receiving production
traffic. However, a version upload to the production-named Worker inherits
existing secret bindings additively; omitted secrets are not deleted by
deployment. That cannot guarantee that production-only secrets are unavailable
to a Preview version.

Using a separately named Worker preserves the supported version-preview
workflow while isolating Preview bindings, secrets, routing and custom-domain
configuration from `watchtower-site`. It is the same Worker architecture, not
a second application platform or a Pages migration.

## Preview upload command

```bash
npm run deploy:preview
```

The command:

1. builds the Astro Cloudflare Worker output;
2. uploads a version with `wrangler versions upload --name watchtower-preview`;
3. attaches branch and commit metadata plus a stable alias;
4. creates a temporary, local-only secrets file for the upload and removes it;
5. prints Wrangler's immutable preview URL;
6. does not run `wrangler deploy` or `wrangler versions deploy`.

The GitHub Actions workflow **Upload Cloudflare Worker preview** provides the
same command on Linux and is manual-only. It refuses `main`, so it cannot be
used as the production deployment path.

`wrangler versions upload` creates a version only. `wrangler versions deploy`
changes deployment traffic and is intentionally absent from the Preview script
and workflow. Production remains deployed only through the existing main-branch
workflow, which uses `wrangler deploy` for `watchtower-site`.

## Preview URL and identity

Cloudflare Worker preview URLs are public `workers.dev` URLs in this form:

```text
<version-prefix>-watchtower-preview.<account-subdomain>.workers.dev
<alias>-watchtower-preview.<account-subdomain>.workers.dev
```

The upload tag/message record the source branch and commit. SSR responses from
the Preview deployment include the non-sensitive
`X-Watchtower-Preview: branch=<alias>; commit=<short-sha>` header. The header
is emitted only when the Preview deployment binding is set; it never appears
in production.

## Preview-only configuration required before upload

Create a GitHub Actions environment named `cloudflare-preview`. Its variables
are supplied only to the manual Preview workflow, then bound to the dedicated
Cloudflare Preview Worker version:

| Type | Name | Required | Purpose |
| --- | --- | --- | --- |
| Variable | `WATCHTOWER_PREVIEW_WORKER_NAME` | Yes | `watchtower-preview`; never `watchtower-site`. |
| Variable | `WATCHTOWER_PREVIEW_ALIAS` | Yes | Stable alias, normally `staging`. |
| Variable | `WATCHTOWER_PREVIEW_ORIGIN` | Yes | Exact alias URL, for example `https://staging-watchtower-preview.<account-subdomain>.workers.dev`. |
| Variable | `WATCHTOWER_PREVIEW_SUPABASE_URL` | Yes | Reinstated staging Supabase project URL. |
| Variable | `WATCHTOWER_PREVIEW_SUPABASE_ANON_KEY` | Yes | Reinstated staging project's publishable/anon key. |
| Secret | `WATCHTOWER_PREVIEW_SUPABASE_SERVICE_ROLE_KEY` | Yes for login, password reset and invitation setup | Staging Supabase service-role key; uploaded only to the Preview Worker version as `SUPABASE_SERVICE_ROLE_KEY`. |
| Secret | `WATCHTOWER_PREVIEW_RESEND_API_KEY` | No | Separate preview/testing Resend credential. Without it, email delivery remains safe record-only. |

Do not reuse production Supabase URL, anonymous key or service-role key as
defaults. The script intentionally requires the Preview Supabase values by
name, so restoring or recreating staging needs configuration only, not a code
change. No Preview command runs database migrations.

The production Worker continues to use its existing values and secrets. The
Preview Worker carries no production custom domain or production database
binding.

## Authentication and callback handling

Browser registration already derives its redirect target from the current
origin. The server-side password-reset and invitation paths now accept either:

- the exact production origin `https://watch-tower.co.uk`; or
- the exact `WATCHTOWER_PREVIEW_ORIGIN` when
  `WATCHTOWER_DEPLOYMENT_KIND=preview`, provided it matches the dedicated
  `watchtower-preview` Workers preview hostname pattern.

Arbitrary hosts, production lookalikes, mismatched configured origins and other
Workers are rejected. Login cookies are host-only, `Secure` under HTTPS, and
`SameSite=Lax`; the Preview hostname therefore keeps a separate browser session
from production.

In the reinstated staging Supabase project's **Authentication → URL
Configuration**, set the Site URL to the stable Preview alias and add redirect
URLs for that exact origin. Add an intentionally scoped wildcard only when
immutable version URLs need callback completion, for example:

```text
https://*-watchtower-preview.<account-subdomain>.workers.dev/**
```

Do not add a broad `workers.dev` wildcard and do not change the production
Supabase project's Site URL or redirect allow-list for this setup.

## Cloudflare dashboard actions

1. Keep `watchtower-site` and its `watch-tower.co.uk` custom domain unchanged.
2. Allow the first Preview upload to create `watchtower-preview`; verify it has
   no custom domain, route or production deployment.
3. Confirm Preview URLs are enabled. `wrangler.toml` now declares
   `preview_urls = true` so future uploads preserve that setting.
4. Optionally protect the public Preview URLs with Cloudflare Access for the
   testing users. Do not attach Access to production as part of this change.
5. Leave the legacy Pages project untouched for historical records, but disable
   branch builds or archive it later to prevent its asset-only URLs being used
   as previews.

## Data, security and cost

The Preview design is ready for a reinstated staging Supabase project. No
staging project was restored and no production data was changed in this slice.
Until staging is configured, do not run authenticated Preview testing against
production data by accident; the required Preview variable names make that
choice explicit rather than implicit.

Preview email uses no provider secret unless a separate Preview Resend secret
is configured. Do not upload the production Resend key. The Preview Worker has
no production domain and receives no production traffic.

Cloudflare Worker version preview URLs use existing Worker version capability
and introduce no additional fixed monthly service. Normal Workers request,
compute and any optional external-provider usage still count against their
respective usage plans. A future staging Supabase project may incur its own
plan cost and should be assessed before external users are added.

## Validation and cleanup

Repository-controlled validation covers alias generation, dedicated Worker
selection, explicit staging bindings, callback-origin restrictions, manual
workflow safeguards and Preview response marking.

The local macOS 12.6 machine cannot run the installed workerd runtime, so the
manual GitHub workflow is the supported build/upload path. Live upload and
authenticated acceptance remain pending the Preview-only GitHub environment
and reinstated staging Supabase values.

After a feature is accepted, leave the immutable version available for audit or
delete the Preview deployment/Worker through the Cloudflare dashboard according
to retention policy. Deleting a Preview Worker must be limited to
`watchtower-preview`; never delete `watchtower-site` or its production
deployment.
