# Watchtower Risk Foundation

**Status:** WT-RISK-NARRATIVE-001 risk-to-narrative event integration
**Scope:** Database, Row Level Security, constraints, indexes, migration tests, Risk Register, risk assurance detail, risk create and risk edit pages

## Purpose

The risk foundation introduces the minimum database model needed for project-scoped risk management while preserving Watchtower's workspace isolation model. WT-RISK-002A added the first Risk Management UI surface for existing risk records, WT-RISK-002B added create/edit flows for permitted workspace roles, WT-RISK-002C simplifies the register while introducing block-level assurance signals on the detail page, WT-RISK-003 adds a nullable primary actioner assignment on the risk record, WT-RISK-004 adds focused edit modals and comments, WT-RISK-004A/004B polish the detail information architecture, WT-RISK-005 derives overall concern from exposure plus assurance, and WT-RISK-NARRATIVE-001 creates Project Narrative entries only for raised risks and existing risks that become Red. It does not introduce risk delete, dashboard roll-ups, risk replies, risk comment-to-narrative integration, attention item generation, email notification delivery, action approval, health scoring, configurable governance scoring, AI scoring, multiple actioners, a separate Actions module, temporary handover/delegation, or non-risk RAID tables.

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
- status values: `open`, `monitoring`, `mitigating`, `accepted`, `closed`;
- probability values: `low`, `medium`, `high`;
- impact values: `low`, `medium`, `high`;
- transitional RAG/concern values: `blue`, `green`, `amber`, `red`;
- owner accountability through `owner_id`;
- primary actioner responsibility through nullable `actioner_id`;
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

The integration is intentionally narrow. It creates one entry when a risk is raised and one entry when an existing risk's derived overall concern changes from non-Red to Red. It does not create entries for every edit, comments, owner/actioner/review-date-only changes, Green to Amber movement, Red staying Red, or Red moving down. The "became Red" trigger uses the WT-RISK-005 derived overall concern, not a manually selected or legacy stored RAG value.

## Dashboard and RAID future scope

The project dashboard Risk tile routes to the project Risk Register when Risk Management is available. WT-DASH-RISK-001 and WT-DASH-TILE-SIGNALS-001 make the tile a compact attention/assurance signal without turning it into a count, badge or notification surface. The tile uses active risk management gaps rather than raw exposure: a high-exposure risk does not automatically make the tile Red if owner, action responsibility, mitigation/response, contingency and review cadence are current. Risk exposure remains visible in the Risk Register and Risk Detail views.

WT-SIGNAL-CONSISTENCY-001 reuses that same Risk attention/assurance signal for project-list attention aggregation. Risks can contribute Amber or Red project attention when active risks have unresolved assurance gaps, but raw exposure alone still does not drive project attention or Project Health.

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

The WT-RISK-002C Risk Register displays a concise table: Ref, Risk, Status, Review date and Updated. The Risk column shows the title only, not the description. The separate RAG, Owner and Actioner columns are intentionally removed from the primary register table. From WT-RISK-005, the risk reference pill uses the derived overall concern rather than the stored legacy `rag_status` value, while detailed quality and ownership concerns are handled on the risk detail page.

The risk detail page is now an actionable assurance view focused on what needs attention. It displays simple Green, Amber, Red and Unknown indicators for summary, lifecycle status, exposure, owner, action responsibility, review cadence, due date, mitigation plan, contingency plan and latest update. Each editable assurance card opens a focused edit modal for the relevant source-of-truth fields and posts through the existing scoped edit route. These are MVP-derived quality signals from existing fields. Probability and impact derive exposure: Low/Low is Green, Medium/High, High/Medium and High/High are Red, other valid combinations are Amber, and missing or unknown exposure data is Red. Missing owner, required action responsibility, contingency plan, Materialised status, and unresolved Escalated status are Red; missing review date or due date is Amber; overdue review date is Red; missing mitigation is Red for Red exposure, Amber for Amber exposure, and Green for Green exposure in this MVP. Closed risks without an actioner remain Neutral. These signals are not the final Governance Profile / Assessment Profile engine and do not alter project health or create attention/notification side effects.

