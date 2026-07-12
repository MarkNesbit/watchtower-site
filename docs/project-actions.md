# Project Actions

**Status:** WT-ACTION-001A schema, references, RLS baseline and immutable history foundation

**Migration:** `20260712000200_project_actions_schema_foundation.sql`

**Scope:** Database schema, project-scoped Action references, baseline read RLS, Action permission names, pure helper types, and immutable workflow history.

## Purpose

Project Actions are authoritative project-level assurance records. An Action may be displayed from a register, Risk context, the Project Dashboard, or later Project Details and Narrative contexts, but it is stored once in `project_actions`.

WT-ACTION-001A does not implement Action screens, creation forms, workflow transitions, dashboard signals, personal queues, Risk integration, Narrative generation, Project Details entry points, health scoring, attachments, notifications, recurrence, dependencies, sub-actions or general comments.

## Data Model

`project_action_counters` stores one internal counter per project:

- `project_id`
- `organisation_id`
- `last_action_number`
- created and updated timestamps

Authenticated clients have no direct grants on this table. It is used by the Action insert trigger to allocate references atomically.

`project_actions` stores one authoritative Action record:

- internal UUID `id`
- `organisation_id` and `project_id`
- immutable `action_number` and `action_ref`
- mandatory `brief`
- mandatory `due_date`
- current workflow `status`
- mandatory `raiser_id`
- optional `actioner_id`
- mandatory `acceptance_owner_id`
- optional source metadata
- latest response/evidence URL fields for future workflow display
- submitted, completed and cancelled timestamps
- created/updated audit fields

MVP does not include `archived_at` or `deleted_at` for Actions. There is no delete or archive behavior in this slice.

`project_action_history` stores immutable structured workflow history:

- `action_id`
- event type
- actor
- from/to status
- reason
- response
- optional evidence URL
- typed JSON before/after values
- timestamp

History is not a comment thread. Authenticated users have no update or delete grants, and a trigger rejects non-service-role update/delete attempts for defense in depth.

## References

Action references are generated in the database from the owning project's `project_ref`.

Format:

```text
Action-{PROJECT_REF}-{NNN}
```

Examples:

```text
Action-HHH-001
Action-HHH-012
```

The migration follows the Project Narrative counter pattern rather than the Risk retry pattern. The insert trigger upserts the project's counter row, increments it under row lock, and assigns `action_number` and `action_ref` before constraints are checked.

## Statuses

Stored statuses are:

- `open`
- `submitted`
- `returned_to_raiser`
- `rejected_by_actioner`
- `returned_to_actioner`
- `complete`
- `cancelled`

Display labels are centralised in `src/lib/projectActions.ts`. In particular, `submitted` displays as `Awaiting raiser review`.

## Source Types

WT-ACTION-001A allows only the locked MVP source types:

- `project`
- `risk`
- `project_details`
- `narrative`

Future Issue, Dependency, Assumption or Decision source types should be added only when those authoritative modules exist.

## Permissions and RLS

The Action permission names are:

- `action.view`
- `action.create`
- `action.respond`
- `action.review`
- `action.manage`
- `action.takeover`

Viewer receives `action.view` only. Owner and Admin receive all Action permissions. Member receives normal non-takeover Action capabilities but not `action.takeover`, because MVP acceptance-owner takeover is restricted to Owner/Admin.

Database RLS in this slice permits active workspace members to read Actions and Action history for their workspace. Authenticated users receive select grants only. Direct authenticated insert, update and delete grants are not introduced in WT-ACTION-001A; detailed creation and transition enforcement is deferred to WT-ACTION-001B.

## URL and JSON Validation

Action and history evidence URLs must be null or use `http://` or `https://`.

`source_context`, `old_values` and `new_values` must be JSON objects when present. This keeps future source context and before/after history structured without introducing generic task-management fields.

## Deferred to WT-ACTION-001B

WT-ACTION-001B should add the controlled create and transition path, including:

- active Owner/Admin/Member assignment validation;
- Viewer exclusion from Actioner selection;
- transactional status updates;
- history insertion with each material transition;
- actioner-only Submit/Return/Reject enforcement;
- raiser/current acceptance-owner review enforcement;
- Owner/Admin acceptance-owner takeover with reason.

