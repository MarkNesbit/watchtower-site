# Watchtower Risk Foundation

**Status:** WT-RISK-LIFECYCLE-001 draft, active, closed and reopened risk handling; WT-RISK-LIFECYCLE-001A assessment complete; WT-RISK-LIFECYCLE-001B shared lifecycle/action-state contract hardened
**Scope:** Database, Row Level Security, constraints, indexes, migration tests, Risk Register, risk assurance detail, risk create and risk edit pages

## Current lifecycle assessment status

WT-RISK-LIFECYCLE-EPIC-001 is the parent Epic for unified Risk Capture, Assurance and Lifecycle Management across Watchtower.

WT-RISK-LIFECYCLE-001A is an assessment-only slice. The current-state repository and data-model assessment is recorded in `docs/risk-lifecycle-impact-assessment.md`. No lifecycle behaviour, activation gate, risk action-state logic, Risk Register behaviour, Project Narrative behaviour, permissions, migrations or production data changed in that assessment slice. Implementation slices will follow review of the assessment and will remain traceable to WT-RISK-LIFECYCLE-EPIC-001.

WT-RISK-LIFECYCLE-001B hardens the existing shared lifecycle and action-state contract under the same parent Epic. It makes the current forgiving Amber roll-up and Draft/Closed neutrality explicit in `src/lib/projectRisks.ts`, routes dashboard risk-area roll-up through that shared contract, and adds direct regression coverage. This slice does not introduce new lifecycle transitions, activation gates, creation defaults, Project Narrative behaviour, permissions, migrations, exposure rules, Project Health policy or production data changes.

WT-RISK-LIFECYCLE-001B-FIX-001 corrects active-risk review-date cadence inside that shared contract. Active risks with no review date are Amber. Overdue review dates are Red. Review dates due today or within the next three calendar days are Amber. Review dates later than that are Green. The three-day window is an MVP application constant and may later become configurable through Governance Profiles. This defect fix has no database migration or production data impact.

## Purpose

The risk foundation introduces the minimum database model needed for project-scoped risk management while preserving Watchtower's workspace isolation model. WT-RISK-002A added the first Risk Management UI surface for existing risk records, WT-RISK-002B added create/edit flows for permitted workspace roles, WT-RISK-002C simplifies the register while introducing block-level assurance signals on the detail page, WT-RISK-003 adds a nullable primary actioner assignment on the risk record, WT-RISK-004 adds focused edit modals and comments, WT-RISK-004A/004B polish the detail information architecture, WT-RISK-005 derives risk action state from governance and assurance drivers while keeping risk exposure separate, WT-RISK-NARRATIVE-001 creates Project Narrative entries for raised risks and existing risks that become Red action state, and WT-RISK-LIFECYCLE-001 separates draft, active, closed and reopened risk handling. It does not introduce risk delete, dashboard roll-ups, risk replies, risk comment-to-narrative integration, attention item generation, email notification delivery, action approval, health scoring, configurable governance scoring, AI scoring, multiple actioners, a separate Actions module, temporary handover/delegation, or non-risk RAID tables.

## Identifiers and references

Risks use two identifiers:

- `risk_id` is the internal UUID database identifier and should be used for relationships between tables.
- `risk_ref` is the human-readable display reference for users and cross-project conversations.

The intended reference format is:

```text
Risk-{PROJECT_REF}-{NNN}
```

For example:

```text
Risk-HHH-003
```

`projects.project_ref` is the short uppercase project reference used in these risk references. It must be unique within a workspace/organisation when present. Existing project UUID primary keys remain unchanged; `project_ref` is not a primary key.

Existing projects are not automatically given meaningful references by the migration, so the field remains nullable for those historical records. New project creation assigns a system-generated reference; existing projects without one require a controlled future assignment or recreation rather than user editing.

## Risk ownership and actioners

`project_risks.owner_id` means the accountable risk owner: the person responsible for managing and reviewing the risk.

`project_risks.actioner_id` means the primary actioner for the MVP risk record: the person responsible for carrying out mitigation, contingency, review, or follow-up activity. The risk owner remains accountable for managing the risk.

Both `owner_id` and `actioner_id` reference application profiles and are assigned from active members of the relevant workspace in the create/edit flow. Existing records can safely leave `actioner_id` null.

