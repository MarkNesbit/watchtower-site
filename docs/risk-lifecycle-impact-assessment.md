# WT-RISK-LIFECYCLE-001A - Current-State Risk Lifecycle and Change-Impact Assessment

**Parent Epic:** WT-RISK-LIFECYCLE-EPIC-001 - Unified Risk Capture, Assurance and Lifecycle Management
**Assessment slice:** WT-RISK-LIFECYCLE-001A - Current-State Risk Lifecycle and Change-Impact Assessment
**Status:** Assessment complete; no lifecycle behaviour changed
**Implementation follow-up:** WT-RISK-LIFECYCLE-001B completed as the first dependency-led implementation slice, hardening the existing shared lifecycle/action-state contract without changing product behaviour
**Defect follow-up:** WT-RISK-LIFECYCLE-001B-FIX-001 corrected active-risk review-date due-soon Amber handling in the shared contract; no migration required
**Implementation follow-up:** WT-RISK-LIFECYCLE-002 completed manual and prompt Draft capture alignment; no migration required
**Repository assessed:** `watchtower-site`

## Executive summary

Watchtower already has a recognisable Risk Management lifecycle foundation. `project_risks` is the single source-of-truth table for manual and prompt-created risks, Draft records are real persisted records with generated references and audit metadata, and most current surfaces consume shared helpers in `src/lib/projectRisks.ts`. The current lifecycle grouping is Draft, Active and Closed, with active statuses `open`, `monitoring`, `mitigating`, `escalated` and `materialised`.

The largest conflict with the Epic direction is activation readiness. Prompt-created risks are lightweight Drafts, but the manual create form still defaults to `open` and requires probability and impact. Drafts can be opened through a lifecycle action with no minimum activation gate, and they can also be changed to any valid status through the general edit path. That means activation is not consistently protected server-side.

The current action-state roll-up already matches the MVP "forgiving Amber" rule: any Red produces Red, one or more Ambers with no Red produces Amber, and multiple Ambers do not escalate to Red. The main issue is not the roll-up rule itself; it is that lifecycle, exposure, assurance and action-state concepts are tightly coupled in the same helper and some UI-local presentation helpers duplicate date/review behaviour.

Narrative is partly aligned with the future target. Narrative entries preserve historical text and source metadata, and the Narrative page fetches the current linked risk for its detail modal. However, the table reference pill still uses stored `project_narrative_entries.attention_level`, so the visible row pill can remain frozen even while the risk preview modal shows current state.

Recommended delivery approach: start with a small shared lifecycle/action-state contract hardening slice, then align manual and prompt Draft capture, then introduce a server-side activation gate, then update Narrative pills and any consumer-specific presentation. No database migration is required for the assessment. Implementation slices may need migrations only if future product decisions require new activation fields, closure metadata, or stored state history.

## Current-state architecture map

### Database and schema

- `supabase/migrations/20260620000100_create_project_risks.sql`
  - Creates `projects.project_ref`, `project_risks`, `project_risk_notes`, audit triggers, scope-protection triggers, RLS, grants and indexes.
  - Original `project_risks.status` default is `open`.
  - Stored `rag_status` is required and defaults to `blue`.
  - `project_risk_notes` supports top-level comments and future threaded replies.
- `supabase/migrations/20260629000100_project_risk_actioner_assignment.sql`
  - Adds nullable `project_risks.actioner_id`.
- `supabase/migrations/20260629000200_project_risk_derived_concern_model.sql`
  - Replaces accepted with closed.
  - Adds allowed statuses `draft`, `open`, `monitoring`, `mitigating`, `escalated`, `materialised`, `closed`.
  - Documents `rag_status` as legacy/transitional.
- `supabase/migrations/20260709000100_project_risk_prompt_source.sql`
  - Adds nullable `source_risk_prompt_id`.
  - Adds partial uniqueness for non-deleted risks by `(project_id, source_risk_prompt_id)`.
- `supabase/migrations/20260710000100_project_risk_insert_updated_by.sql`
  - Sets both `created_by` and `updated_by` on insert.
- `supabase/migrations/20260624000400_project_narrative_schema_foundation.sql`
  - Creates `project_narrative_entries` with `source_type`, `source_record_id`, `source_ref` and `attention_level`.
- `supabase/migrations/20260625000100_project_narrative_entry_links.sql`
  - Adds structured links for Narrative entries.
- `supabase/migrations/20260702000100_project_narrative_read_states.sql`
  - Adds per-user Narrative read-state.

### Risk creation routes

- Manual create route: `src/pages/app/workspaces/[workspaceSlug]/projects/[projectId]/risks/new.astro`
  - Renders `RiskForm`.
  - Defaults `status` to `open`, `probability` to `medium`, and `impact` to `medium`.
  - Validates with `validateRiskFormInput`.
  - Calls `createProjectRisk`.
  - Redirects to risk detail after creation.
- Prompt-created Draft route: `src/pages/app/workspaces/[workspaceSlug]/projects/[projectId]/risks/prompt-drafts.ts`
  - Accepts selected stable prompt IDs.
  - Supports `preflight` and `create` modes.
  - Calls `preflightDraftProjectRisksFromPrompts` or `createDraftProjectRisksFromPrompts`.
  - Returns JSON and duplicate/existing-risk metadata.
- Risk prompt modal: `src/pages/app/workspaces/[workspaceSlug]/projects/[projectId]/risks.astro`
  - Loads active default prompt library.
  - Presents risk-area tabs, selected-only review and preflight/confirmation UX.
  - Redirects/refreshes to Draft tab after successful create.

### Risk update routes