Owner, Admin and Member roles may create and edit risks when the `riskManagement` feature flag permits access. Create captures title, description, lifecycle status, probability, impact, owner, actioner, review date, due date, mitigation plan and contingency plan, then generates the next project-scoped reference in `Risk-{PROJECT_REF}-{NNN}` format. Edit allows those same editable fields to be updated while preserving immutable scope and creation fields. The database audit trigger binds `created_by` and `updated_by` to the authenticated user. The `project_risks.rag_status` column remains as legacy/transitional compatibility storage, but user-facing flows no longer treat it as a manually declared source of truth.

The detail page also exposes top-level `project_risk_notes` as Comments. Comments are listed newest first with author and timestamp. Owner, Admin and Member roles can add a comment; Viewer users can read comments but cannot add them. WT-RISK-004 and WT-RISK-NARRATIVE-001 do not add replies/threading UI, comment-generated Narrative entries, attention item creation, notifications or comment-to-action workflows.

WT-RISK-004A refines the detail page information architecture. The hero heading renders the risk reference with the concern/RAG pill treatment, the Current risk panel carries a compact audit summary strip, and the main assurance area is named Core Risk Detail. Comments now live at the bottom of Core Risk Detail rather than in a separate content block. Focused edit modals retain the native dialog accessibility model and use a dark blurred backdrop to keep the active edit task foregrounded. WT-RISK-004B keeps that structure but removes duplicated concern and owner data from the summary strip, removes the "Actionable assurance" status pill, keeps only the Updated timestamp as the summary date, aligns top and bottom back navigation styling, and improves modal cancel contrast.

WT-RISK-005 separates lifecycle status, exposure, assurance and overall concern. Users update structured facts, Watchtower derives exposure from probability and impact, derives assurance from governance/control quality signals, and derives the overall concern shown in the risk reference pill from exposure plus assurance overrides. Owner/actioner inactivity rules are documented as future-ready because `profiles.last_login_at` is available in the schema but the current `record_auth_audit_event('user.logged_in')` flow does not reliably maintain it. Temporary actioner handover/delegation also remains future scope and will need temporary actioner, handover reason, start date, end date, assigned by and original actioner fields.

All active workspace roles, including Viewer, may read available risk pages when the `riskManagement` feature flag permits access. Viewer users cannot create or edit risks and see disabled write actions or read-only action prompts. Viewers can read risk-generated Narrative entries and inspect the read-only current source-risk detail modal where Project Narrative is available, but they cannot edit the source risk from the Narrative modal. The modal uses the existing workspace-safe Risk Detail route for its Open full risk in new tab action and keeps exposure, attention/assurance and overall concern distinct. No role can delete risks, create Narrative entries for routine risk edits or comments, generate attention items, send notifications, change health scoring, invoke AI behaviour or manage a separate Actions module from WT-RISK-NARRATIVE-001.

## Project relationship ambiguity readiness

WT-US-0208 adds `project_relationships` as a separate project model foundation. A relationship whose type is `relates_to` is intentionally non-specific and should later be considered by project health/risk evaluation as a possible ambiguity signal: the relationship exists, but its dependency or enabling meaning is unclear.

This signal does not create a `project_risks` record, change RAG status, or alter health scoring in WT-US-0208. Any later conversion into a managed risk must be an explicit product and audit workflow rather than an automatic side effect of storing the relationship.

## Project reference dependency for Risk creation

Risk creation uses `projects.project_ref` as the authoritative project code in references such as `Risk-{PROJECT_REF}-{NNN}`. The project slug is routing-only and must not be used in risk references.

From WT-US-0202B onward, Watchtower generates a 3-4 character uppercase `project_ref` from the project name, resolves workspace/organisation collisions automatically, and fixes the reference at creation time. Users cannot edit or override it during MVP; a future admin-only override is outside the current scope. The same project reference may exist in another workspace/organisation.

Existing early projects without a valid `project_ref` need a controlled assignment or recreation before Risk records can be created for them. Risk creation is blocked for projects where `project_ref` is missing or invalid.
