# WT-ACTION-SPIKE-001 - Actions feasibility assessment

Date: 2026-07-12

Scope: technical discovery for WT-EPIC-024, based on the current `watchtower-site` codebase. No Actions feature code or migration is introduced by this assessment.

## A. Executive Assessment

Overall feasibility: feasible, but the full MVP is larger than the current 10-15 day expectation if it includes hard server-side workflow enforcement, audited takeover, risk contextual integration, dashboard signals, personal queues, and hardening.

Overall complexity: High.

Recommended delivery approach: build a narrow authoritative Action foundation first, then integrate one end-to-end source journey from Risk detail before expanding to dashboard and cross-project personal queues. Use one source-of-truth `project_actions` table and one immutable `project_action_history` table. Reuse the Project Narrative counter pattern for references and the Risk register UI patterns for the project Actions register.

MVP suitability: the epic remains suitable for MVP if Project Details and Narrative source entry points stay deferred until the Risk Action journey is proven. WT-ACTION-006 should be treated as a foundation slice, not a small dashboard add-on, because a genuine personal dashboard does not currently exist.

Revised duration estimate:

- Core project Actions workflow plus Risk integration: 14-20 concentrated delivery days.
- Full recommended MVP cut including user dashboard queues, signals, hardening, and documentation: 22-30 concentrated delivery days.
- Project Details and Narrative contextual entry points: defer until after the first release boundary unless product explicitly accepts a broader MVP.

## B. Current-Code Findings

### Database and Migration Patterns

Files inspected:

- `supabase/migrations/20260614000200_create_foundation_tables.sql`
- `supabase/migrations/20260614000300_enable_rls_and_baseline_policies.sql`
- `supabase/migrations/20260617000100_create_projects.sql`
- `supabase/migrations/20260620000100_create_project_risks.sql`
- `supabase/migrations/20260624000100_project_reference_code_foundation.sql`
- `supabase/migrations/20260624000400_project_narrative_schema_foundation.sql`
- `supabase/migrations/20260625000100_project_narrative_entry_links.sql`
- `supabase/migrations/20260629000100_project_risk_actioner_assignment.sql`
- `supabase/migrations/20260629000200_project_risk_derived_concern_model.sql`
- `supabase/migrations/20260630000200_project_people_assignments.sql`
- `supabase/migrations/20260701000100_project_dates_timeline_readiness.sql`
- `supabase/migrations/20260702000100_project_narrative_read_states.sql`
- `supabase/migrations/20260710000100_project_risk_insert_updated_by.sql`
- `supabase/migrations/20260712000100_project_risk_assessment_completion.sql`

Confirmed patterns:

- Project-scoped tables carry `organisation_id`, `project_id`, audit fields, composite project/workspace foreign keys, RLS, and explicit column grants.
- Project reference codes are 3-4 uppercase characters and immutable after project creation.
- Risk reference generation is currently application-side with `MAX_RISK_REF_INSERT_ATTEMPTS = 3`, based on querying the highest sequence and retrying on unique constraint failures.
- Project Narrative uses a stronger `project_narrative_counters` table with an upsert that increments under row lock. This avoids reference reuse and is the best pattern for Actions.
- Narrative already uses `source_type`, `source_record_id`, and `source_ref`; it explicitly says the source module remains authoritative.
- Narrative links validate HTTP/HTTPS at both TypeScript and SQL levels.
- An `audit_log` table exists but is not the primary immutable history pattern for Risk lifecycle changes; Risk lifecycle currently creates comments and Narrative entries, not a full transition ledger.

Reuse opportunities:

- Reuse the Narrative counter design for `Action-{PROJECT_REF}-{NNN}`.
- Reuse composite scope constraints from Risk, Narrative, Project Dates, and Project People.
- Reuse safe URL validation from Project Narrative links for the evidence URL.

Constraints and concerns:

- Risk reference generation should not be copied for Actions because an Action register is more workflow-heavy and likely to receive concurrent creation from multiple entry points.
- Existing broad update grants and RLS patterns are not enough for a strict workflow where only the actioner can submit/return/reject and only the raiser or acceptance owner can complete.
- Existing `audit_log` is not sufficient for user-visible immutable Action history.

### Permissions and RLS

Files inspected:

- `src/lib/permissions.ts`
- `src/lib/projects.ts`
- `src/lib/internalTesting.ts`
- `supabase/migrations/20260614000300_enable_rls_and_baseline_policies.sql`
- `supabase/migrations/20260629000300_internal_role_simulation.sql`
- `supabase/migrations/20260629000400_workspace_demo_people.sql`
- `supabase/migrations/20260630000100_fix_internal_test_workspace_scope.sql`
- `tests/feature-flags.test.mjs`
- `tests/internal-role-simulation.test.mjs`

Confirmed patterns:

- Workspace roles are `owner`, `admin`, `member`, and `viewer`.
- Viewers have read-only project/risk/narrative permissions.
- Owners, admins, and members can currently mutate project details, risks, narrative entries, project dates, and project people.
- Internal role simulation changes the effective workspace role in helper queries and tests.
- Project People assignments are accountability/context only and explicitly do not grant workspace permissions.

