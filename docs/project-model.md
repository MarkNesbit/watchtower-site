# Watchtower Project Model

**Status:** Product working reference through WT-RISK-LIFECYCLE-001

**Last updated:** 3 July 2026

**Related:** `docs/architecture/ADR-002 Workspace and Membership Model.md`, `docs/architecture/ADR-003 Project Domain Model.md`, `docs/ui-page-design-standard.md`, `docs/project-narrative.md`, `supabase/migrations/20260617000100_create_projects.sql`, `supabase/migrations/20260624000300_project_relationship_foundation.sql`, `supabase/migrations/20260624000400_project_narrative_schema_foundation.sql`, `supabase/migrations/20260625000100_project_narrative_entry_links.sql`, `supabase/migrations/20260702000100_project_narrative_read_states.sql`

## Purpose of a project in Watchtower

A project is the core object a user navigates, reviews, and progressively enriches in Watchtower.

Watchtower should help users understand a project's current position, delivery confidence, governance clarity, risks, dependencies, and next actions. Project records should support both simple early capture and later maturity, assurance, and health assessment.

Projects belong to workspaces. The database and migrations use the internal term `organisation`; the user interface should normally use the term `Workspace` unless existing code or schema names require otherwise.

## Required, optional, and health-significant fields

Watchtower distinguishes three separate concepts:

| Concept | Meaning |
| --- | --- |
| Required field | A field that must be present to create or save a project. |
| Optional field | A field that can be left blank without blocking project creation or saving. |
| Health-significant field | A field that may be optional for data entry but still affect future Red/Amber/Green health indicators if it is missing, vague, stale, or contradictory. |

**Principle:** Optional does not mean unimportant. Some optional fields should not block creation, but their absence may increase project uncertainty and may contribute to current project action state or future project health indicators.

## Initial required fields for creation

Project creation should remain deliberately lightweight. The current/default required fields should be minimal so users can capture a project early and enrich it over time.

The intended required concepts are:

- Project name/title.
- Workspace/organisation ownership.
- Created by / creator identity.
- Project status or lifecycle state, with a sensible default.
- Created/updated timestamps.

Current implementation notes:

- The database currently uses `projects.name` for the user-facing project title.
- The database currently uses `organisation_id` for workspace ownership.
- The database currently uses `created_by` for creator identity.
- The database currently uses `status` with allowed values `proposed`, `active`, `paused`, `completed`, and `cancelled`; application creation defaults to `proposed`.
- The database currently includes `health`, defaulting to `unknown`. This is present for future health display but should not be treated as a Red/Amber/Green scoring implementation; current UI should display project health as Unknown.
- The database currently includes generated/default `created_at` and `updated_at` timestamps.
- The application currently requires a Watchtower-generated `project_ref` for new project creation. It is a fixed user-facing reference, not an editable creation field.
- The database currently requires a `slug` for URL-safe identity within a workspace. This is an implementation field, not a primary user-facing product field.
- The current schema has nullable `description`, `archived_at`, and `deleted_at` fields.

Future naming preference: user-facing documentation and UI may use "project title" where clearer, but implementation should stay aligned with the current `name` field until a dedicated schema/naming task changes it.

## Recommended optional fields

The following project fields may be added progressively as the product matures. They are not all part of the current schema and should not be forced into WT-002B unless explicitly implemented by that task.

- Short description.
- Project owner.
- Sponsor.
- Delivery lead / delivery manager.
- Business area / client / department.
- Strategic objective / intended outcome.
- Success criteria.
- Current phase or lifecycle stage.
- Delivery approach, for example Scrum, Kanban, hybrid, waterfall, discovery, or unknown.
- Start date.
- Target date.
- Forecast date.
- Budget/funding status.
- Priority.
- Known risks.
- Known issues.
- Key assumptions.
- Dependencies.
- Related projects.
- Required-for relationships.
- Dependent-on relationships.
- Programme/portfolio grouping.
- Forecast confidence.
- Last reviewed date.
- Next review date.

## Health-significant field examples