WT-RISK-003 deliberately supports only one primary actioner. A future `project_risk_actions` model may support multiple linked actions, approval workflow, proposed actioners and richer action history, but that is outside this slice.

## Risk fields

The foundation supports:

- project and workspace scoping through `project_id` and `organisation_id`;
- internal UUID relationships through `risk_id`;
- human-readable references through `risk_ref` and `risk_sequence`;
- status values: `draft`, `open`, `monitoring`, `mitigating`, `escalated`, `materialised`, `closed`;
- probability values: `low`, `medium`, `high`;
- impact values: `low`, `medium`, `high`;
- transitional RAG/concern values: `blue`, `green`, `amber`, `red`;
- owner accountability through `owner_id`;
- primary actioner responsibility through nullable `actioner_id`;
- optional source-prompt traceability through nullable `source_risk_prompt_id`;
- review and due dates;
- mitigation and contingency planning;
- creation, update, archive, and soft-delete audit fields.

## Threaded risk notes and replies

`project_risk_notes` stores threaded audit notes and replies for risks:

- `risk_note_id` is the explicit UUID primary key.
- `risk_id` links the note to the risk using the internal risk UUID.
- `parent_risk_note_id = null` means a top-level note.
- `parent_risk_note_id` populated means a reply to another note.

The schema permits threaded parent linking. A future UI may still choose to keep replies one level deep for simplicity.

Notes and replies capture `created_by`, `created_at`, optional `updated_by`, optional `updated_at`, and optional `deleted_at` so they can act as audit records.

WT-RISK-002A does not expose risk notes or replies in the user interface.

## Attention levels and notification future scope

Risk notes and replies include `attention_level` values:

- `green` = routine/informational;
- `amber` = needs awareness/review;
- `red` = urgent/rapid interaction likely required.

Future notification rules are expected to be:

- red note/reply = immediate email to the risk owner;
- amber/green note/reply = daily risk owner digest.

Notification delivery, notification event tables, email sending, and daily digest generation are future scope and are not implemented in WT-RISK-001.

## Project Narrative source-of-truth boundary

WT-NARRATIVE-002 adds `project_narrative_entries` with source metadata for Risk-to-Narrative workflow support. WT-RISK-NARRATIVE-001 now uses that existing schema; no new migration is required because `source_type`, `source_record_id`, and `source_ref` already support source-linked risk entries.

Risk-generated Narrative entries retain the authoritative `project_risks.risk_id` as `source_record_id` and a display value such as `Risk-HHH-003` as `source_ref`. Their own `NAR-{PROJECT_REF}-{NNN}` identity is still retained. The Risk record remains the source of truth and must be edited in Risk Management rather than through Project Narrative.

The integration is intentionally narrow. It creates one entry when a risk is raised and one entry when an existing risk's derived risk action state changes from non-Red to Red. It does not create entries for every edit, comments, owner/actioner/review-date-only changes, Green to Amber movement, Red staying Red, or Red moving down. The "became Red" trigger uses the WT-RISK-005 derived risk action state, not a manually selected or legacy stored RAG value.

WT-RISK-LIFECYCLE-001 adds three central lifecycle categories in `src/lib/projectRisks.ts`: Draft (`draft`), Active (`open`, `monitoring`, `mitigating`, `escalated`, `materialised`) and Closed (`closed`, with `accepted`/`resolved` treated as closed compatibility values). Draft risks are raised basic-capture records: they are visible in the Risk Register and Draft tab, have a project risk identity and audit trail, and still need project-specific detail, assessment and ownership before becoming Active/Open. They can hold exposure and ownership/planning fields, but they display as neutral, stay out of active-only action calculations, do not drive dashboard or project-list attention, and do not create Project Narrative entries when saved. Opening/publishing a draft risk moves it to `open`, returns it to active assurance calculation, preserves its existing detail, and creates a source-linked `Risk opened:` Narrative entry.