- Full edit route: `src/pages/app/workspaces/[workspaceSlug]/projects/[projectId]/risks/[riskId]/edit.astro`
  - Renders `RiskForm` in edit mode.
  - Can submit any value in `RISK_STATUSES`.
  - Calls `updateProjectRisk`.
- Detail route focused modals: `src/pages/app/workspaces/[workspaceSlug]/projects/[projectId]/risks/[riskId].astro`
  - Displays assurance cards from `getRiskAssuranceBlocks`.
  - Focused modal forms post to the edit route through `updateProjectRisk`.
  - Lifecycle buttons call `transitionProjectRiskLifecycle`.
  - Comment form calls `createProjectRiskComment`.
- Lifecycle helper: `transitionProjectRiskLifecycle`
  - Allows only Draft -> Open, Active -> Closed and Closed -> Open through the lifecycle action path.
  - No activation-readiness validation beyond current lifecycle category.

### Shared helpers

- `src/lib/projectRisks.ts`
  - Authoritative current helper for statuses, lifecycle categories, exposure, register filtering/sorting, action-state derivation, Needs Action items, data access, creation, update, comments, lifecycle transitions and risk-generated Narrative entries.
- `src/lib/dashboardTileSignals.ts`
  - Consumes `deriveRiskAssuranceTone` and `isDashboardActiveRiskStatus` for dashboard/project-area risk signals.
- `src/lib/projectAttention.ts`
  - Aggregates project area signals, including risk area signals.
- `src/lib/projectNarrative.ts`
  - Source-of-truth Narrative data access. Does not currently join current risk state.
- `src/components/app/RiskForm.astro`
  - Shared create/edit form for manual risk flows.
- `src/components/app/RagReferencePill.astro`
  - Shared visual pill for lifecycle, action state, exposure and Narrative references.

### Risk Register consumers

- `src/pages/app/workspaces/[workspaceSlug]/projects/[projectId]/risks.astro`
  - Uses helpers for tabs, filters, search, sorting, pagination, summary cards, Needs Action panel and exposure distribution.
  - Has local `reviewDueState` and `actionStateFor` presentation helpers.

### Dashboard consumers

- Project dashboard route `src/pages/app/workspaces/[workspaceSlug]/projects/[projectId].astro`
  - Loads project risks via `listProjectRisks`.
  - Uses `deriveRiskTileAttentionSignal`.
- Project list and project action-state consumers use `projectAttention` / `dashboardTileSignals`.
  - Project Health remains separate and Unknown.

### Narrative consumers

- `src/lib/projectRisks.ts`
  - Creates source-linked Narrative entries for raised/opened/closed/reopened/became-Red events.
- `src/lib/projectNarrative.ts`
  - Lists Narrative entries with stored source metadata and links.
- `src/pages/app/workspaces/[workspaceSlug]/projects/[projectId]/narrative.astro`
  - Fetches linked current risks by `source_record_id`.
  - Table pill still uses stored entry attention.
  - Detail modal uses current linked risk state when the risk can be loaded.

### Permission boundaries

- `src/lib/permissions.ts`
  - `owner`, `admin`, `member`: `risk.view`, `risk.create`, `risk.edit`, Narrative create/edit/delete.
  - `viewer`: read-only for project, risk and Narrative.
- App helpers use `assertCan` before risk create/edit and Narrative create.
- RLS reinforces read/write by active organisation role.
- Activation currently has no separate permission; it is covered by `risk.edit`.

## Field inventory

| Field/concept | Current storage | Current UI | Required at creation | Current validation | Proposed classification | Gap |
| --- | --- | --- | --- | --- | --- | --- |
| Internal risk ID | `project_risks.risk_id` UUID default | Detail URL/reference relationship | Automatic | DB primary key | Audit only | None |
| Human risk reference | `risk_ref`, `risk_sequence` | Register/detail/Narrative source ref | Automatic | DB format and unique constraints, helper generation | Initial capture | None |
| Workspace/project scope | `organisation_id`, `project_id` | Route-scoped | Automatic | Helper route resolution, FK, RLS | Audit only | None |
| Title | `title` not null | Manual form, edit, detail | Yes manual and prompt | Non-empty app and DB | Initial capture | None |
| Description | `description` nullable | Manual form, edit, detail, prompt guidance | No | Trimmed nullable | Draft optional or activation required - decision required | Need activation decision |
| Status/lifecycle | `status` text | Manual form, edit, lifecycle buttons, register | Yes in manual form; set to Draft in prompt route | DB status check, app enum | Lifecycle | Gate missing |
| Probability | `probability` text not null default medium | Manual form/edit, exposure | Yes manual; prompt default | DB check and app enum | Draft optional / activation required - decision required | Storage cannot represent null/unassessed |
| Impact | `impact` text not null default medium | Manual form/edit, exposure | Yes manual; prompt default | DB check and app enum | Draft optional / activation required - decision required | Storage cannot represent null/unassessed |
| Exposure | Derived from probability/impact | Register/detail/Narrative preview | No separate field | Helper derived | Exposure | No stored estimated exposure field |
| Draft unassessed | Inferred from Draft + medium/medium | Register Draft exposure | Prompt-created and manual Draft medium/medium | `isDraftRiskExposureUnassessed` | Estimated exposure | Placeholder inference may be fragile |
| Legacy RAG/action storage | `rag_status` not null | Not user-editable | Automatic | DB check, helper writes | Legacy / audit compatibility | Stale risk if consumers read directly |
| Owner | `owner_id` nullable | Form, detail, register, Narrative preview | No | Active member check if set | Likely activation required - decision required | Missing active owner is Red today |
| Actioner | `actioner_id` nullable | Form, detail, Narrative preview | No | Active member check if set | Active assurance Red | May not block activation unless decided |
| Review date | `review_date` nullable | Form/detail/register | No | Date format | Activation required or Amber assurance - decision required | Missing is Amber today |
| Due date | `due_date` nullable | Form/detail | No | Date format | Active assurance Amber/Red | Naming/purpose needs decision |
| Mitigation plan | `mitigation_plan` nullable | Form/detail/Narrative preview | No | Trimmed nullable | Active assurance Amber/Red | Critical missing is Red, High/Medium missing Amber |
| Contingency plan | `contingency_plan` nullable | Form/detail/Narrative preview | No | Trimmed nullable | Active assurance Red | Missing is Red today |
| Comments | `project_risk_notes.note` | Detail comments | No | Non-empty for comment create | Draft optional / audit | Comments do not affect action state |
| Source prompt | `source_risk_prompt_id` nullable | Duplicate/preflight logic, not main UI field | Prompt-created only | FK and partial unique index | Audit/traceability | None |
| Created audit | `created_by`, `created_at` | Detail strip | Automatic | Trigger | Audit only | None |
| Updated audit | `updated_by`, `updated_at` | Detail/register | Automatic | Trigger | Audit only | None |
| Archive/delete | `archived_at`, `deleted_at` | Not exposed | No | Query filters | Post-MVP | No UI lifecycle decision |
| Closure reason | Risk note with prefix | Lifecycle close form | Optional | Non-empty only if note supplied | Closure required - decision required | No dedicated closure metadata |
| Lifecycle history | Narrative entries and optional notes | Narrative/detail comments | Partial | App side effects | Audit | No full state-change history table |

