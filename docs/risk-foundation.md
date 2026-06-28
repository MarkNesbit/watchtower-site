# Watchtower Risk Foundation

**Status:** WT-RISK-002B create/edit flow
**Scope:** Database, Row Level Security, constraints, indexes, migration tests, Risk Register, risk detail, risk create and risk edit pages

## Purpose

The risk foundation introduces the minimum database model needed for project-scoped risk management while preserving Watchtower's workspace isolation model. WT-RISK-002A added the first Risk Management UI surface for existing risk records; WT-RISK-002B adds create and edit flows for permitted workspace roles. It does not introduce risk delete, dashboard roll-ups, risk notes/replies, Risk-to-Diary integration, attention item generation, email notification delivery, action approval, health scoring, AI scoring, or non-risk RAID tables.

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

## Risk ownership and future actioners

`project_risks.owner_id` means the accountable risk owner: the person responsible for managing and reviewing the risk.

Actioners are intentionally separate from owners. Actioners are people responsible for specific mitigation, contingency, review, or follow-up actions. They will be handled later through a separate `project_risk_actions` table.

A risk raiser may propose themselves as an actioner in a later slice, but the risk owner should be able to approve, replace, or reassign that actioner. `project_risk_actions` is future scope and is not built in WT-RISK-001.

WT-RISK-002B continues to show an actioner fallback of `Unassigned` rather than storing or editing an actioner on the risk record.

## Risk fields

The foundation supports:

- project and workspace scoping through `project_id` and `organisation_id`;
- internal UUID relationships through `risk_id`;
- human-readable references through `risk_ref` and `risk_sequence`;
- status values: `open`, `monitoring`, `mitigating`, `accepted`, `closed`;
- probability values: `low`, `medium`, `high`;
- impact values: `low`, `medium`, `high`;
- RAG status values: `blue`, `green`, `amber`, `red`;
- owner accountability through `owner_id`;
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

WT-NARRATIVE-002 adds `project_narrative_entries` with source metadata ready for a later Risk-to-Narrative workflow. That foundation does not generate Narrative entries from Risks and does not change Risk behaviour.

When the integration is implemented, a Narrative entry may retain the authoritative `project_risks.risk_id` as `source_record_id` and a display value such as `Risk-HHH-003` as `source_ref`. Its own `NAR-{PROJECT_REF}-{NNN}` identity is still retained. The Risk record remains the source of truth and must be edited in Risk Management rather than through Project Narrative.

## Dashboard and RAID future scope

The project dashboard Risk tile routes to the project Risk Register when Risk Management is available. The dashboard remains simple and is not connected to live `project_risks` data, roll-ups, counts or summaries in WT-RISK-002B.

The following are also future scope and are not created by this foundation:

- Assumptions tables;
- Issues tables;
- Dependencies tables;
- Decisions tables;
- Actions tables;
- Timeline or milestone tables;
- automatic RAG scoring or AI scoring.

## WT-RISK-002A Risk Register and WT-RISK-002B create/edit

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

The Risk Register displays MVP fields where available: risk reference, title/summary, RAG, status, owner, actioner fallback, review date and last updated timestamp. Missing owner, actioner and review date values render as clear fallbacks. The detail page displays the same source-of-truth risk record, including description, probability/impact exposure, plans and audit metadata where available.

Owner, Admin and Member roles may create and edit risks when the `riskManagement` feature flag permits access. Create captures title, description, status, RAG, owner and review date, then generates the next project-scoped reference in `Risk-{PROJECT_REF}-{NNN}` format. Edit allows those same MVP fields to be updated while preserving immutable scope and creation fields. The database audit trigger binds `created_by` and `updated_by` to the authenticated user.

All active workspace roles, including Viewer, may read available risk pages when the `riskManagement` feature flag permits access. Viewer users cannot create or edit risks and see disabled write actions with read-only helper text. No role can delete risks, add notes, trigger Diary integration, generate attention items, send notifications or change health scoring from WT-RISK-002B.

## Project relationship ambiguity readiness

WT-US-0208 adds `project_relationships` as a separate project model foundation. A relationship whose type is `relates_to` is intentionally non-specific and should later be considered by project health/risk evaluation as a possible ambiguity signal: the relationship exists, but its dependency or enabling meaning is unclear.

This signal does not create a `project_risks` record, change RAG status, or alter health scoring in WT-US-0208. Any later conversion into a managed risk must be an explicit product and audit workflow rather than an automatic side effect of storing the relationship.

## Project reference dependency for Risk creation

Risk creation uses `projects.project_ref` as the authoritative project code in references such as `Risk-{PROJECT_REF}-{NNN}`. The project slug is routing-only and must not be used in risk references.

From WT-US-0202B onward, Watchtower generates a 3-4 character uppercase `project_ref` from the project name, resolves workspace/organisation collisions automatically, and fixes the reference at creation time. Users cannot edit or override it during MVP; a future admin-only override is outside the current scope. The same project reference may exist in another workspace/organisation.

Existing early projects without a valid `project_ref` need a controlled assignment or recreation before Risk records can be created for them. Risk creation is blocked for projects where `project_ref` is missing or invalid.
