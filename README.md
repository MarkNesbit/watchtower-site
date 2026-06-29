# WatchTower Site

Public-facing website foundation for WatchTower, an emerging SaaS delivery intelligence platform.

WatchTower is positioned around evidence-based forecasting and a future delivery intelligence suite:

- **WatchTower Forecast** — Monte Carlo forecasting based on delivery-period throughput.
- **WatchTower Narrative** — evidence-based delivery narrative for stakeholder communication.
- **WatchTower Signals** — early-warning indicators for delivery risk and reliability.
- **WatchTower Portfolio** — portfolio-level delivery intelligence for senior leaders.

## Routes

- `/`
- `/about`
- `/products`
- `/products/forecast`
- `/products/narrative`
- `/products/signals`
- `/products/portfolio`
- `/roadmap`

Authenticated project capability routes include the feature-gated Project Narrative assurance table at `/app/workspaces/{workspaceSlug}/projects/{projectSlug}/narrative`, with manual entry creation for permitted workspace roles and read-only entry detail modals.

Risk Management now has a feature-gated register at `/app/workspaces/{workspaceSlug}/projects/{projectSlug}/risks`, single-risk actionable assurance detail pages at `/app/workspaces/{workspaceSlug}/projects/{projectSlug}/risks/{riskId}`, plus create and edit routes for owner, admin and member roles. WT-RISK-004B keeps the register concise, supports a single active-workspace actioner assignment on each risk, derives stricter block-level assurance indicators from record quality, opens focused edit modals from Core Risk Detail cards, and exposes top-level risk notes as Comments inside the main detail content with a polished MVP detail layout. Risk references remain system-generated and read-only; risk delete, replies/threading, Risk-to-Diary integration, attention items, notifications, configurable scoring and health scoring remain deferred.

Authenticated project pages should follow the reusable layout, action, empty-state and restricted-action guidance in `docs/ui-page-design-standard.md`.

## Development

```bash
npm install
npm run dev
npm run build
```

## Supabase foundation setup

This repository includes a Supabase CLI configuration at `supabase/config.toml`, migrations for the current profile/workspace/project/risk/Project Narrative foundation, public environment-variable documentation and lightweight Supabase client modules. The Project Narrative migrations include structured manual entries and entry links while preserving Risk, Issue, Dependency, and Assumption records as their own future authoritative modules. The authentication foundation uses Supabase Auth, creates application profile/workspace records through migrations and preserves Row Level Security as the database access boundary.

Stateful product feature flags and account-level preview access are documented in `docs/feature-flags.md`. Preview access is stored on the profile and requires no additional environment variable; it does not replace workspace membership or RBAC.

### Local environment variables

1. Copy the example file:

   ```bash
   cp .env.example .env.local
   ```

2. Open `.env.local` and fill in the public Supabase values:

   ```bash
   PUBLIC_SUPABASE_URL=
   PUBLIC_SUPABASE_ANON_KEY=
   ```

3. Find these values in the Supabase Dashboard:
   - Project URL: open the project, then go to **Project Settings → API** and copy the project URL.
   - Anon key: open the project, then go to **Project Settings → API** and copy the public anon key.

Only public browser-safe values with the `PUBLIC_` prefix should be used by the Astro frontend. Do not commit real secrets, service role keys, database passwords or personal access tokens.

### Supabase CLI

The Supabase CLI can be run with `npx` or installed using a supported global package manager. Supabase's CLI documentation notes that Node.js 20 or later is required for `npx`/`npm` usage and that `npm install -g supabase` is not supported.

Common setup commands:

```bash
npx supabase --help
npx supabase login
npx supabase link --project-ref <your-project-ref>
```

Use `supabase login` to authenticate the CLI with your Supabase account. Then use `supabase link --project-ref <your-project-ref>` to link this local repository to the hosted Supabase project.

### Database change rule

Database schema changes must be handled through migrations only. Do not make manual production database edits and do not commit secrets. This follows the WatchTower ADRs: Supabase Auth owns authentication, WatchTower manages application-owned profile/workspace concepts later, and schema changes are migration-driven.

## Documentation

Platform and product positioning notes are available in the `docs/` directory. Architecture Decision Records in `docs/architecture/` are the source of truth for implementation decisions.

Before changing project functionality, read `docs/project-model.md` for the product-level project field model, `docs/ui-page-design-standard.md` for authenticated project page layout, `docs/access-foundation.md` for the account/profile/membership/role model, `docs/feature-flags.md` for product availability controls and `AGENTS.md` for Codex/developer working rules.