## Lifecycle transition map

| Status | Current category | Appears in Register | Action state evaluated | Exposure displayed | Needs Action | Dashboard signal | Narrative generation | Current transitions |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `draft` | Draft | Draft tab | No, neutral | Yes, provisional/Unassessed | No | No | No on creation; Activate/Open creates entry | Lifecycle action: activate to open only after gate passes; edit path keeps Draft unless activating to Open |
| `open` | Active | Active tab | Yes | Yes | Red/Amber only | Yes | Manual create creates raised entry; Draft -> Open creates opened entry | Lifecycle action: close; edit path: any valid status |
| `monitoring` | Active | Active tab | Yes | Yes | Red/Amber only | Yes | Edit may create became-Red entry | Lifecycle action: close; edit path: any valid status |
| `mitigating` | Active | Active tab | Yes | Yes | Red/Amber only | Yes | Edit may create became-Red entry | Lifecycle action: close; edit path: any valid status |
| `escalated` | Active | Active tab | Yes | Yes | Red if owner/actioner/review not current | Yes | Edit may create became-Red entry | Lifecycle action: close; edit path: any valid status |
| `materialised` | Active | Active tab | Yes | Yes | Red | Yes | Edit may create became-Red entry | Lifecycle action: close; edit path: any valid status |
| `closed` | Closed | Closed tab | No, neutral | Register shows none; detail can still show stored exposure | No | No | Close creates neutral entry; reopen creates entry | Lifecycle action: reopen; edit path: any valid status |
| compatibility closed values | Closed helper only | Treated closed if returned | No | Register closed handling | No | No | None expected | Not DB-allowed after current migration |

Current restrictions:

- UI lifecycle buttons enforce Draft -> Open, Active -> Closed and Closed -> Open.
- Server helper `transitionProjectRiskLifecycle` enforces those three action boundaries and applies Draft activation readiness before opening.
- General update helper `updateProjectRisk` applies the same Draft activation readiness and rejects crafted Draft -> non-Open active or Draft -> Closed updates before mutation.
- Database enforces only the allowed status list, not transition rules or activation readiness.
- Active is not stored. It is a grouping produced by `riskLifecycleCategory` and `isActiveRiskStatus`.

Implemented activation boundary:

- Keep `draft` as the only pre-active lifecycle state for MVP.
- Server-side activation validation lives in `src/lib/projectRisks.ts` and is reused by `updateProjectRisk` and `transitionProjectRiskLifecycle`.
- UI controls reflect the same helper result; they are not the only protection.
- Database enforcement should be considered only after product decisions settle, because cross-field gate rules may be easier to maintain in application code initially.

## Assurance/action-state rule map