Reuse opportunities:

- Add `ACTION_PERMISSIONS` to `permissions.ts` following Risk and Narrative.
- Use existing workspace role checks for baseline view/create rights.
- Use active workspace membership validation before assigning a real actioner.

Constraints and concerns:

- Raiser-only completion cannot safely rely on hidden buttons. It needs server-side enforcement.
- RLS policies cannot express a full transition matrix cleanly by themselves, especially old-status to new-status transitions. Use database triggers or dedicated transition functions.
- Project Manager and Project Owner can be identified through `project_people`, but those assignments do not grant permission. Product must decide whether project roles should allow acceptance-owner takeover or only workspace Owner/Admin.
- If the raiser leaves the workspace, current active membership helpers would block normal closure by that user. The model needs an audited acceptance-owner takeover path.
- Assigning an action to a user who later loses access should be allowed historically, but the user should not be able to respond unless they are still an active workspace member.

### Risk Integration

Files inspected:

- `src/lib/projectRisks.ts`
- `src/lib/riskReferencePills.ts`
- `src/pages/app/workspaces/[workspaceSlug]/projects/[projectId]/risks.astro`
- `src/pages/app/workspaces/[workspaceSlug]/projects/[projectId]/risks/[riskId].astro`
- `src/pages/app/workspaces/[workspaceSlug]/projects/[projectId]/risks/[riskId]/edit.astro`
- `src/components/app/RiskForm.astro`
- `supabase/migrations/20260629000100_project_risk_actioner_assignment.sql`
- `supabase/migrations/20260629000200_project_risk_derived_concern_model.sql`
- `tests/risks.test.mjs`

Confirmed patterns:

- Risk has `actioner_id` directly on `project_risks`.
- Risk action state is derived from owner, actioner, review date, due date, mitigation, contingency, exposure, lifecycle status, and update staleness.
- Risk detail uses in-page dialogs for editing individual assurance blocks.
- Risk lifecycle is managed through `transitionProjectRiskLifecycle`, with Narrative entry side effects.
- Risk detail already has a dense assurance layout and a comments section.

Reuse opportunities:

- Add a linked Actions section to Risk detail using a query filtered by `source_type = 'risk'` and `source_record_id = risk_id`.
- Reuse Risk register tab/filter/table patterns for the Actions register.
- Reuse `RagReferencePill` and derived tone helpers for Action status and timing presentation.

Constraints and concerns:

- The word "actioner" already means a risk-level person responsible for risk follow-up. The new Action actioner must be clearly modelled separately to avoid changing Risk assurance meaning.
- Risk assurance calculations should not change in the spike or early Risk integration slice.
- Action creation from Risk must not be treated as successful mitigation. Linked Action state may later become an assurance signal, but only in WT-ACTION-009 after the base workflow is stable.

### Project Dashboard and Project Actions Route

Files inspected:

- `src/pages/app/workspaces/[workspaceSlug]/projects/[projectId].astro`
- `src/lib/dashboardTileSignals.ts`
- `src/lib/projectAttention.ts`
- `src/lib/projectRoutes.ts`
- `tests/projects.test.mjs`
- `tests/feature-flags.test.mjs`

Confirmed patterns:

- `ProjectAreaKey` already includes `actions`.
- The project dashboard already has an Actions tile, but it is an unavailable `#actions` placeholder with unknown state.
- Project action state currently aggregates Project Details and Risk state through `deriveProjectActionState`; it does not include authoritative Actions.
- `projectRoutes.ts` has builders for project, details, narrative, and risks, but no Actions route builder.
- Feature flags include `attentionItems`, but no `projectActions` feature key.

Reuse opportunities:

- Add `buildProjectActionsPath` beside the existing route builders.
- Add a `deriveProjectActionsAreaSignal` helper in `dashboardTileSignals.ts` and aggregate it in `projectAttention.ts`.
- Replace the dashboard placeholder with the Actions route once WT-ACTION-002 is available.

Constraints and concerns:

- If Actions signals are wired directly inside the dashboard page, logic will be duplicated. Signal calculation should live in a library helper and be consumed by the dashboard and project list.
- Project list currently loads risks, dates, and people for all projects in the current workspace. Adding Actions will add another batch query and should be indexed for `(organisation_id, project_id, status, due_date)`.

### Personal Dashboard Feasibility

Files inspected:

- `src/pages/app/index.astro`
- `src/components/app/AppLanding.astro`
- `src/pages/app/projects/index.astro`
- `src/lib/projects.ts`

Confirmed patterns:

- `/app` is not a genuine personal dashboard. It renders a welcome card and client-side signed-in message.
- `/app/projects` is the nearest operational landing page. It is workspace-scoped through `getCurrentWorkspace`.
- Existing cross-project aggregation is limited to the current workspace's project list action state.

Reuse opportunities:

- Use the Projects page query style as a precedent for workspace-scoped summary queues.
- Use `getCurrentWorkspace` for the first version if product accepts queues limited to the selected/current workspace.