Closed risks remain auditable historical records. Closing an active risk changes its status to `closed`, optionally captures a closure note in `project_risk_notes`, creates a neutral source-linked `Risk closed:` Narrative entry, removes the risk from active assurance calculations, and keeps the historical exposure/detail fields intact. Reopening a closed risk changes it back to `open`, optionally captures a reopen note, creates a `Risk reopened:` Narrative entry, and makes the risk eligible for active assurance, dashboard and project-list attention again. Owner, Admin and Member roles can perform lifecycle transitions through the same server-side `risk.edit` permission; Viewers can see lifecycle state but cannot open/publish, close or reopen risks.

WT-RISK-LIFECYCLE-001B records the authoritative lifecycle grouping used by active action-state consumers: Draft is `draft`; Active is `open`, `monitoring`, `mitigating`, `escalated` and `materialised`; Closed is `closed`, with `accepted`, `resolved`, `passed`, `retired`, `cancelled` and `rejected` retained as safe terminal compatibility values. Active risk action state rolls up from assurance areas as Red when any area is Red, Amber when one or more areas are Amber and none are Red, Green when all applicable areas are Green, and Neutral for Draft or Closed risks. Multiple Amber areas deliberately remain Amber for the MVP. Risk Detail, Risk Register Needs Action, the dashboard Risk tile and project-list attention aggregation consume this shared lifecycle/action-state contract rather than treating exposure, stored `rag_status`, lifecycle status or project health as substitutes. Follow-on slices remain: manual Draft alignment, a minimum activation gate, and Narrative live-state row-pill display.

The active review-date cadence rule is part of that shared contract: no review date is Amber, an overdue review date is Red, a review date due today or within the next three calendar days is Amber, and a later review date is Green. Due-date policy is separate and was not redesigned by WT-RISK-LIFECYCLE-001B-FIX-001.

## Dashboard and RAID future scope

The project dashboard Risk tile routes to the project Risk Register when Risk Management is available. WT-DASH-RISK-001 and WT-DASH-TILE-SIGNALS-001 make the tile a compact attention/assurance signal without turning it into a count, badge or notification surface. The tile uses active risk management gaps rather than raw exposure: a high-exposure risk does not automatically make the tile Red if owner, action responsibility, mitigation/response, contingency and review cadence are current. Risk exposure remains visible in the Risk Register and Risk Detail views.

WT-SIGNAL-CONSISTENCY-001 reuses that same Risk attention/assurance signal for project-list attention aggregation. Risks can contribute Amber or Red project attention when active risks have unresolved assurance gaps, but raw exposure alone still does not drive project attention or Project Health. Draft and Closed risks are explicitly excluded from the active risk signal even when they have high exposure or incomplete owner/action/review/plan fields.

WT-PROJ-DETAILS-SIGNALS-001 does not change risk exposure, risk assurance or risk action-state rules. It keeps Risk as one included project-area attention source alongside Project Details, while Project Details section readiness is derived from project setup/date/responsibility fields only.

The following are also future scope and are not created by this foundation:

- Assumptions tables;
- Issues tables;
- Dependencies tables;
- Decisions tables;
- Actions tables;
- Timeline or milestone tables;
- automatic or configurable RAG/governance scoring;
- AI scoring.

## WT-RISK-002A/002B/002C Risk Management UI

The canonical route is:

```text
/app/workspaces/{workspaceSlug}/projects/{projectSlug}/risks
```

The create route is:

```text
/app/workspaces/{workspaceSlug}/projects/{projectSlug}/risks/new
```

The single-risk detail route is:

```text
/app/workspaces/{workspaceSlug}/projects/{projectSlug}/risks/{riskId}
```

The edit route is:

```text
/app/workspaces/{workspaceSlug}/projects/{projectSlug}/risks/{riskId}/edit
```

All routes resolve the signed-in user's active workspace membership by workspace slug, resolve the active project inside that workspace, and fetch or mutate risk records with matching `organisation_id` and `project_id`. The detail and edit routes also require the requested `risk_id` to belong to the resolved project and workspace. Users cannot access another workspace or unrelated project's risks by changing the URL or by altering submitted payloads.