| Assurance area | Green | Amber | Red | Applies to | Blocks activation? | Implementation location |
| --- | --- | --- | --- | --- | --- | --- |
| Description/summary | Description length at least 30 | Description present but short | Missing | Detail cards only for active risks | Yes, minimum 30 characters | `getRiskAssuranceBlocks`, `getRiskActivationReadiness` |
| Lifecycle status | Active normal statuses | None currently | `materialised`; escalated without owner/actioner/current review in action state | Active risks | No current gate | `lifecycleStatusTone`, `deriveRiskAssuranceTone`, `getRiskActionStateDrivers` |
| Exposure | Valid probability/impact derives Low/Medium/High/Critical | Not an action-state colour | Invalid/missing maps to Critical exposure | All display; active in action items | Decision required | `deriveWatchtowerDefaultRiskExposure` |
| Owner | Owner assigned | None | Missing owner | Active risks | Yes, active workspace member required | `deriveRiskAssuranceTone`, `getRiskActionItems`, `getRiskActionStateDrivers`, `getRiskActivationReadiness` |
| Actioner | Actioner assigned | None | Missing actioner on active risk | Active risks | No, post-activation assurance gap | `actionerTone`, `deriveRiskAssuranceTone`, `getRiskActionItems` |
| Review date | Present and not overdue | Missing | Overdue | Active risks | Yes, date must exist and not be overdue | `dateTone`, `deriveRiskAssuranceTone`, `getRiskActionItems`, `getRiskActivationReadiness` |
| Due date | Present and not overdue | Missing | Overdue | Active risks | No, post-activation assurance gap | `dateTone`, `deriveRiskAssuranceTone`, `getRiskActionItems` |
| Mitigation | Present, or Low exposure missing | Missing for Medium/High exposure | Missing for Critical exposure | Active risks | No, post-activation assurance gap | `deriveRiskAssuranceTone`, `getRiskActionItems`, `getRiskActionStateDrivers` |
| Contingency | Present | None | Missing | Active risks | No, post-activation assurance gap | `deriveRiskAssuranceTone`, `getRiskActionItems`, `getRiskActionStateDrivers` |
| Assessment completeness | Valid probability and impact with `assessment_completed_at` marker | None | Missing/invalid creates `assess-exposure` action item | Active risks | Yes | `hasAssessedRiskExposure`, `getRiskActionItems`, `getRiskActivationReadiness` |
| Update freshness | Updated <= 30 days | Updated > 30 days | Updated > 60 days | Active risks | No current gate | `staleUpdateTone` |
| Draft/Closed lifecycle | Neutral | Neutral | Neutral | Draft and Closed | N/A | `deriveRiskReferenceTone`, `getRiskAssuranceBlocks` |

Cumulative Amber logic:

- No current risk-level cumulative-Amber-to-Red rule was found.
- `worstTone` in `src/lib/projectRisks.ts` returns Red if any Red exists, Amber if any Amber exists, Green if any Green exists and no higher tone exists, otherwise Neutral.
- Dashboard/project-area signal aggregation follows the same Red > Amber > Unknown > Green/Neutral pattern and does not count Ambers into Red.
- Draft tab count uses a separate UX treatment: one to five Drafts = Amber count, more than five Drafts = Red count. This is not risk action-state logic and should not be reused as action-state policy.

## Shared helper and duplicated logic findings

Authoritative helper candidates:

- Lifecycle grouping: `RISK_STATUSES`, `DRAFT_RISK_STATUSES`, `ACTIVE_RISK_STATUSES`, `CLOSED_RISK_STATUSES`, `riskLifecycleCategory`, `isActiveRiskStatus`, `isDraftRiskStatus`, `isClosedRiskStatus`.
- Exposure: `deriveWatchtowerDefaultRiskExposure`, `getRiskRegisterExposureDisplay`.
- Action state: `deriveRiskAssuranceTone`, `deriveRiskActionStateTone`, `deriveRiskReferenceTone`, `riskReferenceStatusLabel`, `getRiskActionStateDrivers`.
- Needs Action: `getRiskActionItems`, `getProjectRiskActionItems`, `countRisksNeedingAction`.
- Register: `riskMatchesRegisterView`, `riskMatchesRegisterFilters`, `filterAndSortRisksForRegister`, `summarizeRiskRegister`, `getExposureDistribution`.

Duplicated or consumer-local logic:

- Risk Register has local `reviewDueState` and `actionStateFor` helpers.
- Narrative page builds current risk preview locally after fetching current linked risks.
- Dashboard area signal has its own aggregation helper, though it consumes risk assurance tone.
- Tests re-create representative risk objects and expected action-state behaviours; these are useful regressions but may need updates after activation rules change.

Recommendation:

- Keep `src/lib/projectRisks.ts` as the first authoritative location for MVP lifecycle/action-state rules, but separate the public API into clearer concepts:
  - lifecycle category and transition/readiness;
  - exposure/estimated exposure;
  - assurance areas;
  - action-state roll-up;
  - presentation labels.
- Do not centralise or refactor broadly in this assessment slice.

## Risk Register impact

Current Risk Register behaviour is mostly aligned with the Epic:

- Default tab is Active risks.
- Tabs are Active risks, Need action, Draft and Closed.
- Draft and Closed reference pills are neutral/reference-only.
- Draft medium/medium defaults display as Unassessed.
- Non-placeholder Draft probability/impact values display as provisional estimated exposure.
- Closed risks display no current exposure in the register.
- Search, filters, sort, pagination, summary cards, Needs Action and exposure distribution are derived from authorised project-scoped risks.
- Needs Action excludes Draft and Closed records.
- Exposure distribution excludes Draft records and separates Closed.
- Critical/High exposure can affect sorting but does not by itself create a Needs Action item.

Dependencies/conflicts with WT-RISK-REG-UX-009:

- WT-RISK-REG-UX-009 appears implemented in the assessed branch and should be preserved.
- Manual/prompt Draft alignment will affect Draft tab volume and default Draft exposure display.
- Activation gate should update Draft row affordances and likely add readiness messaging, but should not alter register sorting/filtering first.
- Shared action-state changes must keep `riskMatchesRegisterView`, `summarizeRiskRegister`, `getTopRiskActionItems` and `getExposureDistribution` consistent.

Recommendation:

- Treat the current WT-RISK-REG-UX-009 behaviour as a dependency to retain, not as work to absorb.
- Later lifecycle slices should include targeted register tests to confirm Draft/Active/Closed and Needs Action behaviour remain stable.

## Dashboard and project signal impact

Current behaviour:

- `deriveRiskTileAttentionSignal` uses `deriveRiskAreaSignal`.
- `deriveRiskAreaSignal` excludes non-active risks through `isDashboardActiveRiskStatus`.
- Risk tile and project-list action state are based on assurance/action state, not raw exposure.
- Project Health remains separate and Unknown.
- Project Details and Risk area signals aggregate with Red over Amber over Unknown over Green.

Risk of unintended change:

- Any change to `deriveRiskAssuranceTone` immediately affects Risk Register Needs Action, risk detail action state, dashboard Risk tile and project-list action state.
- Any change to `isActiveRiskStatus` changes active risk counts, dashboard signals, Needs Action and exposure chart inputs.
- Any change to exposure mapping can affect sorting and estimated exposure display without necessarily affecting action state.

Recommendation:

- Keep project-level health policy out of lifecycle implementation.
- Add tests that assert risk action-state changes do not become project health changes.

## Narrative impact and recommendation

Current implementation:

- Risk-generated entries are created by `src/lib/projectRisks.ts`.
- Entry text includes historical action state and lifecycle text at creation time.
- `source_type = 'risk'`, `source_record_id = risk_id`, and `source_ref = risk_ref` link the entry to the risk.
- `attention_level` stores the entry's creation-time attention value.
- The Narrative page lists entries from `project_narrative_entries`.
- The page then fetches current linked risks with `listProjectRisksByIds` and builds `sourceRisk` preview data from current risk helpers.
- The table pill uses stored `entry.attention_level`, not the current linked risk state.
- The detail modal uses current risk preview values when the linked risk is available.

Preferred target approach:

- Preserve historical `title`, `details`, `attention_level`, `source_ref` and `source_record_id`.
- For visible risk-state pills on risk-linked rows, resolve the current linked risk state at read/render time.
- Prefer the existing separate linked-risk fetch and map approach for MVP because it already exists and avoids rewriting historical records.
- Introduce a small presentation helper that returns the visible Narrative row pill for risk-linked entries:
  - current risk action state for active linked risks;
  - Draft/Closed neutral lifecycle state for non-active linked risks;
  - stored entry attention for manual/non-risk entries;
  - neutral/unavailable state if the linked risk is missing, archived, deleted or inaccessible.

Why not rewrite Narrative entries:

- Rewriting would mutate historical records and blur the audit boundary.
- It could create noisy audit updates and read-state side effects.
- It is unnecessary because `source_record_id` already supports live lookup.

Migration assessment:

- No migration required for current-state dynamic pills.
- A future audit snapshot model could be added later, but it should not drive visible current-state pills.

Performance considerations:

- Current implementation fetches linked risks in one `in` query per Narrative page. This is adequate for MVP page-sized data.
- If Narrative grows large or gains pagination, keep the same concept but align linked-risk fetch with page boundaries or use an explicit joined view/RPC.

Test implications:

- Add tests that Red -> Amber, Red -> Green, Amber -> Red and Closed/Draft changes alter the visible row pill without changing stored entry text.
- Add tests for missing/deleted linked risk fallback.

## Impact matrix

| Proposed change | Existing areas affected | Conflict/dependency | Migration likely? | Risk level | Recommended slice |
| --- | --- | --- | --- | --- | --- |
| Draft activation gate | Detail lifecycle form, edit route, `updateProjectRisk`, `transitionProjectRiskLifecycle` | Edit path bypasses lifecycle action restrictions | No initially | High | WT-RISK-LIFECYCLE-003 |
| Lightweight capture | Manual create route, `RiskForm`, validation | Manual defaults Open and requires probability/impact | No if using existing compatibility defaults | Medium | WT-RISK-LIFECYCLE-002 |
| Manual/prompt alignment | Manual create, prompt-drafts, register feedback | Prompt route already Draft, manual not | No | Medium | WT-RISK-LIFECYCLE-002 |
| Draft Unassessed default | `getRiskRegisterExposureDisplay`, prompt creation, manual Draft | Currently inferred from Draft medium/medium | No | Medium | WT-RISK-LIFECYCLE-002 |
| Draft estimated exposure | Register sorting/display, edit exposure | Works via non-placeholder probability/impact | Maybe later if estimate needs separate storage | Medium | WT-RISK-LIFECYCLE-004 |
| Forgiving Amber roll-up | `worstTone`, dashboard aggregation, tests | Already aligned; preserve | No | Low | WT-RISK-LIFECYCLE-001B |
| Shared action-state helper | Risk detail/register/dashboard/Narrative | Some presentation duplication remains | No | Medium | WT-RISK-LIFECYCLE-001B |
| Risk Register consistency | Register page and helpers | UX-009 should remain stable | No | Medium | WT-RISK-LIFECYCLE-004 |
| Dashboard consistency | `dashboardTileSignals`, `projectAttention` | Changes to risk assurance affect project action state | No | Medium | WT-RISK-LIFECYCLE-005 |
| Narrative current-state pill | Narrative page, current risk fetch | Row pill still uses stored attention | No | Medium | WT-RISK-LIFECYCLE-006 |
| Audit continuity | Narrative entries, notes, audit fields | No complete lifecycle history table | Maybe later | Medium | WT-RISK-LIFECYCLE-003 / WT-RISK-LIFECYCLE-007 |
| Permissions | `permissions.ts`, RLS, helpers | Activation is `risk.edit`; no separate permission | Maybe if approval chains later | Low for MVP | WT-RISK-LIFECYCLE-003 |

## Tests and validation coverage

Existing strong coverage:

- Schema and RLS: `tests/risks.test.mjs`, `tests/project-narrative.test.mjs`.
- Lifecycle helpers: Draft/Active/Closed categorisation in `tests/risks.test.mjs`.
- Register filters/sorts/tabs/pagination/summary/Needs Action/exposure chart in `tests/risks.test.mjs`.
- Action-state and exposure separation in `tests/risks.test.mjs`.
- Prompt-created Drafts, duplicate prevention and traceability in `tests/risks.test.mjs`, `tests/risk-prompts.test.mjs`.
- Risk-generated Narrative entries for raised, opened, closed, reopened and became-Red events in `tests/risks.test.mjs`.
- Narrative source metadata, list, links and read-state in `tests/project-narrative.test.mjs`.
- Dashboard/project-area risk signal behaviour in `tests/risks.test.mjs` and `tests/projects.test.mjs`.
- RBAC and route-scoping checks in `tests/risks.test.mjs`, `tests/projects.test.mjs`, `tests/feature-flags.test.mjs`.

Missing or weak coverage:

- No direct test asserts that multiple Amber areas remain Amber without escalation to Red.
- No activation gate tests because no gate exists.
- No test proving the edit route cannot bypass Draft activation rules; today it can.
- No test for Narrative row pill current-state behaviour; current modal preview is live but row pill is stored.
- No dedicated test that manual creation defaults to Draft after future alignment.
- No test for missing/deleted linked risk pill fallback beyond current unavailable modal fallback.
- No lifecycle transition history completeness test beyond Narrative/note side effects.

Tests likely to change when implementation begins:

- Manual create/edit validation tests that currently expect status/probability/impact required at creation.
- Route tests that expect the full `RiskForm` status select on create.
- Lifecycle transition tests once activation gate blocks incomplete Drafts.
- Narrative page tests once row pills use current linked risk state.

Tests to preserve as regressions:

- Prompt-created Draft source traceability and duplicate protection.
- Draft/Closed exclusion from Needs Action and dashboard signals.
- Exposure/action-state separation.
- Forgiving action-state roll-up.
- Viewer write rejection and active member owner/actioner checks.
- Project Health remains Unknown.

## Product decisions required

- Minimum activation fields.
- Whether description is required for activation, and whether a short description is Amber or blocks activation.
- Whether owner is mandatory for activation.
- Whether actioner is mandatory for activation or Red assurance after activation.
- Whether review date is mandatory for activation or Amber assurance after activation.
- Whether due date belongs in activation, assurance, both or neither.
- Whether probability and impact are mandatory for activation.
- Whether estimated exposure can satisfy activation before full probability/impact assessment.
- Whether mitigation is mandatory for activation by exposure level.
- Whether contingency is mandatory for activation or Red assurance only.
- Empty/no-applicable-area action-state behaviour for active risks.
- Materialised-risk handling in the lifecycle: status, closure path and whether it is always Red.
- Closure requirements: reason mandatory or optional, dedicated metadata or notes only.
- Narrative display for missing, archived, deleted or inaccessible linked risk.
- Whether activation should have a distinct permission or remain part of `risk.edit`.
- Whether manual initial capture should default to Draft always.

## Recommended implementation slices

### WT-RISK-LIFECYCLE-001B - Shared lifecycle/action-state contract hardening

Objective: Make the current lifecycle, exposure, assurance and action-state contract explicit in code and tests without changing behaviour.

Included scope:

- Add direct tests for forgiving Amber roll-up.
- Add tests documenting no cumulative Amber escalation.
- Add tests around active/Draft/Closed action-state exclusions across register, dashboard and detail.
- Add a small helper/readiness API skeleton only if it preserves behaviour.

Excluded scope:

- No activation gate.
- No form redesign.
- No Narrative row pill change.

Dependencies: None.

Database impact: None.

Primary files likely affected: `src/lib/projectRisks.ts`, `tests/risks.test.mjs`, docs.

Test scope: Unit/helper tests only.

Manual validation focus: Confirm current register/detail/dashboard presentation does not change.

Delivery risk: Low.

### WT-RISK-LIFECYCLE-002 - Manual and prompt Draft capture alignment

Status: completed. Manual Raise a risk now creates a Draft-only `project_risks` record through the same source-of-truth model as prompt-created Drafts. The create form removes lifecycle/status selection, states that the risk will be created as a Draft for review and assessment, requires only a title, and treats probability/impact as optional Draft-capture fields. Server-side creation enforces `status='draft'` regardless of submitted status payload and does not create Project Narrative entries. Prompt-created Draft behaviour, duplicate detection and `source_risk_prompt_id` traceability are unchanged.

Known limitation carried forward: the current non-null probability/impact schema still uses Medium/Medium compatibility defaults for untouched Drafts. These display as `Unassessed`, but the system cannot reliably distinguish untouched compatibility Medium/Medium from a deliberately supplied Medium/Medium estimate until a future readiness/profile design adds an explicit marker or schema change.

Objective: Align manual risk creation with prompt-created Drafts while keeping initial capture lightweight.

Included scope:

- Decide and implement manual default Draft behaviour.
- Keep source-of-truth `project_risks` model shared for both routes.
- Preserve prompt-created duplicate/source traceability.
- Adjust create form validation and wording.
- Preserve compatibility defaults for probability/impact unless a migration decision is made.

Excluded scope:

- No activation gate beyond creating Drafts consistently.
- No Governance Profile rules.

Dependencies: WT-RISK-LIFECYCLE-001B.

Database impact: None expected.

Primary files likely affected: `RiskForm.astro`, manual new route, `projectRisks.ts`, tests, docs.

Test scope: Manual create, prompt create, register Draft display.

Manual validation focus: Create manual Draft, create prompt Draft, verify both appear in Draft tab as Unassessed.

Delivery risk: Medium.