| Field | Required at creation? | Health-significant? | Possible future health impact if missing/weak |
| --- | --- | --- | --- |
| Project name/title | Yes | Yes | Weak or vague naming may make ownership, reporting, and navigation unclear. |
| Workspace/organisation ownership | Yes | Yes | Missing or incorrect ownership would break isolation and make accountability unclear. |
| Project owner | No | Yes | Amber or Red risk if accountability is unclear, especially for active or committed work. |
| Sponsor | No | Yes | Amber if the governance route, escalation route, or senior accountability is unclear. |
| Target date | No | Yes | Amber or Red if a delivery commitment exists without a date, or if a date is stale or contradicted by forecast evidence. |
| Dependencies | No | Yes | Amber or Red if dependencies are unknown, vague, blocked, or only captured through a non-specific relationship such as `relates to`. |
| Delivery approach | No | Yes | Amber if the delivery method is unknown for an active project where cadence, evidence, or delivery controls should be clear. |
| Success criteria | No | Yes | Amber if value, completion criteria, or acceptance expectations are unclear. |
| Forecast confidence | No | Yes | Amber or Red if the project has delivery commitments but no evidence-based forecast or confidence signal. |
| Last reviewed date | No | Yes | Amber if the project information is stale, particularly for active delivery or committed work. |

## Red/Amber/Green principles

Watchtower should not define a full project health scoring algorithm yet. Until a dedicated health/scoring task exists, project health should display as Unknown and use these principles only:

- Green means the project has sufficient clarity and no obvious unmanaged warning signs.
- Amber means there is uncertainty, missing health-significant data, stale information, unclear ownership, unclear dependency position, or weakened delivery confidence.
- Red means there is a material unmanaged risk, missing critical ownership, blocked dependency, breached commitment, or significant delivery confidence concern.
- Missing data should usually start as uncertainty, not automatic failure.
- The impact of missing fields should depend on lifecycle stage and commitment level.
- Early idea/discovery projects should tolerate more unknowns.
- Active delivery or committed projects should be held to higher clarity expectations.

## Lifecycle and stage considerations

Field expectations may vary depending on project stage. Possible future stages include:

- Idea.
- Discovery.
- Planning.
- Active delivery.
- Paused.
- Completed.
- Cancelled / archived.

Exact lifecycle values must remain aligned with the current schema and code until a dedicated lifecycle task changes them. The current implementation uses `status` values `proposed`, `active`, `paused`, `completed`, and `cancelled`.

## WT-US-0208 project relationship readiness

WT-US-0208 adds a database and helper-code foundation for future relationships between projects. It is deliberately a readiness slice: there is no relationship management UI, programme or portfolio dashboard, cross-project reporting, automatic risk creation, or project health scoring change.

`project_relationships` stores a directed relationship from `source_project_id` to `target_project_id`. Both are internal project UUIDs and both must belong to the record's `organisation_id`. Composite foreign keys enforce that workspace boundary at database level. A project cannot relate to itself, and a partial unique index prevents more than one active relationship with the same source, target, and type. An inactive historical relationship does not prevent a later active record from being created.

Supported relationship types are:

- `relates_to`: a non-specific relationship whose meaning needs clarification;
- `dependent_on`: the source project depends on the target project;
- `required_for`: the source project is a prerequisite or enabler for the target project;
- `programme`: readiness for future programme grouping or visibility;
- `portfolio`: readiness for future portfolio grouping or visibility.

The `programme` and `portfolio` values do not create programme or portfolio entities in this slice. They reserve explicit semantics for later model evolution and visibility work without forcing project relationship data into an undifferentiated field.

All active Workspace members can read relationship records under Row Level Security. Owners, admins, and members can create, update, deactivate, or delete them; viewers are read-only. Feature flags do not replace these controls, and WT-US-0208 does not expose a user-facing route or tile.

A `relates_to` relationship is intentionally ambiguous. The helper `isAmbiguousProjectRelationshipType` makes it available to future project health/risk logic as a possible uncertainty signal, but it does not create a risk or alter health scoring in this slice.

Relationship records use UUIDs internally for referential integrity. Any future user-facing relationship view should identify projects with the human-readable `projects.project_ref` (and project name where useful), not expose or substitute raw UUIDs. Project references remain display identifiers and do not replace UUID foreign keys.

## WT-NARRATIVE-002 Project Narrative foundation

Project Narrative is the structured project assurance and history layer. `project_narrative_entries` links every event to both its workspace and project, assigns an immutable project-scoped entry number, and generates references such as `NAR-HHH-001` from the authoritative project reference. An internal atomic counter prevents concurrent collisions and prevents deleted references from being reused.

Entries may be manual or prepared for future Risk, Issue, Dependency, Assumption, and system sources. Optional source UUID/reference fields preserve traceability, but the source RAID module remains authoritative: Project Narrative does not become an editable substitute for a Risk or other delivery concern.

Owners, admins, and members can read and mutate Narrative entries for projects in an active workspace; viewers are read-only. Composite foreign keys and Row Level Security preserve workspace isolation. Audit timestamps use UTC-compatible `timestamptz`; optional context accepts validated IANA timezone names for later display/audit use.

