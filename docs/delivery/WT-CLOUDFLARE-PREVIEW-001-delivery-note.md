# WT-CLOUDFLARE-PREVIEW-001 delivery note

## Outcome

Cloudflare Pages Preview deployments return a Cloudflare HTTP 404 before the
Watchtower application executes. This is not an Astro route, middleware,
authentication or hostname rejection.

The requested Pages repair was not applied because the repository and the
deployed project use incompatible deployment models:

- the checked-in Astro 6 Cloudflare adapter configuration emits a Cloudflare
  **Worker** application;
- the `watchtower-site` Cloudflare Pages project uploads `dist` as static
  assets and has no compatible Pages Function for server-rendered routes;
- the Pages project is therefore unable to serve `/`, which is rendered on
  demand and has no static `dist/index.html` fallback.

The Cloudflare Pages production and Preview deployment URLs both returned the
same plain Cloudflare 404 during this investigation. `https://watch-tower.co.uk/`
returned HTTP 200, and the Cloudflare account has active Wrangler Worker
deployments. The live custom domain is consequently served by the Worker, not
by the Pages project.

## Root cause

`wrangler.toml` is a Worker configuration:

- `main = "@astrojs/cloudflare/entrypoints/server"`
- `[assets] directory = "./dist"`

It intentionally has no `pages_build_output_dir`. Cloudflare Pages therefore
reports that it is not a Pages configuration and ignores it for the Git-based
Pages deployment.

Adding `pages_build_output_dir = "./dist"` is not a safe repair. Cloudflare
Pages would then treat the file as its source of truth, but Worker-only fields
such as `main` and `[assets]` do not configure a Pages Function. More
importantly, the current dependency set is Astro 6.4.4 with
`@astrojs/cloudflare` 13.7.0. Astro documents that this adapter no longer
supports Cloudflare Pages in Astro 6, and its build output is designed for
Wrangler Worker deployment rather than a Pages Function.

The repository history confirms this: a Pages configuration containing
`pages_build_output_dir = "dist"` existed before the Worker migration, while
the Pages 404 behaviour has persisted. Reintroducing that setting would repeat
the unsupported asset-only deployment and risks turning the working Worker
configuration into an invalid mixed configuration.

References:

- [Astro Cloudflare adapter: Pages support removed](https://docs.astro.build/en/guides/integrations-guide/cloudflare/#removed-cloudflare-pages-support)
- [Cloudflare Pages Wrangler configuration](https://developers.cloudflare.com/pages/functions/wrangler-configuration/)
- [Cloudflare migration guidance: Pages to Workers](https://developers.cloudflare.com/workers/static-assets/migration-guides/migrate-from-pages/)

## Effective deployment configuration

| Surface | Effective model | Status |
| --- | --- | --- |
| `wrangler.toml` and GitHub workflow | Worker SSR with assets | Supported and serving production |
| Astro configuration | `output: 'server'` with the Cloudflare adapter | Worker SSR output |
| `watchtower-site` Pages project | Static Pages output directory `dist` | No compatible SSR function; `/` returns Cloudflare 404 |

The generated Astro server Wrangler configuration belongs to the Worker build
and must not be copied into a Pages configuration. It preserves the generated
server entry point for `wrangler deploy`; it is not a Pages Function entry
point.

## Routing and hostname review

No application hostname allow-list, redirect rule, `_redirects`, `_headers` or
middleware rule causes the observed 404. The response is generated before
Astro runs.

The registration flow already uses `window.location.origin` for its Supabase
email confirmation return URL, so a functioning preview hostname is preserved
without accepting arbitrary server-side origins. Relative in-app redirects are
same-origin only.

Invitation and password-reset provider emails deliberately remain bounded to
`https://watch-tower.co.uk`. That production-only policy should not be loosened
for Pages previews: it protects trusted provider-generated links and is not
related to the Cloudflare 404.

## Environment findings

The current Pages dashboard configuration contains the public Supabase URL and
public anonymous key for both Preview and Production. Its downloaded Pages
configuration does not include the Worker-specific email variables or secrets.

For a future **Worker preview** strategy, configure Preview with:

- `PUBLIC_SUPABASE_URL` and `PUBLIC_SUPABASE_ANON_KEY` at build and runtime;
- an explicit canonical preview origin only if a server-generated callback
  needs one;
- any required non-secret delivery-mode flags, without copying production email
  secrets merely to make preview work.

If users are expected to complete sign-up or other Supabase browser redirects
on preview, add only the expected Pages preview host patterns to Supabase Auth
Redirect URLs (for example `https://*.watchtower-site.pages.dev/**`, subject to
the selected preview design). Keep `https://watch-tower.co.uk` as the Supabase
Site URL and keep its exact production redirect URLs. Supabase documents its
redirect URL wildcard semantics at
[Redirect URLs](https://supabase.com/docs/guides/auth/redirect-urls).

## Validation results

- Confirmed that unique Pages Preview URLs and the Pages production URL return
  plain Cloudflare HTTP 404 at `/`.
- Confirmed that `https://watch-tower.co.uk/` returns HTTP 200.
- Confirmed active Wrangler Worker deployments in the Cloudflare account.
- Confirmed that the Pages branch deployment is created successfully, so
  branch-alias provisioning is not the failing layer.
- Confirmed that the root Wrangler file is a Worker configuration and that the
  Pages dashboard reports `pages_build_output_dir = "dist"` only in its
  dashboard-derived configuration.
- Reviewed middleware, redirects, hostname/origin checks and authentication
  callbacks. None can run for this Cloudflare-generated 404.
- `npm run build` cannot complete on the current macOS 12.6 host because the
  Astro 6 Cloudflare runtime requires macOS 13.5 or later. This is a local
  validation limitation, not the hosted failure cause.

## Required dashboard and delivery action

Do not add `pages_build_output_dir` to the checked-in Worker `wrangler.toml`.
Do not attempt to repair the Pages project by combining Pages and Worker
configuration fields.

To obtain hosted previews, choose and implement one supported deployment path
in a separate change:

1. use Cloudflare Workers preview/version URLs or a dedicated preview Worker
   with the existing Astro 6 Worker configuration; or
2. deliberately downgrade/migrate the application to a Pages-compatible Astro
   generation and build a Pages Function. This is a platform/dependency
   migration, not a safe configuration-only change.

After selecting the Worker preview path, disable or clearly label the legacy
Pages project so it is not treated as a working preview environment. Configure
the selected preview host in Supabase Auth only when authentication flows need
to complete there.

## Production impact

No production configuration, authentication rule, data or Action functionality
was changed. The working Worker configuration is intentionally left unchanged.
