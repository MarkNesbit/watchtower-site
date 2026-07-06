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

Authenticated project capability routes include the read-first Project Details page at `/app/workspaces/{workspaceSlug}/projects/{projectSlug}/details` and the feature-gated Project Narrative assurance table at `/app/workspaces/{workspaceSlug}/projects/{projectSlug}/narrative`, with manual entry creation for permitted workspace roles and read-only entry detail modals. WT-PROJ-DETAILS-001 makes Project Details the controlled surface for project setup, context, metadata and responsibility assignments; WT-PROJ-DETAILS-002 refines it so permitted edits happen through focused modals and role assignment cards, while WT-PROJ-INFO-001 adds controlled project context, dates and governance fields. The dashboard remains a summary and navigation hub. WT-RISK-NARRATIVE-001 and WT-RISK-LIFECYCLE-001 add deliberately limited Risk-to-Narrative integration: entries are created only when an active risk is raised, a draft risk is opened/published, an active risk is closed, a closed risk is reopened, or an existing active risk changes from non-Red to Red. Risk-generated Narrative entries can open a read-only current Risk detail modal with an explicit Open full risk in new tab action.

Risk Management now has a feature-gated register at `/app/workspaces/{workspaceSlug}/projects/{projectSlug}/risks`, single-risk actionable assurance detail pages at `/app/workspaces/{workspaceSlug}/projects/{projectSlug}/risks/{riskId}`, plus create and edit routes for owner, admin and member roles. WT-RISK-REG-UX-002 moves the register foundation from stacked Active/Draft/Closed sections to a compact all-risk table with separate columns for exposure, action state, lifecycle/status, owner, review due date and updated time; active risks are ordered first, Draft risks next and Closed risks last. Only Active risks drive active assurance and attention; Draft and Closed risks stay visible/auditable but neutral for action state, and reopened risks return to Active handling. WT-RISK-005 and WT-RISK-REG-UX-001 keep lifecycle status, exposure, assurance and action state separate: users edit structured facts, probability and impact derive exposure as Critical/High/Medium/Low, weak governance/control data derives assurance, and active risk reference pills use the derived Red/Amber/Green action state rather than a manually selected RAG. Low exposure uses yellow rather than green in the default MVP UX; Green means no current action due. The stored `rag_status` value remains a legacy/transitional compatibility field until there is a migration strategy. Risk references remain system-generated and read-only; routine risk edits, risk comments, risk delete, replies/threading, attention items, notifications, filters/tabs/sorting controls, summary cards, needs-action panels, exposure charts, configurable Governance Profile / Assessment Profile scoring, AI behaviour and health scoring remain deferred. Risk remains the source of truth; Project Narrative is not a risk audit log.

WT-DASH-RISK-001 added the project dashboard Risk tile assurance signal, and WT-UI-RAG-001 consolidates the visual system around shared RAG pills, subdued RAG cards/panels with left accents, and compact dashboard tile status styling. Project health is not designed or implemented yet and displays as Unknown; RAG is currently used for action-state and assurance signals rather than overall delivery health. The Risk tile reflects the highest current active risk assurance state for the project, excluding Draft and Closed risks, without adding count badges, dots, notifications, attention items or health scoring.

WT-DASH-TILE-SIGNALS-001 makes Project Dashboard capability tiles a shared signal surface. Project Details reflects setup completeness, responsibility assignment and project-date readiness, Project Narrative uses each viewer's read-state to show unseen-entry awareness, and Risks uses attention/assurance triggers rather than raw exposure. A high-exposure Red risk can leave the Risks tile Green when ownership, action responsibility, response plans and review cadence are current. Project Narrative read-state is updated only when the authorised user opens the Narrative page, not when the dashboard renders.

WT-SIGNAL-CONSISTENCY-001 makes parent action states explainable. The Projects page project-reference pill now aggregates non-user-specific Project Details and Risk area signals as project action state, while the Health column remains Unknown until a future health model exists. Project Details tile state and the Project Details action-state panel share the same setup/date/responsibility reasons. Project Narrative read-state remains user-specific and is not included in Projects page aggregation in this slice.

WT-PROJ-DETAILS-SIGNALS-001 makes Project Details section action states explicit without duplicating rationale banners. The Project Details page derives Project Identity, Description, Context, Dates, Governance/Escalation, Roles/Responsibilities and System Metadata states from the shared Project Details signal helper, shows each section state as a compact marker with subtle section accenting, and keeps section-owned Red/Amber explanations in the top Project Details action-state summary. Project Dates aggregates from the visible date cards: Red if any child card is Red, Amber if no child is Red and any child is Amber, Green when all visible cards are Green, and Unknown only when the date state cannot be calculated safely. Project dates remain setup/timeline records, not RAID records.

WT-TEST-001 adds `/app/account` and the restricted `/app/account/test-tools` route for the authorised Mark.Nesbit.Professional internal tester. Test tools can simulate Viewer, Member, Admin and Owner effective permissions in the `mark-nesbit-professional-workspace` workspace only. Simulation state is database-backed, expires after 4 hours, does not change `organisation_members.role`, displays a persistent authenticated-app banner while active, and is not customer-facing permission management, impersonation or a global admin feature.

WT-TEST-002 extends the restricted Test tools area with `/app/account/test-tools/demo-people` for CSV demo people import and persona simulation. Demo people are workspace-scoped test personas with notification routing metadata; they are not Supabase auth users and do not replace real profiles or workspace memberships. Persona simulation uses the selected demo person's effective workspace role for normal RBAC testing and continues to distinguish the real authenticated Mark account from the simulated persona.

Authenticated project pages should follow the reusable layout, action, empty-state and restricted-action guidance in `docs/ui-page-design-standard.md`.

## Development

```bash
npm install
npm run dev
npm run build
```

## Supabase foundation setup

This repository includes a Supabase CLI configuration at `supabase/config.toml`, migrations for the current profile/workspace/project/risk/Project Narrative foundation, public environment-variable documentation and lightweight Supabase client modules. The Project Narrative migrations include structured manual entries, entry links and per-user read-state while preserving Risk, Issue, Dependency, and Assumption records as their own future authoritative modules. The authentication foundation uses Supabase Auth, creates application profile/workspace records through migrations and preserves Row Level Security as the database access boundary.

Stateful product feature flags and account-level preview access are documented in `docs/feature-flags.md`. Preview access is stored on the profile and requires no additional environment variable; it does not replace workspace membership or RBAC. Internal role and persona simulation is documented in `docs/access-foundation.md` and is limited to the authorised Mark.Nesbit.Professional production test workspace/profile.

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