WT-NARRATIVE-002 adds no Project Narrative page, form, table, modal, filters, RAID integration, notifications, export, or AI. See `docs/project-narrative.md` for the schema, reference, DTS, permission, and validation details.

## WT-NARRATIVE-003 manual Project Narrative entries

WT-NARRATIVE-003 makes Project Narrative usable for manual project context capture. Owners, admins, and members can create manual Narrative entries from the workspace/project Narrative route. Viewers can still read the table and detail modal, but the create action is visible and disabled with role-specific helper text.

Manual entries require Title, Details, and an Attention level. Attention defaults to Neutral and remains constrained to `neutral`, `green`, `amber`, and `red`. Manual entries are stored with `source_type = manual`, `source_record_id = null`, and `source_ref = null`, so they do not create or update Risk, Issue, Dependency, or Assumption records.

Structured links are stored in `project_narrative_entry_links`. Each link belongs to the same workspace and project as its parent Narrative entry, requires a label and safe `http://` or `https://` URL, and is protected by Row Level Security. Active workspace members can read links; owners, admins, and members can create links; viewers cannot create links. Link editing/deletion and RAID promotion/conversion are separate future stories.

## WT-RISK-NARRATIVE-001 Risk-to-Narrative event integration

WT-RISK-NARRATIVE-001 connects Risks to Project Narrative in a deliberately limited way. A Narrative entry is created when a new risk is raised, and when an existing risk changes from non-Red to Red using the WT-RISK-005 derived overall concern. A new risk that is already Red receives only the raised-risk entry; it does not also create a separate "became Red" entry during the same create operation.

Risk-generated entries use `source_type = risk`, retain the source risk UUID in `source_record_id`, and display the human-readable risk reference in `source_ref`. The entry title is concise, for example `Risk raised: Risk-HHH-003 — Supplier delay` or `Risk became Red: Risk-HHH-003 — Supplier delay`, with supporting metadata such as derived concern and lifecycle status. When a risk becomes Red, the reason is intentionally simple where available, such as Red exposure, missing owner/actioner, missing contingency plan, or overdue review date.

Routine edits do not populate Project Narrative. Description, owner, actioner, review date, due date, mitigation, contingency, ordinary status changes, Green to Amber transitions, Red staying Red, Red moving down, and risk comments remain on the Risk record unless the derived overall concern crosses from non-Red to Red. Project Narrative is therefore a project story and overview layer, not a general audit log.

The Project Narrative detail modal can show read-only current source-risk detail for risk-linked entries. It includes separate exposure, attention/assurance and overall concern signals using the shared RAG visual system, plus an Open full risk in new tab action. It does not allow risk editing. Owner, Admin and Member users still edit risks only through Risk Management; Viewer users can read available narrative entries and source-risk detail but cannot create or edit risks. No attention items, notifications, health scoring, AI summaries, issue creation, or full historical snapshot/replay are introduced by this slice.

## WT-RISK-LIFECYCLE-001 Risk lifecycle handling

Risks now have central lifecycle categories: Draft, Active and Closed. Draft maps to `draft`; Active maps to `open`, `monitoring`, `mitigating`, `escalated` and `materialised`; Closed maps to `closed`, with legacy `accepted` and `resolved` treated as closed compatibility values in helper logic. Reopened risks return to Active by moving back to `open`.

Only Active risks are active assurance records. Draft risks are visible preparation records and Closed risks are auditable historical records. Both can preserve probability, impact, owner, actioner, review date, due date, mitigation and contingency data, but neither drives the Risks dashboard tile, Projects page attention aggregation, active project attention or active assurance gaps. Risk exposure remains separate and visible; it is not erased by draft or closure.

The Risk Register page shows Active risks first, Draft risks below when present, and Closed risks last in a collapsed history section. Draft and Closed risk reference pills use neutral lifecycle treatment instead of derived Red/Amber/Green concern. Permitted users can open/publish Draft risks, close Active risks and reopen Closed risks through server-side `risk.edit` checks. Draft saves do not create Project Narrative entries. Opening/publishing, closing and reopening create source-linked Narrative entries, and close/reopen/open notes are captured in risk notes when supplied. Viewers can read lifecycle state and history but cannot trigger lifecycle changes.

## WT-002B implementation guidance

WT-002B should:

- Allow users to view a project detail page.
- Allow users to edit existing core fields.
- Preserve lightweight project creation.
- Avoid forcing all optional or health-significant fields immediately.
- Avoid implementing full Red/Amber/Green scoring yet.
- Avoid implementing dependency modelling yet.
- Keep workspace isolation and Row Level Security intact.