WT-RISK-REG-UX-002 moves the Risk Register foundation toward the table-led redesign direction. The page now uses one compact all-risk register table rather than stacked Active, Draft and Closed sections. WT-RISK-REG-UX-003 adds the compact control layer above that table: All risks, Need action, Draft and Closed tabs with unfiltered counts, case-insensitive search across risk reference/title, Exposure/Action state/Owner/Lifecycle filters, active filter chips, reset, and sort options for Highest exposure first, Action needed first, Review due soonest and Recently updated. WT-RISK-REG-UX-004 adds graphical summary cards for Open risks, Need action and Highest exposure above the table controls; Draft count remains in the Draft tab and is styled Amber for one to five drafts or Red for more than five drafts. WT-RISK-REG-UX-005 adds a derived Needs Action panel that sits beside the register on wider screens and moves into the normal page flow on narrower screens. WT-RISK-REG-UX-006 adds pagination and compact density to the main table only. WT-RISK-REG-UX-007 adds a compact exposure distribution panel beside the register using a server-rendered SVG donut and text legend rather than a chart dependency. WT-RISK-REG-UX-008 adds bounded long-text previews and read-only full-text dialogs on the Core Risk detail page rather than changing register rows. The current MVP paginates the already authorised project-scoped risk list in application code after tab/search/filter/sort processing; if project risk volumes grow beyond modest register-sized datasets, this should move to server-side count/range queries without changing the UI contract. The default page size is 25 and supported page sizes are 10, 25 and 50. Invalid page and page-size query values are normalised safely, and pages beyond the final page clamp to the last valid page. Tab, search, filter, sort and page-size changes reset the table to page 1. Summary cards, the Needs Action panel and the exposure chart are derived from the same authorised project-scoped risk dataset but remain stable while search, filters and pagination narrow the table. Open risks and Draft risks are lifecycle counts. Need action counts active risks whose derived action state is Red or Amber and excludes closed/terminal records. The Needs Action panel also excludes Draft, Closed and terminal records, but lists specific active-risk action items rather than risk labels: assign owner, assign actioner, add mitigation, add contingency, set review date, review overdue or due-soon risk, set due date, assess exposure and update stale risk. One active risk may generate more than one panel item, so the panel count is not expected to match the Need action summary card. The exposure chart excludes Draft records, draws assessed active risks plus a Closed segment, uses assessed active risks plus closed risks as the percentage denominator, and calls out unassessed active risks separately rather than counting them as Low or Critical. Critical/High exposure can influence ordering but does not create an action item by itself; a well-managed Critical risk can be absent from the panel, while a lower-exposure active risk can appear when a specific action is due. Highest exposure is selected from assessed active risks only using Critical, High, Medium and Low ordering; Low exposure uses yellow and is never presented as Green. Search, tabs and filters combine through validated query parameters over the already project-scoped dataset. Need action is driven by Red/Amber action state for active risks, not by risk exposure alone. The default sort places higher exposure first, then higher action-state priority, then overdue/soonest review date, then most recently updated, with risk sequence/reference as the stable final tie-breaker. The panel ranks action items Red before Amber, then by explicit action priority, exposure as a tie-breaker, earliest review date, most recently updated risk and stable reference/type ordering, and shows the top four items. The register displays concise columns for Ref, Risk, Exposure, Lifecycle/Status, Owner, Review due and Updated. The Ref pill carries action-state colour and opens the risk detail page, so a separate Action state column and Open action column are not duplicated. Exposure uses the Watchtower Default MVP exposure labels and colours from WT-RISK-REG-UX-001: Critical red, High orange, Medium amber and Low yellow, without a redundant "Exposure" status suffix in the pill. Action state is separate and uses Red/Amber/Green only for active action-needed state; Draft and Closed rows show neutral non-active action state on the reference pill. Lifecycle/status remains its own column and must not substitute for exposure or action state. Summary cards, the panel and the chart are not Project Health, which remains Unknown. Future WT-RISK-REG-UX slices will add the risk prompt workflow. Targeted partial refresh of the chart and related panels may be considered after MVP, but the current architecture remains server-rendered and full-page refresh after risk changes is acceptable. Persistent attention items, notifications, acknowledge/dismiss workflows and user-level action dashboards remain separate future work. The same table-led, paginated register, action-queue and compact visual-summary pattern is intended to inform later RAID modules using their own seriousness models, but those modules remain out of scope.