Constraints and concerns:

- WT-ACTION-006 is underestimated if it means "my Actions across all workspaces/projects".
- A cross-project full Action management page would conflict with the stated exclusion of a general cross-project Actions register. A personal dashboard should be a queue summary with direct project/action links, not a full management surface.
- Workspace switching/current workspace assumptions need product confirmation.

### Narrative Integration

Files inspected:

- `src/lib/projectNarrative.ts`
- `src/pages/app/workspaces/[workspaceSlug]/projects/[projectId]/narrative.astro`
- `supabase/migrations/20260624000400_project_narrative_schema_foundation.sql`
- `supabase/migrations/20260625000100_project_narrative_entry_links.sql`
- `tests/project-narrative.test.mjs`

Confirmed patterns:

- Narrative supports `manual`, `risk`, `issue`, `dependency`, `assumption`, and `system` source types.
- Risk-generated Narrative entries preserve `source_type = 'risk'`, `source_record_id`, and `source_ref`.
- Manual Narrative entries have source metadata optional.
- Narrative already renders richer Risk previews when an entry links to a Risk.

Reuse opportunities:

- For a manual Narrative entry, Action source can be `source_type = 'narrative'` with `source_record_id = narrative_entry.id`.
- For generated Risk Narrative entries, Action source should normally be the underlying Risk.
- Optional `originating_narrative_entry_id` or `source_context` can preserve where the user clicked without making Narrative authoritative.

Constraints and concerns:

- Narrative integration should stay later. It is easy to create ambiguous source semantics if generated Narrative entries become primary sources.
- The current source type constraint does not include `action` or `narrative`; Action schema can use its own source type list without altering Narrative immediately.

### Project Details Integration

Files inspected:

- `src/pages/app/workspaces/[workspaceSlug]/projects/[projectId]/details.astro`
- `src/lib/projectDates.ts`
- `src/lib/projectPeople.ts`
- `src/lib/dashboardTileSignals.ts`
- `supabase/migrations/20260630000200_project_people_assignments.sql`
- `supabase/migrations/20260701000100_project_dates_timeline_readiness.sql`
- `tests/project-details.test.mjs`

Confirmed patterns:

- Project Details sections are represented by stable TypeScript keys in `ProjectDetailsSectionKey`.
- Some underlying details have stable records, such as `project_dates` and `project_people`.
- Many core sections are fields on `projects`, not separate records.
- The Details page is already dense with modals and section-level action-state panels.

Reuse opportunities:

- For early Project Details integration, use `source_type = 'project_details'` plus a section key/context label.
- For date-specific Actions, optionally use `source_record_id = project_dates.id` and `source_context = { section: 'project_dates' }`.

Constraints and concerns:

- Adding action buttons to every Details section could clutter the page. Defer or start with the sections that already produce red/amber reasons.
- Fine-grained source linkage across every project field is not worth doing in the first MVP.

### Workflow and State Machine

Confirmed assessment:

- The proposed stored statuses are appropriate for MVP because queues, RLS, sorting, and audit display all need a stable current state.
- Some display labels should still be derived:
  - `submitted` displays as "Awaiting raiser review" and is Amber.
  - `complete` is the only Green state.
  - `cancelled` is neutral grey.
  - Open/returned work should derive urgency from due date.
  - `rejected_by_actioner` is Red.

Recommended transition model:

| From | Actor | To | Required fields |
| --- | --- | --- | --- |
| none | permitted creator | open | brief, due date |
| open | actioner | submitted | response brief, optional evidence URL |
| open | actioner | returned_to_raiser | reason |
| open | actioner | rejected_by_actioner | reason |
| returned_to_actioner | actioner | submitted | response brief, optional evidence URL |
| returned_to_actioner | actioner | returned_to_raiser | reason |
| returned_to_actioner | actioner | rejected_by_actioner | reason |
| submitted | acceptance owner | complete | optional closure note |
| submitted | acceptance owner | returned_to_actioner | reason |
| returned_to_raiser | acceptance owner | open or returned_to_actioner | amended/reissued fields and reason |
| rejected_by_actioner | acceptance owner | open or returned_to_actioner | amended/reissued fields and reason |
| any non-terminal | raiser or acceptance owner with permission | cancelled | reason |
| any non-terminal | authorised replacement | same status with new acceptance owner | takeover reason |

Concurrency recommendation:

- Perform transitions through dedicated server actions that call central helpers or database RPCs.
- Lock or condition updates on current `status`, `updated_at`, and actor identity to avoid double-submit or complete-after-return races.
- Append history in the same transaction as the status update.

### Evidence-Link Security

Confirmed patterns:

- `normaliseProjectNarrativeLinkUrl` uses the `URL` parser and allows only `http:` and `https:`.
- Narrative link SQL also checks `url ~* '^https?://'`.
- Risk prompt confirmation links use `target = '_blank'` and `rel = 'noopener noreferrer'`.

Recommendation:

- Evidence should be one optional URL only for MVP.
- Reuse the Narrative URL normalisation pattern.
- Store `evidence_url` on the history submission event and optionally denormalise the latest evidence URL on `project_actions` only if the UI needs fast display.