## WT-002B implemented foundation

WT-002B adds the first project detail and edit foundation without broadening the project schema. The project list links to project detail pages by the existing workspace-scoped `slug`. The detail page displays the project name, workspace context, status, health, created timestamp, updated timestamp, and a resolved creator display value only when the profile can be read safely.

Editable project fields are limited to the existing core fields `name` and `status`. The `status` field remains constrained to the existing values `proposed`, `active`, `paused`, `completed`, and `cancelled`. Health, slug, workspace/organisation ownership, creator identity, and timestamps are display-only or internal implementation fields and are not exposed as editable form fields.

Project creation remains lightweight. `created_by` continues to be populated automatically from the authenticated Supabase user when a project is created. The current schema does not include `updated_by`; WT-002B therefore does not add it and recommends a later small audit migration when the surrounding profile/audit display pattern is ready.

WT-002B does not implement Red/Amber/Green scoring, RAID tables, dependency modelling, programme/portfolio modelling, or additional optional project fields.

## WT-PROJ-DETAILS-001 Project Details and responsibility assignments

WT-PROJ-DETAILS-001 adds a workspace-safe Project Details page at `/app/workspaces/{workspaceSlug}/projects/{projectSlug}/details`. The project dashboard now links to this page as the controlled place to review project setup, context, responsibilities and system metadata; the dashboard remains a summary and capability navigation surface.

The Details page displays the current project schema fields: project name, project reference, workspace, status, health, route slug, internal project ID, description, created by, created at and updated at. Project reference, workspace, internal IDs, health and audit timestamps are read-only. Authorised workspace roles may update the existing safe fields `name`, `status` and `description` through server-side helpers that re-check workspace/project scope and central RBAC.

The project responsibility foundation stores assignments in `project_people`. Each assignment links one project role to either a real active workspace member (`organisation_members.user_id`, aligned with `profiles.id` / `auth.users.id`) or an active `workspace_demo_people` demo persona. Demo assignments remain visibly labelled as demo/persona records. Project roles describe accountability/context only and do not grant project edit rights or change workspace RBAC.

The following project date/governance fields remain follow-up schema candidates rather than part of this slice: start date, target end date, next review date, review cadence, governance route, escalation route and project-level `updated_by`.

## WT-PROJ-DETAILS-002 read-first layout and modal editing

WT-PROJ-DETAILS-002 refines Project Details into a read-first page. Users see project information in readable sections by default. Authorised edits for project identity, project description and project responsibility assignments open focused modals with explicit Save and Cancel actions. Read-only users retain full visibility of available information but do not see editable controls.

Project responsibility assignments are shown as cards. Six default empty slots guide setup: Sponsor, Project Manager, Delivery Lead, Product Owner, Assurance Lead and Default Risk Owner. Additional assigned roles appear after those defaults. The Add another team member modal lets permitted users select a real workspace member or active demo persona, choose a controlled project role and add responsibility text.

Removing an assignment marks the project responsibility inactive through the `project_people` status model. It does not delete the real workspace member, demo person, auth user or profile, and it does not grant or revoke workspace permissions.

## WT-PROJ-INFO-001 project information, dates and governance

WT-PROJ-INFO-001 adds the first controlled project setup fields to the existing `projects` table. Project Details now displays and, where permitted, edits project context, dates and governance information through modal forms.

Project context fields are `project_type`, `delivery_method`, `priority` and `criticality`. Date and governance fields are `start_date`, `target_end_date`, `next_review_date`, `review_cadence`, `governance_route` and `escalation_route`. Empty values display as `Not set`. Controlled values are constrained in both application validation and database checks, and free-text governance/escalation routes are trimmed and limited to 500 characters.

The date rules are intentionally simple: start date, target end date and next review date are optional, but target end date cannot be before start date when both are populated. These fields support project setup and future assurance; they do not create or edit Risks, Issues, Dependencies, Assumptions, Actions, Decisions or Project Narrative entries. Project reference, slug, workspace, internal ID, health and audit fields remain read-only on Project Details.

## WT-PROJ-DATES-001 project dates and timeline readiness

WT-PROJ-DATES-001 moves project milestones toward structured `project_dates` records. The Details page now presents Project dates as status cards rather than generic form fields, with default cards for Start date, Target end date and Review date. Additional dates can be added from a controlled list of seven date types: `start_date`, `target_end_date`, `review_date`, `uat`, `stage_gate`, `load_test` and `other`. When `other` is selected, `custom_label` is required.