WT-RISK-REG-UX-009 changes the current Risk Register default view from the historical all-lifecycle view to `Active risks`. The tab set is `Active risks`, `Need action`, `Draft` and `Closed`; explicit Draft, Closed and Need action query states are still preserved, including the guided-prompt success redirect to Draft. Active risks retain the existing highest-exposure default ordering, Need action retains action-needed ordering, Draft defaults to estimated exposure priority Critical, High, Medium, Low, Unassessed and then oldest Draft first, and Closed defaults to most recently updated/closed first. Draft and Closed reference pills are neutral grey reference-only pills: the visible pill shows only the `Risk-{PROJECT_REF}-{NNN}` reference, while the accessible label still includes Draft or Closed lifecycle context. Draft exposure is displayed as provisional `Estimated exposure`; newly created manual and prompt-created Drafts use the existing required probability/impact compatibility default and display as `Unassessed` until a non-placeholder estimate is stored. Existing Drafts with non-placeholder probability/impact values keep their estimated exposure. Closed rows display no current exposure (`—`) in the register, and the Closed tab disables the current exposure filter so it does not imply current exposure remains active. No migration is required for this display-normalisation approach; the stored compatibility values are not overwritten, and `rag_status='blue'` remains technical compatibility only rather than user-facing risk assessment.

The risk detail page is now an actionable assurance view focused on what needs attention. It displays Green, Amber, Red, Neutral and Unknown indicators for action state, assurance and lifecycle readiness, while risk exposure uses separate seriousness labels. Each editable detail card opens a focused edit modal for the relevant source-of-truth fields and posts through the existing scoped edit route. Risk exposure is the assessed seriousness of the risk. For the Watchtower Default MVP model, exposure labels are Critical, High, Medium and Low. Critical uses red styling, High uses orange, Medium uses amber and Low uses yellow; Low exposure must not be styled as green because it is still a risk. The current probability/impact mapping is: High/High or missing/unknown data = Critical, Medium/High or High/Medium = High, any other valid combination with Medium or High probability/impact = Medium, and Low/Low = Low. This default exposure model is deliberately named as a current/default assessment so future configurable risk assessment profiles can define dimensions, labels, thresholds, evidence needs, review cadence and escalation rules without replacing every UI concept. Risk action state is the visible Red/Amber/Green indicator for whether action is needed or recommended now. Red means action needed, Amber means action recommended and Green means no current action due. Action state may consider exposure-related evidence needs, but it is not the same thing as exposure and a risk itself is not presented as Green. Missing owner, required action responsibility, contingency plan, Materialised status, and unresolved Escalated status are Red for active risks; missing review date or due date is Amber for active risks; overdue review date is Red for active risks; review dates due today or within the next three calendar days are Amber for active risks; missing mitigation is Red for Critical exposure, Amber for High/Medium exposure and Green for Low exposure in this MVP. Draft and Closed risks keep exposure visible but present assurance fields as Neutral because they are not active assurance records. The detail page shows action-state rationale as explanation bullets rather than duplicating the top Red/Amber/Green pill. These signals are not the final Governance Profile / Assessment Profile engine and do not alter project health or create attention/notification side effects.

Long free-text fields in Current Risk Detail, including risk description, mitigation plan and contingency plan, are previewed in overview cards rather than rendered in full. Populated long text is clamped to a short card preview and exposes a read-only full-text dialog from the card area when the content exceeds the preview threshold. The dialog preserves line breaks, wraps long unbroken content, moves focus into the dialog, closes with the native dialog controls including Escape, and returns focus to the opening control. Missing long-text fields still show their existing missing/action prompts directly on the card, so truncation does not hide required action-state drivers. This is a UX presentation change only: it does not change exposure, action state, lifecycle, project health, stored values or edit authority.

Owner, Admin and Member roles may create and edit risks when the `riskManagement` feature flag permits access. Create captures title, description, lifecycle status, probability, impact, owner, actioner, review date, due date, mitigation plan and contingency plan, then generates the next project-scoped reference in `Risk-{PROJECT_REF}-{NNN}` format. Saving a Draft risk creates only the Risk record; saving an active new risk creates the raised-risk Narrative entry. Edit allows those same editable fields to be updated while preserving immutable scope and creation fields. Lifecycle status edits that move Draft -> Active, Active -> Closed or Closed -> Active create the same open/close/reopen Narrative entries as the detail-page lifecycle controls. The database audit trigger binds `created_by` and `updated_by` to the authenticated user. The `project_risks.rag_status` column remains as legacy/transitional compatibility storage, but user-facing flows no longer treat it as a manually declared source of truth.