### WT-RISK-LIFECYCLE-003 - Minimum activation gate

Status: completed. Draft activation readiness now lives in `src/lib/projectRisks.ts` and is enforced by both `transitionProjectRiskLifecycle` and `updateProjectRisk`. The detail page shows activation readiness, keeps the Activate risk action visible but disabled until ready, and Draft edit no longer exposes direct lifecycle/status selection. Drafts may activate only to `open`; crafted Draft -> Monitoring/Mitigating/Escalated/Materialised and Draft -> Closed updates are rejected before mutation or Narrative creation.

Objective: Prevent Draft risks from becoming active until agreed minimum activation information is complete.

Included scope:

- Implement server-side activation readiness validation in all status transition/update paths.
- Add UI readiness messaging on detail/open action.
- Distinguish activation blockers from Amber/Red assurance gaps.
- Preserve active risks that are imperfect but visible as Amber/Red.

Excluded scope:

- No organisation-specific rules.
- No configurable Governance Profile.
- No approval chains.

Dependencies: Product decisions on activation fields; WT-RISK-LIFECYCLE-001B; preferably WT-RISK-LIFECYCLE-002.

Database impact: migration `20260712000100_project_risk_assessment_completion.sql` adds nullable `assessment_completed_at` and `assessment_completed_by` fields. No backfill is applied, so existing compatibility Medium/Medium Drafts remain Unassessed until a deliberate assessment is recorded.

Primary files likely affected: `projectRisks.ts`, risk detail route, edit route, tests, docs.

Test scope: Draft activation blocked/allowed, edit-route bypass prevention, lifecycle action path.

Manual validation focus: Incomplete Draft cannot open; complete Draft opens and creates expected Narrative entry.

Delivery risk: Medium. The MVP gate is implemented, while organisation-specific rules, approval chains and Governance Profiles remain deferred.

### WT-RISK-LIFECYCLE-004 - Risk Register lifecycle/readiness presentation

Objective: Reflect activation readiness and action-state rules consistently in the register without changing the underlying gate.

Included scope:

- Add Draft readiness indicators after the gate exists.
- Keep Draft/Closed neutral reference pills.
- Keep Needs Action active-only.
- Keep exposure, estimated exposure and action state separate.

Excluded scope:

- No new cumulative Amber threshold.
- No portfolio aggregation redesign.

Dependencies: WT-RISK-LIFECYCLE-003.

Database impact: None expected.

Primary files likely affected: risk register route, `projectRisks.ts`, tests.

Test scope: Register tabs, filters, sorting, Draft readiness, Needs Action.

Manual validation focus: Draft, Active, Need action and Closed tabs remain coherent.

Delivery risk: Medium.

### WT-RISK-LIFECYCLE-005 - Dashboard and project-signal alignment

Objective: Ensure dashboard/project-list consumers use the same risk action-state contract without altering Health.

Included scope:

- Confirm all project-level risk consumers use the shared active-risk action-state helper.
- Add regression tests for Health separation.
- Document any remaining user-specific Narrative read-state separation.

Excluded scope:

- No Project Health implementation.
- No portfolio roll-up redesign.

Dependencies: WT-RISK-LIFECYCLE-001B and any action-state helper changes.

Database impact: None.

Primary files likely affected: `dashboardTileSignals.ts`, `projectAttention.ts`, tests.

Test scope: Risk tile, project list action state, Health remains Unknown.

Manual validation focus: Project dashboard Risk tile and project list pills remain explainable.

Delivery risk: Medium.

### WT-RISK-LIFECYCLE-006 - Narrative current-state linked-risk pills

Objective: Show current linked-risk state on risk-linked Narrative row pills while preserving historical entry text.

Included scope:

- Reuse current linked-risk fetch/map.
- Derive visible row pill from current linked risk for risk source entries.
- Keep stored `attention_level`, title and details unchanged.
- Add missing/deleted linked risk fallback.

Excluded scope:

- No rewriting existing Narrative entries.
- No new Narrative entries when risk state changes.
- No audit snapshot redesign.

Dependencies: WT-RISK-LIFECYCLE-001B; can proceed before activation gate if scoped to current helpers.

Database impact: None.

Primary files likely affected: Narrative page, possibly a small helper, tests.

Test scope: Red/Amber/Green current-state display, missing linked risk fallback, historical text unchanged.

Manual validation focus: Change a linked risk from Red to Amber/Green and confirm existing Narrative row pill updates.

Delivery risk: Medium.

### WT-RISK-LIFECYCLE-007 - Audit and lifecycle evidence hardening

Objective: Close evidence gaps after activation and closure decisions are known.

Included scope:

- Decide whether lifecycle transitions need a dedicated history table or enhanced notes.
- Decide whether closure reason is mandatory and where it belongs.
- Confirm `updated_by` and Narrative/notes are enough for MVP.

Excluded scope:

- No automated escalation.
- No approval-chain implementation.

Dependencies: WT-RISK-LIFECYCLE-003 product decisions and implementation.

Database impact: Possible.

Primary files likely affected: migrations, `projectRisks.ts`, docs, tests.

Test scope: Audit immutability, transition history, closure evidence.

Manual validation focus: Activation/closure evidence visible enough for assurance.

Delivery risk: Medium.

## Epic traceability