Date status is derived in application code, not stored permanently. WT-PROJ-DATES-002 makes the alert window date-type aware: `start_date` uses 0 days and never becomes Red merely because the start date has passed; `target_end_date`, `stage_gate` and `other` use 14 days; `review_date` uses 2 days; `uat` and `load_test` use 7 days. Missing dates remain Amber. Overdue delivery, review, UAT, stage gate, load test and other dates become Red using type-specific wording where useful. A configurable warning period by project, team or governance profile remains future scope, although each record stores `warning_days` so future Timeline and assurance views can consume configurable values later.

`project_date_comments` stores context for one project date at a time. Comments preserve author and timestamp and do not change the date. Added/custom dates are removed by setting `removed_at`, so comments and audit context are preserved on the inactive record. Default date cards such as Start date, Target end date and Review date are permanent UI slots: clearing/removing one returns the card to `Not set` rather than removing the slot.

Governance route and escalation route remain project-level text fields on `projects`, with default contextual guidance shown when no saved text exists. Review cadence also remains on the project record. Project dates are intended to auto-populate the future Project Timeline capability; each active record carries workspace, project, type, display label, target date, warning window, audit fields and removal state.

For compatibility with WT-PROJ-INFO-001, the three legacy project date columns (`start_date`, `target_end_date`, `next_review_date`) are still selected and displayed as fallback values for default cards. Saving a structured default date mirrors the value back to the matching legacy column. A later consolidation should remove long-term duplication once all consumers read from `project_dates`.

Date edit authority is deliberately narrower than broad project detail editing. Owners and admins can maintain dates. Project Manager, Delivery Lead/Delivery Manager and Product Owner assignments can maintain dates where safely resolved from `project_people`. This assignment-based authority does not grant general project edit permission. Viewers, including simulated Viewer personas, remain unable to mutate project dates. The current database RLS remains workspace-writer oriented, so a future hardening task should add a dedicated database function for assignment-aware date mutation checks.

Project dates do not replace Risks, Issues, Dependencies, Assumptions, Actions, Decisions or Project Narrative. They are setup and timeline records only.

## WT-US-0202B system-generated fixed project references

Projects now have a dedicated `projects.project_ref` field for the user-facing project reference code. This is separate from `projects.slug`: the slug remains a URL-safe routing identifier only and must not be used as a delivery record reference.

Project references are short project codes rather than descriptive labels. Watchtower generates each new reference from the project name, shows the expected reference to the authorised creator as a fixed read-only preview, and independently derives the final value on the server. Users cannot supply, amend, or override a project reference during MVP. The stored reference is normalised to uppercase, must be 3-4 uppercase alphanumeric characters, and must start with a letter.

Project references are unique within a workspace/organisation, but the same reference may be reused in another workspace/organisation. If the preferred generated reference is already in use, Watchtower assigns a numeric-suffix alternative automatically rather than asking the user to resolve the collision. Project names are also unique within a workspace/organisation so that project lists and cross-project views remain unambiguous.

For MVP, `project_ref` is immutable after creation. The project edit page displays it read-only, but normal authenticated project update flows must not change it. A future admin-only override may be considered, but is deliberately outside this scope.

Future risk references will use the authoritative project reference in the compound format `Risk-{PROJECT_REF}-{NNN}`, for example `Risk-HHH-003`. Existing early projects that do not yet have a valid project reference should be assigned one through a controlled future process or recreated before Risk records can be created against them.

The authenticated project list displays `project_ref` with the shared reference-pill treatment as a project action-state indicator. This action state is separate from the Health column: Red/Amber/Green on the project reference means unresolved action signals, not overall delivery health. Until a formal health model exists, the Health column remains Unknown. WT-SIGNAL-CONSISTENCY-001 changes the action-state calculation from risk-led to project-area aggregation. The current included areas are Project Details and Risks: Project Details contributes setup/date/responsibility action state, and Risks contributes active risk assurance action state while excluding Draft and Closed risks. Narrative unseen-entry state remains user-specific and is not included in Projects page aggregation in this slice. Issues, Dependencies, Assumptions, Actions and Decisions are future action-state sources. Project names are the primary workspace-scoped dashboard links, and the former Action column is removed. Create-project affordances remain governed by workspace role and `organisation_settings.allow_member_project_creation`; read-only users see an unavailable action with explanatory copy rather than a working create link.