WT-RISK-GUIDE-005 adds guided Draft risk creation from the Risk Register prompt modal without changing manual risk creation. The new route `/app/workspaces/{workspaceSlug}/projects/{projectSlug}/risks/prompt-drafts` accepts selected stable `risk_prompt_id` values, derives workspace and project from the route, enforces the same `risk.create` permission as manual creation, reloads active prompt data from the database, and creates Draft risks using the existing project-scoped reference generator. Prompt titles map to risk titles and prompt guidance maps to risk description. Owner, actioner, dates and planning fields remain null, and prompt-created records stay out of active action-state and Needs Action calculations until a user later opens/publishes them through the normal Draft lifecycle. The stored `rag_status='blue'` value for a Draft is technical compatibility with the legacy required column only and must not be displayed or interpreted as an assessed Blue risk.

Prompt-created risks store `source_risk_prompt_id`, added by migration `20260709000100_project_risk_prompt_source.sql`, so source traceability survives future prompt title or guidance edits. The field is nullable for manual risks. The same migration adds `project_risks_project_source_prompt_key`, a partial unique index on `(project_id, source_risk_prompt_id)` for non-deleted source-prompt risks, plus a lookup index on `source_risk_prompt_id`. This prevents repeat creation from the same prompt in the same project while allowing that prompt to be used in other projects. This one non-deleted project risk per source prompt per project rule is an MVP constraint and should be reviewed later using real usage data.

The guided creation flow uses deterministic partial success at the application layer rather than a dedicated database transaction/RPC. It pre-checks duplicates, inserts valid non-duplicate prompts sequentially, treats a concurrent unique-index conflict as a skipped duplicate, reports created and skipped counts, and stops on unexpected insert errors with a safe user-facing message. Multi-record creation reuses the same reference-generation helper as manual risk creation, including retry after project-scoped sequence/reference conflicts. No active risk, Project Narrative entry, notification, attention item, owner assignment or scoring workflow is created by this slice.

Migration `20260710000100_project_risk_insert_updated_by.sql` updates the existing project-risk audit trigger so newly raised manual and prompt-created risks set both `created_by` and `updated_by` to `auth.uid()` on insert. `created_at` and `updated_at` remain database timestamps. Draft age can therefore be derived from `created_at`, and raised-by/raised-when information is available from `created_by` and `created_at`. Follow-up requirement: surface how long a risk has remained Draft and challenge Drafts older than an initial 14-day threshold.

## WT-RISK-GUIDE-001 Default prompt library foundation

WT-RISK-GUIDE-001 adds the Watchtower Default Risk Prompt Library as global reference data for later guided risk identification. The controlled CSV is stored at `data/risk-prompts/watchtower_default_risk_prompt_library_v1_0.csv`; it is validated and seeded through `scripts/seed-risk-prompts.mjs` and `supabase/seed-risk-prompts.sql` rather than parsed on every page request.

The schema migration `20260708000100_risk_prompt_library_foundation.sql` adds normalized `risk_prompt_libraries`, `risk_prompt_areas` and `risk_prompts` tables with uniqueness on library key/version, area key/order and stable `risk_prompt_id`. Prompt records use `risk_default_status='draft'` only. Removed CSV rows are not automatically deleted, and existing prompt IDs should normally be deactivated rather than reused or removed.

The Account page Risk Management modal is a read-only capability view. It loads the default library name, version, active risk-area count and active prompt count from seeded database records. Upload, download, custom libraries, workspace overrides, organisation-managed libraries, alternative assessment profiles and custom exposure models are shown only as unavailable future functions. The slice does not change project risk creation, prompt selection, draft activation or source-prompt traceability fields on `project_risks`.

