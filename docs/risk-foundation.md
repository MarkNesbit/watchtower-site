# Watchtower Risk Foundation

**Status:** WT-RISK-001 schema foundation  
**Scope:** Database, Row Level Security, constraints, indexes, and migration tests only

## Purpose

The risk foundation introduces the minimum database model needed for project-scoped risk management while preserving Watchtower's workspace isolation model. It does not introduce the full Risk user interface, dashboard roll-ups, email notification delivery, action approval, AI scoring, or non-risk RAID tables.

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

Existing projects are not automatically given meaningful references by the migration. The field is nullable to avoid breaking current lightweight project creation flows until a future UI or project editing slice supports explicit project reference management.

## Risk ownership and future actioners

`project_risks.owner_id` means the accountable risk owner: the person responsible for managing and reviewing the risk.

Actioners are intentionally separate from owners. Actioners are people responsible for specific mitigation, contingency, review, or follow-up actions. They will be handled later through a separate `project_risk_actions` table.

A risk raiser may propose themselves as an actioner in a later slice, but the risk owner should be able to approve, replace, or reassign that actioner. `project_risk_actions` is future scope and is not built in WT-RISK-001.

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

## Attention levels and notification future scope

Risk notes and replies include `attention_level` values:

- `green` = routine/informational;
- `amber` = needs awareness/review;
- `red` = urgent/rapid interaction likely required.

Future notification rules are expected to be:

- red note/reply = immediate email to the risk owner;
- amber/green note/reply = daily risk owner digest.

Notification delivery, notification event tables, email sending, and daily digest generation are future scope and are not implemented in WT-RISK-001.

## Dashboard and RAID future scope

The project dashboard Risk tile remains a navigation/signal placeholder in this foundation slice. It is not connected to live `project_risks` data.

The following are also future scope and are not created by this foundation:

- Assumptions tables;
- Issues tables;
- Dependencies tables;
- Decisions tables;
- Actions tables;
- Timeline or milestone tables;
- automatic RAG scoring or AI scoring.

## Project reference dependency for future Risk creation

Future Risk creation must use `projects.project_ref` as the authoritative project code in references such as `Risk-{PROJECT_REF}-{NNN}`. The project slug is routing-only and must not be used in risk references.

From WT-US-0202A onward, new projects receive a 3-4 character uppercase `project_ref` at creation time. The reference is unique within the workspace/organisation and immutable after creation for MVP. The same project reference may exist in another workspace/organisation.

Existing early projects without a valid `project_ref` need a controlled assignment or recreation before Risk records can be created for them. Risk creation should be blocked for projects where `project_ref` is missing or invalid.