WT-DASH-TILE-SIGNALS-001 introduces reusable project dashboard tile signals without changing Project Health. Project Details uses existing setup, governance/escalation, responsibility and project-date fields, including structured project-date status cards plus legacy fallback date values. WT-SIGNAL-CONSISTENCY-001 extends that helper into a reusable project-area signal model with reasons so the Project Details dashboard tile, Project Details page action-state panel and project-list action state use the same underlying Red/Amber drivers. WT-PROJ-DETAILS-SIGNALS-001 refines the helper again so Project Details first derives section-level action states for Project Identity, Description, Context, Dates, Governance/Escalation, Roles/Responsibilities and System Metadata; the page-level Project Details state is aggregated from those section states. The top Project Details action-state panel lists only section-owned Red/Amber reasons. Each Project Details section shows a compact section marker and subtle state accent rather than a full internal rationale banner; complete expected sections visibly show Green, while System Metadata is normally Neutral/informational. Project Dates relies on the individual date cards for visible date-level reasons and rolls up from current child card states: Red if any visible child card is Red, Amber if no child is Red and any child is Amber, Green when all visible cards are Green, and Unknown only when date state cannot be calculated safely. The current Project Details field criticality is MVP-light and hardcoded: missing description is Red; missing context, governance/escalation, Product Owner/Default Risk Owner assignment or approaching/missing date warnings are Amber; overdue non-start date cards are Red because the date card itself is Red. A future governance/assessment profile model may replace those static rules. Project Narrative is user-specific through unseen-entry/read-state data: Green means no unseen entries, Amber means 1-3 unseen entries, Red means 4 or more unseen entries, and Unknown means read-state cannot be calculated safely. If no read-state exists for the current user/project, all existing Narrative entries count as unseen. Opening the Project Narrative page updates the current user's read-state; dashboard rendering does not. The Risks tile uses action/assurance gaps such as missing owner/actioner, overdue review, missing response evidence or stale updates; it does not use raw exposure alone, and managed high-exposure risks can produce a Green tile. Dashboard capability blue availability styling remains separate from project health and tile action state. Timeline, Issues, Dependencies, Assumptions, Decisions and Actions remain neutral/unknown/disabled until their own status models exist.

## WT-US-0205 workspace-safe project routing

Project slugs are unique only within a workspace, so project destinations include both readable routing slugs:

- `/app/workspaces/{workspaceSlug}/projects/{projectSlug}`
- `/app/workspaces/{workspaceSlug}/projects/{projectSlug}/edit`
- `/app/workspaces/{workspaceSlug}/projects/{projectSlug}/risks`
- `/app/workspaces/{workspaceSlug}/projects/{projectSlug}/risks/new`
- `/app/workspaces/{workspaceSlug}/projects/{projectSlug}/risks/{riskId}`
- `/app/workspaces/{workspaceSlug}/projects/{projectSlug}/risks/{riskId}/edit`

Every scoped page first requires an active membership in the workspace identified by `organisations.slug`, then resolves the active project using both `projects.organisation_id` and `projects.slug`. Deleted and archived projects remain unavailable. This keeps copied links and bookmarks pinned to the intended workspace without exposing organisation or project UUIDs. RBAC remains unchanged: Viewers can open the dashboard and an available Risk Management preview, but cannot edit project details or create/edit risks.

`/app/projects/{projectSlug}` and its former edit and Risks variants remain transitional compatibility routes. They search only projects visible through the signed-in user's active memberships. One accessible match redirects to the corresponding workspace-scoped URL, multiple accessible matches show a workspace choice instead of selecting silently, and no match returns the same not-found/no-access response without revealing inaccessible project existence. New app-generated project links do not use these transitional routes.

## WT-RISK-002A Risk Register foundation

WT-RISK-002A makes Risk Management available as a project-scoped, read-only register and detail foundation. The Risk tile on the project dashboard routes to `/app/workspaces/{workspaceSlug}/projects/{projectSlug}/risks` when the `riskManagement` feature flag and workspace RBAC allow access.

The register and detail route both preserve workspace-safe routing: the route workspace is resolved first, the project is then resolved by `organisation_id` and project slug, and risk records are fetched by both `organisation_id` and `project_id`. A single-risk detail page returns not found/no access if the requested `risk_id` does not belong to that selected project and workspace.

In WT-RISK-002A, Viewer users could read the Risk Register and detail pages while all write controls remained disabled; create/edit was deliberately left for WT-RISK-002B. WT-RISK-002A does not implement risk notes/replies, Risk-to-Narrative integration, attention items, notifications, digest behaviour or dashboard risk roll-ups.

## WT-RISK-002B Risk create/edit flow

WT-RISK-002B adds project-scoped risk creation at `/app/workspaces/{workspaceSlug}/projects/{projectSlug}/risks/new` and risk editing at `/app/workspaces/{workspaceSlug}/projects/{projectSlug}/risks/{riskId}/edit`. The register New Risk action and detail Edit Risk action are active for Owner, Admin and Member roles. Viewer users continue to see read-only risk pages with disabled write actions and explanatory helper text.