| Slice | Parent Epic ID | Epic outcome supported | Dependencies on other slices | Requirements/product decisions addressed | Areas explicitly deferred |
| --- | --- | --- | --- | --- | --- |
| WT-RISK-LIFECYCLE-001B | WT-RISK-LIFECYCLE-EPIC-001 | One authoritative action-state model; consistency across surfaces | None | Forgiving Amber rule, action-state separation | Governance Profiles |
| WT-RISK-LIFECYCLE-002 | WT-RISK-LIFECYCLE-EPIC-001 | Every creation route uses same model; lightweight capture | WT-RISK-LIFECYCLE-001B | Initial manual-create status, Draft default, title-only capture, optional details retained, no Draft Narrative | Activation enforcement |
| WT-RISK-LIFECYCLE-003 | WT-RISK-LIFECYCLE-EPIC-001 | Draft risks cannot progress until minimum activation information is complete | WT-RISK-LIFECYCLE-001B, WT-RISK-LIFECYCLE-002 | Minimum activation fields, owner/review/assessment decisions, edit-route bypass prevention, no duplicate Narrative | Organisation-specific activation rules, approvals, Draft withdrawal |
| WT-RISK-LIFECYCLE-004 | WT-RISK-LIFECYCLE-EPIC-001 | Risk Register consistency; lifecycle/exposure/action-state separation | WT-RISK-LIFECYCLE-003 | Readiness display and register behaviour | Portfolio aggregation redesign |
| WT-RISK-LIFECYCLE-005 | WT-RISK-LIFECYCLE-EPIC-001 | Dashboard signals and health consumers remain consistent | WT-RISK-LIFECYCLE-001B | Project action-state versus Health separation | Project Health policy |
| WT-RISK-LIFECYCLE-006 | WT-RISK-LIFECYCLE-EPIC-001 | Narrative entries preserve text while showing current linked risk state | WT-RISK-LIFECYCLE-001B | Missing/deleted linked risk display | Rewriting historical entries, audit snapshot model |
| WT-RISK-LIFECYCLE-007 | WT-RISK-LIFECYCLE-EPIC-001 | Lifecycle closure and audit evidence are supportable | WT-RISK-LIFECYCLE-003 | Closure requirements, lifecycle evidence | Approval chains, automated escalation |

## Recommended next implementation slice

Recommended next slice: WT-RISK-LIFECYCLE-004 - Risk Register lifecycle/readiness presentation.

Status: WT-RISK-LIFECYCLE-001B, WT-RISK-LIFECYCLE-002 and WT-RISK-LIFECYCLE-003 are complete. The shared lifecycle/action-state contract is hardened, all current initial capture routes create Draft risks, and Draft activation is blocked until the minimum activation information is complete.

Defect follow-up: WT-RISK-LIFECYCLE-001B-FIX-001 records the MVP review-date window in the shared contract. Active risks with no review date are Amber, overdue review dates and review dates due today are Red, review dates due tomorrow or within the next three calendar days are Amber, and later review dates are Green. The three-day window is an MVP constant that can later move into configurable Governance Profiles. No database migration or production data change is required.

Why first:

- It is the next dependency after the activation gate.
- It can surface Draft readiness consistently in the Risk Register without changing activation rules.
- It can build on the central lifecycle/action-state contract, unified Draft capture and shared activation-readiness helper.
- It can keep Risk Register views consistent while Narrative live-state display remains a later slice.

## WT-RISK-LIFECYCLE-001A assessment constraints confirmation

The following constraints describe the original WT-RISK-LIFECYCLE-001A assessment-only slice, not later implementation slices recorded in this document:

- No lifecycle redesign was implemented.
- No migrations were added.
- No production data was changed.
- Existing risk and Narrative behaviour was not changed.
- No broad refactoring was introduced.
- No tests were modified to make behaviour pass.

## Required Codex completion summary inputs

Current risk creation routes:

- Manual: `/app/workspaces/{workspaceSlug}/projects/{projectSlug}/risks/new`.
- Prompt-created Drafts: `/app/workspaces/{workspaceSlug}/projects/{projectSlug}/risks/prompt-drafts`.

Current risk update routes:

- Full edit: `/app/workspaces/{workspaceSlug}/projects/{projectSlug}/risks/{riskId}/edit`.
- Detail focused modals posting to edit route.
- Detail lifecycle forms using `transitionProjectRiskLifecycle`.
- Detail comments using `createProjectRiskComment`.

Current lifecycle map:

- Draft: `draft`.
- Active: `open`, `monitoring`, `mitigating`, `escalated`, `materialised`.
- Closed: `closed`; helper also treats `accepted`, `resolved`, `passed`, `retired`, `cancelled`, `rejected` as compatibility closed values.

Current activation behaviour:

- Draft activation requires title, meaningful description, active owner, deliberate probability/impact assessment and a review date that is not overdue.
- Lifecycle action Draft -> Open and edit-route Draft -> Open both use the same server-side readiness helper.
- Draft -> Monitoring/Mitigating/Escalated/Materialised and Draft -> Closed are rejected before mutation.
- Blocked activation creates no risk update, no lifecycle note and no Narrative entry.
- Successful activation creates the existing source-linked `Risk opened:` Narrative entry.

Current assurance areas:

- Description, lifecycle status, exposure, owner, actioner, review date, due date, mitigation, contingency, update freshness and assessment completeness.

Current action-state roll-up:

- Active risks only.
- Red if any Red driver exists.
- Amber if one or more Amber drivers exist and no Red exists.
- Green if no Red/Amber drivers exist.
- Draft and Closed risks are neutral for action state.

Known exclusions:

- Organisation-specific activation rules.
- Client-specific risk models.
- Configurable cumulative-Amber thresholds.
- AI-generated risk assessments.
- Automated escalation workflows.
- Portfolio-level aggregation redesign.
- Full Governance Profile implementation.
- Team-specific approval chains.