### Audit and History

Confirmed patterns:

- There is a foundation `audit_log` table.
- Risk notes and Narrative entries provide contextual history, but there is no immutable workflow event table equivalent to the proposed Actions history.
- Several migrations use triggers to prevent identity/scope changes.

Recommendation:

- Create `project_action_history` as first-class immutable Action history.
- Do not use editable comments as workflow history.
- No authenticated update/delete grants on history.
- Add a trigger that raises on update/delete unless `service_role` is performing controlled maintenance, or simply avoid grants and keep trigger protection for defense in depth.

History event types should include:

- `created`
- `assigned`
- `unassigned`
- `reassigned`
- `brief_amended`
- `due_date_changed`
- `submitted`
- `returned_to_raiser`
- `rejected_by_actioner`
- `returned_to_actioner`
- `reissued`
- `acceptance_owner_taken_over`
- `completed`
- `cancelled`

Use explicit typed columns for common workflow facts (`from_status`, `to_status`, `actor_user_id`, `reason`, `response`, `evidence_url`) plus `old_values` and `new_values` JSONB for field-level before/after details.

### Testing Architecture

Files inspected:

- `package.json`
- `tests/risks.test.mjs`
- `tests/project-narrative.test.mjs`
- `tests/project-details.test.mjs`
- `tests/projects.test.mjs`
- `tests/feature-flags.test.mjs`
- `tests/internal-role-simulation.test.mjs`
- `tests/access-foundation.test.mjs`

Confirmed patterns:

- Test suite uses `node --experimental-strip-types --test tests/*.test.mjs`.
- Tests combine pure helper unit tests, mocked Supabase clients, page source assertions, and migration SQL assertions.
- No visible browser/E2E suite exists in the repository.
- Existing RLS tests are mostly static assertions against migration SQL rather than live database policy execution.

Reuse opportunities:

- Add `tests/project-actions.test.mjs` for helper/state-machine/query tests.
- Add migration SQL assertions for tables, constraints, RLS, grants, and history immutability.
- Add mocked client tests for create, transition, assignment validation, and permission failures.
- Extend existing `projects.test.mjs`, `risks.test.mjs`, and `project-narrative.test.mjs` for route/source integrations.

Constraints and concerns:

- Raiser-only completion and actioner-only response rights need stronger coverage than existing text assertions. Consider live Supabase/RLS tests before merge if the local/CI environment supports them.
- Full workflow should get at least one manual browser validation script or checklist until a browser E2E layer exists.

### UI and Component Reuse

Confirmed reusable components and patterns:

- Status pills: `RagReferencePill.astro`, `riskReferencePills.ts`, `rag.css`
- Responsive panels: `ProjectContentPanel.astro`, `ProjectControlPanel.astro`
- Empty states: `EmptyState.astro`
- Disabled permission messaging: `DisabledActionHint.astro`
- Risk register tabs, filters, tables, pagination, side panels: Risk register route
- Dialog style and long-text handling: Risk detail route
- User selectors: Risk owner/actioner selection and Project People person options
- Date inputs: Risk form and Project Dates forms
- Safe external links: Narrative links and Risk prompt confirmation

Where reuse may mislead:

- Risk action state is assurance logic, not Action workflow status.
- Risk `actioner_id` is not the same entity as an Action actioner.
- Narrative entries are contextual timeline records, not workflow history.
- Project Details section signals are assurance prompts, not source records.

## C. Proposed Architecture

### Tables

`project_action_counters`

- `project_id uuid primary key`
- `organisation_id uuid not null`
- `last_action_number integer not null default 0`
- Composite FK to `projects(id, organisation_id)`
- No authenticated grants

`project_actions`

- `id uuid primary key default gen_random_uuid()`
- `organisation_id uuid not null`
- `project_id uuid not null`
- `action_number integer not null`
- `action_ref text not null`
- `brief text not null`
- `status text not null default 'open'`
- `due_date date not null`
- `raiser_id uuid not null references public.profiles(id)`
- `actioner_id uuid references public.profiles(id)`
- `acceptance_owner_id uuid not null references public.profiles(id)`
- `source_type text not null default 'project'`
- `source_record_id uuid`
- `source_ref text`
- `source_label text`
- `source_context jsonb not null default '{}'::jsonb`
- `latest_response text`
- `latest_evidence_url text`
- `submitted_at timestamptz`
- `completed_at timestamptz`
- `cancelled_at timestamptz`
- `created_by uuid not null references public.profiles(id)`
- `updated_by uuid references public.profiles(id)`
- `created_at timestamptz not null default now()`
- `updated_at timestamptz not null default now()`
- `archived_at timestamptz`
- `deleted_at timestamptz`

`project_action_history`

- `id uuid primary key default gen_random_uuid()`
- `organisation_id uuid not null`
- `project_id uuid not null`
- `action_id uuid not null`
- `event_type text not null`
- `actor_user_id uuid references public.profiles(id) on delete set null`
- `from_status text`
- `to_status text`
- `reason text`
- `response text`
- `evidence_url text`
- `old_values jsonb`
- `new_values jsonb`
- `created_at timestamptz not null default now()`