Create and edit actions re-check the route workspace, project, feature flag and central `risk.create`/`risk.edit` permissions server-side. Create derives `organisation_id`, `project_id`, `risk_sequence` and `risk_ref` from the resolved workspace/project rather than trusting form data. Edit fetches the target risk by `organisation_id`, `project_id` and `risk_id`, so copied or altered URLs cannot move risk records across projects or workspaces.

The form captures title, description, lifecycle status, probability, impact, owner, actioner, review date, due date, mitigation plan and contingency plan. `owner_id` and `actioner_id` may be assigned only to active workspace members. `actioner_id` is the single primary actioner for this MVP slice: the person responsible for carrying out mitigation, contingency, review or follow-up activity, while the risk owner remains accountable for managing the risk. Risk references remain system-generated in `Risk-{PROJECT_REF}-{NNN}` format and read-only. From WT-RISK-005, users no longer manually declare the final concern/RAG in create or edit flows; the app derives it from exposure plus assurance.

WT-RISK-002B does not implement risk delete, notes/replies, Risk-to-Narrative integration, attention items, notifications, digest behaviour, dashboard roll-ups or health scoring.

## WT-RISK-002C Risk register cleanup and assurance blocks

WT-RISK-002C simplifies the Risk Register table to keep it stakeholder-readable: Ref, Risk, Status, Review date and Updated. The separate RAG, Owner and Actioner columns are removed from the register, and the Risk column shows title only. The risk reference pill remains the compact visual indicator, while detailed ownership and action quality now live on the risk detail page.

The risk detail page becomes an assurance view. It still displays the source-of-truth record, but key sections are shown as block-level quality signals with accessible Green, Amber, Red or Unknown labels. The MVP-derived blocks cover summary, lifecycle status, exposure, risk owner, action responsibility, review cadence, due date, mitigation plan, contingency plan and latest update. In WT-RISK-004 each block becomes an action entry point: permitted users open a focused modal for the relevant fields, while Viewers see the same concerns as read-only guidance.

These indicators are deliberately simple derived checks over existing fields. WT-RISK-005 stops treating manual RAG as user-owned truth: `project_risks.rag_status` remains only legacy/transitional compatibility storage, while exposure, assurance and overall concern are derived by the application. This does not create a Governance Profile / Assessment Profile engine, alter project health, generate attention items or create notifications.

## WT-RISK-003 Risk actioner assignment foundation

WT-RISK-003 adds nullable `project_risks.actioner_id` as a profile-backed primary actioner assignment. The create and edit forms use the same active workspace member option list as risk ownership, so an actioner cannot be selected from another workspace through the application flow. Owner, Admin and Member roles may assign, change or clear the actioner; Viewer users can see the actioner and assurance state but cannot edit it.

The Risk Register remains clean and still shows only Ref, Risk, Status, Review date and Updated. The risk detail action responsibility block now displays the assigned actioner when present. WT-RISK-004 tightens the assurance default so missing required action responsibility is Red, while closed risks without an actioner remain Neutral. WT-RISK-003 does not introduce notes, Project Narrative integration, attention items, notifications, health scoring, multiple actioners, action approval workflow or a separate Actions module.

## WT-RISK-004 Risk detail actionable assurance UX

WT-RISK-004 cleans up the single-risk detail page by moving Back to Risk Register and Back to project navigation near the top, removing duplicate "Risk assurance view" wording, reducing duplicated status/owner summary data, and keeping the main content focused on what needs attention.

Each assurance card opens a focused edit modal for its field group rather than sending the user to one large edit surface. Summary edits title and description; lifecycle edits status; exposure edits probability and impact; ownership edits owner; action responsibility edits actioner; cadence and due-date cards edit their dates; plan cards edit mitigation or contingency text. The modal forms submit through the existing scoped edit route, so WT-RISK-004 does not add a parallel risk mutation path.

WT-RISK-004 also exposes top-level `project_risk_notes` as Comments at the bottom of the detail page. Comments are shown newest first with author and timestamp, and Owner, Admin and Member roles can add a new top-level comment. Replies/threading UI, attention item creation, notifications, comment-to-Narrative integration, digests and comment-to-action workflows remain deferred.

## WT-RISK-004A Risk detail information architecture refinement

WT-RISK-004A refines the same detail page structure without changing the risk model. The risk reference remains the primary page heading but uses the concern/RAG pill treatment at hero-heading scale. The Current risk panel becomes a compact summary strip for concern, lifecycle status, owner and audit metadata rather than a second set of large detail cards.