WT-RISK-GUIDE-002 adds the Risk Register prompt modal, now entered through the `Risk Suggestions` action. It reads the active default library, active areas and active prompts from the seeded database records, and renders areas as tabs. WT-RISK-GUIDE-003 hardens temporary cross-category selection: the browser keeps one authoritative `Set<string>` of selected `risk_prompt_id` values, derives per-area badges and the footer total from that set, preserves selections while users move between tabs, and clears all selections when the modal closes. WT-RISK-GUIDE-004 enables `Show selected only` as a derived review mode over that same Set: selected prompts are grouped by risk area, can be deselected from the review view, and synchronise back to tab badges and original prompt controls immediately. The journey remains read-only: viewers can review and temporarily select prompts, no project risks are created, no prompt-library updates or write endpoints are introduced, and Draft risk creation is deferred to WT-RISK-GUIDE-005.

The detail page also exposes top-level `project_risk_notes` as Comments. Comments are listed newest first with author and timestamp. Owner, Admin and Member roles can add a comment; Viewer users can read comments but cannot add them. WT-RISK-004 and WT-RISK-NARRATIVE-001 do not add replies/threading UI, comment-generated Narrative entries, attention item creation, notifications or comment-to-action workflows.

WT-RISK-004A refines the detail page information architecture. The hero heading renders the risk reference with the action-state pill treatment, the Current risk panel carries a compact audit summary strip, and the main detail area is named Current Risk Detail. Comments now live at the bottom of Current Risk Detail rather than in a separate content block. Focused edit modals retain the native dialog accessibility model and use a dark blurred backdrop to keep the active edit task foregrounded. WT-RISK-004B keeps that structure but removes duplicated concern and owner data from the summary strip, removes the "Actionable assurance" status pill, keeps only the Updated timestamp as the summary date, aligns top and bottom back navigation styling, and improves modal cancel contrast.

WT-RISK-005 and WT-RISK-REG-UX-001 separate lifecycle status, risk exposure, assurance quality and risk action state. Users update structured facts, Watchtower derives exposure from the current default probability/impact assessment, derives assurance from governance/control quality signals, and derives the action state shown in the risk reference pill from current action-needed rules. The rationale block explains the drivers behind that action state. Exposure labels and thresholds are part of the Watchtower Default MVP model only; future risk profiles may adapt exposure models, labels, thresholds and evidence rules without changing the distinction between exposure, action state, lifecycle/status and project health. Owner/actioner inactivity rules are documented as future-ready because `profiles.last_login_at` is available in the schema but the current `record_auth_audit_event('user.logged_in')` flow does not reliably maintain it. Temporary actioner handover/delegation also remains future scope and will need temporary actioner, handover reason, start date, end date, assigned by and original actioner fields.

All active workspace roles, including Viewer, may read available risk pages when the `riskManagement` feature flag permits access. Viewer users cannot create or edit risks and see disabled write actions or read-only action prompts. Viewers can read risk-generated Narrative entries and inspect the read-only current source-risk detail modal where Project Narrative is available, but they cannot edit the source risk from the Narrative modal. The modal uses the existing workspace-safe Risk Detail route for its Open full risk in new tab action and keeps exposure, attention/assurance and action state distinct. No role can delete risks, create Narrative entries for routine risk edits or comments, generate attention items, send notifications, change health scoring, invoke AI behaviour or manage a separate Actions module from WT-RISK-NARRATIVE-001.

## Project relationship ambiguity readiness

WT-US-0208 adds `project_relationships` as a separate project model foundation. A relationship whose type is `relates_to` is intentionally non-specific and should later be considered by project health/risk evaluation as a possible ambiguity signal: the relationship exists, but its dependency or enabling meaning is unclear.

This signal does not create a `project_risks` record, change RAG status, or alter health scoring in WT-US-0208. Any later conversion into a managed risk must be an explicit product and audit workflow rather than an automatic side effect of storing the relationship.

## Project reference dependency for Risk creation

Risk creation uses `projects.project_ref` as the authoritative project code in references such as `Risk-{PROJECT_REF}-{NNN}`. The project slug is routing-only and must not be used in risk references.

From WT-US-0202B onward, Watchtower generates a 3-4 character uppercase `project_ref` from the project name, resolves workspace/organisation collisions automatically, and fixes the reference at creation time. Users cannot edit or override it during MVP; a future admin-only override is outside the current scope. The same project reference may exist in another workspace/organisation.

Existing early projects without a valid `project_ref` need a controlled assignment or recreation before Risk records can be created for them. Risk creation is blocked for projects where `project_ref` is missing or invalid.