### Constraints

- `action_ref` format: `^Action-[A-Z][A-Z0-9]{2,3}-[0-9]{3,}$`
- `status` check: `open`, `submitted`, `returned_to_raiser`, `rejected_by_actioner`, `returned_to_actioner`, `complete`, `cancelled`
- `source_type` check: `project`, `risk`, `project_details`, `narrative`
- `brief` not empty
- `due_date` not null
- `reason` required in history events that return, reject, cancel, reissue after rejection/return, or takeover
- `response` required for `submitted` events
- `evidence_url` null or HTTP/HTTPS
- Unique `(project_id, action_number)`, `(project_id, action_ref)`, `(organisation_id, action_ref)`
- Composite scope FKs to project and action

### Indexes

- `project_actions_organisation_id_idx`
- `project_actions_project_status_due_idx` on `(organisation_id, project_id, status, due_date)`
- `project_actions_actioner_status_due_idx` on `(organisation_id, actioner_id, status, due_date)` where `actioner_id is not null`
- `project_actions_acceptance_owner_status_idx` on `(organisation_id, acceptance_owner_id, status, updated_at desc)`
- `project_actions_raiser_status_idx` on `(organisation_id, raiser_id, status, updated_at desc)`
- `project_actions_source_idx` on `(organisation_id, project_id, source_type, source_record_id)` where `source_record_id is not null`
- `project_action_history_action_created_idx` on `(action_id, created_at desc)`
- `project_action_history_actor_created_idx` on `(organisation_id, actor_user_id, created_at desc)`

### RLS Approach

- Select Actions/history: active workspace members can read project-scoped records.
- Create Actions: owner/admin/member.
- Create history: only through trusted transition path.
- Viewer: read-only.
- Actioner transitions: authenticated active member whose `auth.uid()` equals `actioner_id`, only from allowed non-terminal states.
- Raiser/acceptance owner transitions: `auth.uid()` equals `acceptance_owner_id` for complete, return to actioner, reissue, cancel.
- Takeover: initially owner/admin only, or product-approved project roles plus owner/admin.
- Direct broad updates should not be granted for status fields. Use column grants narrowly or RPC/server-only functions.

### Reference Generation

Use the Project Narrative counter pattern:

1. Trigger looks up project `organisation_id` and `project_ref`.
2. Upsert into `project_action_counters`.
3. Increment `last_action_number`.
4. Build `Action-{PROJECT_REF}-{NNN}`.
5. Set `organisation_id`, `action_number`, `action_ref`, `created_by`, `updated_by`, and default `acceptance_owner_id = raiser_id`.

This is safer than the Risk retry loop under concurrent creation.

### Source-Link Model

Recommended MVP: single optional source on `project_actions`.

- General project Action: `source_type = 'project'`, no `source_record_id`.
- Risk Action: `source_type = 'risk'`, `source_record_id = project_risks.risk_id`, `source_ref = risk_ref`.
- Project Details Action: `source_type = 'project_details'`, no ID for section-level sources, `source_label` section label, `source_context.section` section key.
- Narrative Action: manual entries use `source_type = 'narrative'`; generated risk entries should normally resolve to the Risk and may store originating narrative ID in `source_context`.

Avoid a general many-to-many source relationship table for MVP. It adds flexibility before the product has proven it needs it.

### State-Transition Enforcement

Recommended: central TypeScript service helpers plus database guardrails.

- `src/lib/projectActions.ts` owns validation, status derivation, and query helpers.
- Transition helpers condition updates by `id`, `organisation_id`, `project_id`, current `status`, and actor.
- History insertion happens in the same operation. If Supabase client operations cannot guarantee atomicity, use SQL RPC functions for the transition operations.
- A database trigger rejects invalid direct status changes and protects immutable identity fields.

### UI Routes and Components

Add:

- `/app/workspaces/[workspaceSlug]/projects/[projectId]/actions`
- `/app/workspaces/[workspaceSlug]/projects/[projectId]/actions/new`
- `/app/workspaces/[workspaceSlug]/projects/[projectId]/actions/[actionId]`

Reuse:

- Risk register tab/filter/pagination layout
- Risk detail dialog pattern for compact transitions
- Project page hero/content/control panels
- `RagReferencePill`
- `DisabledActionHint`
- `EmptyState`

## D. Feasibility by Slice

### WT-ACTION-001 - Action model, lifecycle, history and permissions

Feasibility: High.

Complexity: High.

Dependencies: product decisions on takeover authority, source types, and whether transition enforcement must be database RPC based.

Likely files affected:

- `supabase/migrations/*project_actions*.sql`
- `src/lib/permissions.ts`
- `src/lib/projectActions.ts`
- `tests/project-actions.test.mjs`

Migration impact: high. Creates core tables, counter table, triggers, RLS, grants, and constraints.

Permission impact: high. Adds action-specific permissions and actor-specific rules.

Test impact: high. Needs migration, helper, mocked client, and transition matrix coverage.