The main editable assurance area is named Core Risk Detail. Assurance cards remain focused modal entry points, and their native dialog backdrop uses a dark blurred overlay so the active edit task is visually foregrounded. Comments now sit at the bottom of Core Risk Detail instead of in a separate large block, keeping the page ready for a future Custom Fields section below Comments without implementing custom fields in this slice.

## WT-RISK-004B Risk detail MVP polish

WT-RISK-004B keeps the WT-RISK-004A structure but tightens MVP readability. The hero risk-reference pill remains large but uses a more readable size and spacing. The Current risk summary removes duplicated concern and owner content, removes the "Actionable assurance" status pill, and keeps only lifecycle status, created by, updated by and the single Updated timestamp. Top and bottom back navigation use the same secondary button treatment. Modal cancel actions use the Watchtower dark UI treatment with stronger contrast.

## WT-RISK-005 Derived risk concern model

WT-RISK-005 introduces a derived risk concern model. Lifecycle status remains the workflow state. Exposure is derived from probability and impact. Assurance is derived from missing or weak governance/control data. Overall concern is derived from exposure plus assurance overrides and is shown in the header and register reference pills.

Manual concern/RAG selection is removed from user-facing create, edit and focused exposure modal flows where safe. The database `rag_status` column is retained as a legacy/transitional compatibility value until a deliberate migration strategy replaces it. The app may write a derived value there for compatibility, but it is no longer treated as the user-owned source of truth.

Owner/actioner inactivity assurance remains future-ready only. The schema includes `profiles.last_login_at`, but current login auditing records events through `record_auth_audit_event` and does not reliably maintain that timestamp. Temporary actioner handover/delegation is also future scope and will need temporary actioner, handover reason, start date, end date, assigned by and original actioner fields. Full configurable Governance Profile / Assessment Profile scoring remains future scope.

WT-RISK-NARRATIVE-001 depends on this derived concern model for the "risk became Red" trigger. It does not use the legacy stored `rag_status` value as a user-selected trigger source.

## Feature-gated project capabilities

WT-US-0107 applies the central `riskManagement` feature flag to the Risks dashboard tile and direct Risk Management routes. `hidden` removes the tile, `disabled` keeps it visible but inactive, `preview` allows only approved preview accounts, and `enabled` releases it generally. All states remain subject to active workspace membership and RBAC; Viewer access remains read-only when the capability is available. WT-RISK-002B, WT-RISK-002C, WT-RISK-003, WT-RISK-004, WT-RISK-004A, WT-RISK-004B and WT-RISK-005 keep the same feature-gate model while adding create/edit behaviour, assurance view improvements, primary actioner assignment, actionable detail modals, comments, refined detail-page information architecture and derived concern display for permitted roles.

WT-US-0207 adds **Project Narrative** near the start of the dashboard capability tiles. Project Narrative is the user-facing project event, update, decision and history layer: it explains what happened, what changed and why it matters. It remains distinct from **Timeline**, which represents dates, milestones and key project stages.

Project Narrative uses the existing internal `projectDiary` feature key. The dashboard applies the same `hidden`, `disabled`, `preview` and `enabled` access model to all feature-gated tiles rather than treating Risk Management as a one-off. WT-NARRATIVE-001 adds the guarded canonical destination at `/app/workspaces/{workspaceSlug}/projects/{projectSlug}/narrative`; an accessible tile now links there. The page lists scoped entries newest first using Ref, Details, Created by, and Created columns. Ref carries the visible RAG/attention pill, internal entry numbers are not shown, and no Type column is added. Risk Management routing and RBAC behaviour are unchanged.

## WT-US-0209 universal project page layout

WT-US-0209 defines the reusable authenticated project-page layout standard in `docs/ui-page-design-standard.md`. Project-level pages should follow the shared structure of global authenticated navigation, project hero/context panel, optional control/filter/status panel, main content panel, table/list/card content, empty state, and restricted-action state.

Primary page-level actions should live in the main content panel header, normally top-right on desktop and above content on mobile. Secondary actions belong in local card, row, modal, detail, or supporting action groups. Viewer users and disabled feature states must retain visible but non-interactive actions only when useful, with clear helper text and no permission expansion.

Lightweight reusable components now exist for shared project hero, control panel, content panel, disabled-action helper, empty state, and RAG/reference pills. Project Narrative established the reference implementation, and the project dashboard now uses the same shared shell for its project hero, status summary, capability hub, and read-only detail panels while preserving dashboard tile gating.