Revised effort estimate: 5-7 days.

Scope/sequence recommendation: split into WT-ACTION-001A schema/reference/RLS and WT-ACTION-001B transition helpers/history if delivery risk needs reducing.

### WT-ACTION-002 - Project Actions register and Action detail

Feasibility: High.

Complexity: Medium-High.

Dependencies: WT-ACTION-001.

Likely files affected:

- `src/lib/projectActions.ts`
- `src/lib/projectRoutes.ts`
- `src/pages/app/workspaces/[workspaceSlug]/projects/[projectId]/actions.astro`
- `src/pages/app/workspaces/[workspaceSlug]/projects/[projectId]/actions/new.astro`
- `src/pages/app/workspaces/[workspaceSlug]/projects/[projectId]/actions/[actionId].astro`
- `tests/project-actions.test.mjs`

Migration impact: none beyond WT-ACTION-001 unless fields are missed.

Permission impact: medium. Viewer read-only, create gated.

Test impact: medium-high. Route source assertions, filter/sort helper tests, permission-disabled checks.

Revised effort estimate: 4-6 days.

Scope/sequence recommendation: include new general Action flow and detail/history display, but keep contextual source entry points to later slices.

### WT-ACTION-003 - Actioner Submit, Return and Reject workflow

Feasibility: High.

Complexity: Medium-High.

Dependencies: WT-ACTION-001 and Action detail route from WT-ACTION-002.

Likely files affected:

- `src/lib/projectActions.ts`
- Action detail route/component
- `tests/project-actions.test.mjs`

Migration impact: none if history fields are already present.

Permission impact: high. Must enforce actioner-only transitions.

Test impact: high. Status matrix, mandatory reason, mandatory response, evidence URL validation, non-actioner denial.

Revised effort estimate: 3-4 days.

Scope/sequence recommendation: build before broad dashboard integration so the central workflow model is exercised.

### WT-ACTION-004 - Raiser review, reissue, completion and cancellation

Feasibility: High.

Complexity: High.

Dependencies: WT-ACTION-001, WT-ACTION-003, takeover decision.

Likely files affected:

- `src/lib/projectActions.ts`
- Action detail route/component
- `tests/project-actions.test.mjs`

Migration impact: possibly small if takeover table/fields are not already included.

Permission impact: very high. This is where raiser-only completion must be guaranteed.

Test impact: very high. Raiser vs actioner vs viewer vs admin/owner takeover cases.

Revised effort estimate: 4-6 days.

Scope/sequence recommendation: split audited takeover into a small sub-slice if product rules are not settled before build.

### WT-ACTION-005 - Risk contextual integration

Feasibility: High.

Complexity: Medium.

Dependencies: WT-ACTION-001 through WT-ACTION-004, route builders.

Likely files affected:

- `src/pages/app/workspaces/[workspaceSlug]/projects/[projectId]/risks/[riskId].astro`
- `src/lib/projectActions.ts`
- `src/lib/projectRoutes.ts`
- `tests/risks.test.mjs`
- `tests/project-actions.test.mjs`

Migration impact: none if source fields exist.

Permission impact: medium. Create button gated by Action create permission.

Test impact: medium. Linked query, source prepopulation, navigation, no Risk assurance changes.

Revised effort estimate: 2-3 days.

Scope/sequence recommendation: keep explicitly separate from Risk assurance changes.

### WT-ACTION-006 - User dashboard Action queues

Feasibility: Medium.

Complexity: High.

Dependencies: WT-ACTION-001 through WT-ACTION-004, product decision on workspace scope.

Likely files affected:

- `src/pages/app/index.astro`
- `src/components/app/AppLanding.astro` or replacement dashboard component
- `src/lib/projectActions.ts`
- `src/lib/projects.ts`
- `tests/project-actions.test.mjs`
- `tests/projects.test.mjs`

Migration impact: none if indexes are adequate.

Permission impact: medium-high. User-relative queries must not expose projects outside active memberships.

Test impact: high. Assigned actions, awaiting review, raised returned/rejected, reassignment visibility.

Revised effort estimate: 4-6 days.

Scope/sequence recommendation: reclassify as foundational dashboard work. Build current-workspace queues first unless product confirms all-workspace behavior.

### WT-ACTION-007 - Project Details contextual integration

Feasibility: Medium-High.

Complexity: Medium.

Dependencies: WT-ACTION-002 and source-link decisions.

Likely files affected:

- `src/pages/app/workspaces/[workspaceSlug]/projects/[projectId]/details.astro`
- `src/lib/projectActions.ts`
- `tests/project-details.test.mjs`

Migration impact: none if `source_context` exists.

Permission impact: low-medium.

Test impact: medium.

Revised effort estimate: 2-4 days.

Scope/sequence recommendation: defer after MVP Risk journey. Start only with sections that already produce red/amber action-state reasons.

### WT-ACTION-008 - Narrative contextual integration

Feasibility: Medium.

Complexity: Medium-High.

Dependencies: WT-ACTION-002, source resolution decision for generated entries.

Likely files affected:

- `src/pages/app/workspaces/[workspaceSlug]/projects/[projectId]/narrative.astro`
- `src/lib/projectNarrative.ts`
- `src/lib/projectActions.ts`
- `tests/project-narrative.test.mjs`

Migration impact: none if source fields can represent originating Narrative context.

Permission impact: medium.

Test impact: medium-high. Must cover generated Risk entry resolution.

Revised effort estimate: 3-4 days.

Scope/sequence recommendation: defer. Do not block Risk Action MVP on Narrative entry-point nuance.

### WT-ACTION-009 - Action assurance and signal integration

Feasibility: High.

Complexity: Medium-High.

Dependencies: working Actions data model and dashboard signal helper.

Likely files affected:

- `src/lib/dashboardTileSignals.ts`
- `src/lib/projectAttention.ts`
- `src/pages/app/workspaces/[workspaceSlug]/projects/[projectId].astro`
- `src/pages/app/projects/index.astro`
- `src/lib/projectActions.ts`
- `tests/projects.test.mjs`
- `tests/project-actions.test.mjs`

Migration impact: none if indexes exist.

Permission impact: low-medium. Read signals follow read access.

Test impact: high. Signal precedence, overdue/due-today/due-soon, unassigned, awaiting review, returned/rejected.

Revised effort estimate: 3-5 days.

Scope/sequence recommendation: place after Risk integration and before hardening. Do not change Risk assurance semantics in the same slice.

### WT-ACTION-010 - End-to-end hardening, audit and documentation

Feasibility: High.

Complexity: High.

Dependencies: all previous MVP slices.

Likely files affected:

- `tests/project-actions.test.mjs`
- `tests/projects.test.mjs`
- `tests/risks.test.mjs`
- `docs/*`
- product backlog/traceability artifacts if kept in source-controlled docs

Migration impact: possible corrective migration if hardening finds gaps.

Permission impact: high. Final RLS and takeover validation.

Test impact: very high. Workflow, RLS, dashboard, source integration, accessibility, responsive/manual validation.

Revised effort estimate: 4-6 days.

Scope/sequence recommendation: keep as a real hardening slice. Do not compress it into implementation slices.

## E. Hidden Complexity and Risks

Unknown dependencies:

- Whether Actions should be feature flagged.
- Whether personal queues are current-workspace or all-workspace.
- Whether Project Manager/Product Owner project roles can participate in takeover authority.
- Whether live database/RLS tests are available in CI.

Existing technical debt:

- `/app` is a placeholder, not a dashboard.
- Risk reference generation is app-side retry based; Actions should not copy it.
- Project action state naming already overlaps with the proposed Actions capability.
- Existing RLS tests are mostly static SQL assertions.

RLS risks:

- Direct updates can bypass workflow intent if status columns are broadly grantable.
- Raiser-only completion is not expressible safely through UI gating.
- Acceptance-owner takeover can become a privilege escalation if project roles are treated like permissions without an explicit rule.

State consistency risks:

- Concurrent submit/return/complete operations.
- Reassignment while actioner is submitting.
- Due-date changes during review.
- History append succeeding/failing separately from Action update if not transactional.

Dashboard-foundation gaps:

- No personal dashboard exists.
- Project dashboard Actions tile is a placeholder.
- Current project action state excludes Actions.

Performance concerns:

- Project list will need one additional batch query for Actions.
- Personal queues need indexes on actioner, raiser, acceptance owner, status, and due date.
- History should not be joined wholesale into registers.

Data migration concerns:

- No existing Actions data to migrate.
- Existing Risk `actioner_id` must not be migrated into Actions automatically.
- Existing early projects without valid `project_ref` would not be able to create Actions unless the same project reference requirement applies and is met.

Risk lifecycle regression risks:

- Risk actioner terminology could be accidentally overwritten.
- Risk assurance could be accidentally changed by treating linked Actions as mitigation too early.
- Risk Narrative side effects should not be refactored during Action implementation.

UX ambiguity:

- "Return to raiser" versus "return to actioner" needs careful copy.
- Actioner rejection versus raiser cancellation must be distinct.
- Returned/rejected Actions need clear raiser next steps.
- Unassigned Actions need a home in the register and dashboard without pretending there is an actioner queue.

Underestimated areas:

- WT-ACTION-006 personal dashboard.
- Audited acceptance-owner takeover.
- Server-side state transition enforcement.
- End-to-end permission validation.

## F. Recommended Revised Slice Plan

1. WT-ACTION-000A: Product/technical decisions before build.
2. WT-ACTION-001A: Schema, counters, RLS baseline, immutable history shell.
3. WT-ACTION-001B: Transition helpers/RPCs, status matrix, permissions.
4. WT-ACTION-002: Project Actions register, new general Action, Action detail/history.
5. WT-ACTION-003: Actioner submit/return/reject.
6. WT-ACTION-004A: Raiser review, complete, return, cancel, reassign/reissue.
7. WT-ACTION-004B: Acceptance-owner takeover if not fully decided before 004A.
8. WT-ACTION-005: Risk contextual integration.
9. WT-ACTION-009: Project dashboard/tile/action signal integration.
10. WT-ACTION-006A: Current-workspace personal Action queues.
11. WT-ACTION-010: Hardening, audit, docs, traceability.
12. WT-ACTION-007: Project Details contextual integration, deferred.
13. WT-ACTION-008: Narrative contextual integration, deferred.

Recommended changes:

- Split WT-ACTION-001.
- Split WT-ACTION-004 if takeover authority is not settled.
- Reorder WT-ACTION-009 before WT-ACTION-006 so the project-scoped signal model is stable first.
- Reclassify WT-ACTION-006 as foundational dashboard work.
- Defer WT-ACTION-007 and WT-ACTION-008 from the first MVP release unless product expands the scope.

## G. Decision Points

### 1. Who can create Actions?

Options:

- Owner/Admin/Member only.
- Any active member including Viewer.

Technical consequences:

- Including Viewer would break the current read-only viewer permission model.

Recommendation: Owner/Admin/Member only.

Blocks implementation: yes.

### 2. Must an actioner be an active workspace member at assignment time?

Options:

- Require active workspace member.
- Allow any profile ID.
- Allow external/non-user text assignees.

Technical consequences:

- Active member is easiest to enforce and matches Risk owner/actioner options.
- External text assignees would expand scope beyond current auth model.

Recommendation: require active workspace member for user assignment, but allow `actioner_id` null.

Blocks implementation: yes.

### 3. What happens when an actioner loses workspace access?

Options:

- Keep assignment but block response.
- Auto-unassign.
- Allow response based on historical assignment.

Technical consequences:

- Auto-unassign damages audit context.
- Historical response would bypass active membership access rules.

Recommendation: keep assignment, block response, surface as reassignment concern.

Blocks implementation: yes.

### 4. Who can take over acceptance ownership?

Options:

- Workspace Owner/Admin only.
- Workspace Owner/Admin plus active project manager.
- Any member with project edit rights.

Technical consequences:

- Project People roles are not permissions today.
- Adding project-role authority requires additional helper logic and tests.

Recommendation: initial MVP Owner/Admin only, with history reason required. Add project-role takeover later if needed.

Blocks implementation: yes.

### 5. Should transitions be database RPCs or TypeScript helpers with guarded updates?

Options:

- SQL RPC functions for each transition.
- TypeScript helpers using Supabase updates and history inserts.
- Hybrid: TypeScript helpers plus database trigger validation.

Technical consequences:

- RPCs give best transaction guarantees.
- TypeScript helpers match current code but are harder to make atomic.
- Hybrid is pragmatic if triggers reject invalid direct changes.

Recommendation: hybrid for MVP, but use RPC for transitions if atomic history/update cannot be guaranteed cleanly.

Blocks implementation: yes.

### 6. Should Action history store before/after JSON?

Options:

- Typed fields only.
- JSON only.
- Typed fields plus JSON.

Technical consequences:

- Typed fields are easy to query/display.
- JSON supports amendment/reassignment/due-date diffs without many nullable columns.

Recommendation: typed common workflow fields plus JSON before/after.

Blocks implementation: no, but decide before migration.

### 7. What is the first personal dashboard scope?

Options:

- Current workspace only.
- All active workspaces.
- Current project only.

Technical consequences:

- Current workspace aligns with existing `getCurrentWorkspace`.
- All workspaces needs broader navigation and workspace labels.
- Current project is not a personal dashboard.

Recommendation: current workspace only for MVP unless product explicitly requires all workspaces.

Blocks implementation: yes for WT-ACTION-006.

### 8. Does Actions need a feature flag?

Options:

- Add `projectActions` feature key.
- Ship route behind role/RLS only.

Technical consequences:

- Feature flag matches Risk/Narrative rollout patterns but adds seed/config work.
- No flag is simpler but less controllable.

Recommendation: add `projectActions` feature key if the capability will be previewed before general availability.

Blocks implementation: no, but decide before route work.

### 9. What exact source type list should be stored?

Options:

- `project`, `risk`, `project_details`, `narrative`.
- Include future RAID types now.
- Use free text.

Technical consequences:

- Narrow list prevents accidental generic task platform expansion.
- Future RAID types can be added by migration when authoritative tables exist.

Recommendation: narrow MVP list.

Blocks implementation: yes for migration.

### 10. Is `returned_to_raiser` a terminal or active review state?

Options:

- Raiser must reissue/cancel.
- Actioner can edit after returning.

Technical consequences:

- Raiser-owned reissue is consistent with "returned to raiser".
- Allowing actioner edits after return blurs ownership.

Recommendation: raiser must reissue, reassign, cancel, or amend.

Blocks implementation: yes.

## H. Validation

Commands run:

- `npm test`

Results:

- Pass. The suite reported 233 tests passing, 0 failing, 0 skipped.

Existing failures:

- None observed.

Relationship to proposed work:

- No failures appear related to the proposed Actions work. The suite confirms the current Risk, Project Details, Project Narrative, project routing, permissions, feature flag, role simulation, and dashboard signal baselines are stable before Actions implementation begins.
