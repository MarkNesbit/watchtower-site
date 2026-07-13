# Project Actions

**Status:** WT-ACTION-002 Actions Register, creation and detail experience

**Migrations:**

- `20260712000200_project_actions_schema_foundation.sql`
- `20260712000300_project_actions_transactional_lifecycle.sql`

**Scope:** Database schema, project-scoped Action references, baseline read RLS, Action permission names, pure helper types, immutable workflow history, controlled transactional lifecycle RPCs, TypeScript wrappers, project Actions Register, direct project Action creation and Action detail/history pages.

## Purpose

Project Actions are authoritative project-level assurance records. An Action may be displayed from the Actions Register, Risk context, the Project Dashboard, or later Project Details and Narrative contexts, but it is stored once in `project_actions`.

WT-ACTION-002 introduces the first authenticated Actions interface. It does not implement the complete Actioner response journey, Risk-context creation, Project Details creation, Narrative generation, personal queues, health scoring, attachments, notifications, recurrence, dependencies, sub-actions or general comments.

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

## Routes and Navigation

The workspace-safe Actions route is:

```text
/app/workspaces/{workspaceSlug}/projects/{projectSlug}/actions
```

Action detail pages use:

```text
/app/workspaces/{workspaceSlug}/projects/{projectSlug}/actions/{actionId}
```

Legacy `/app/projects/{projectSlug}/actions` routes redirect only when the project slug resolves to one accessible workspace. The Project Dashboard Actions tile now opens the workspace-safe Actions Register.

## Actions Register

The register follows the Risk Register visual pattern: project hero, summary cards, tabs, compact filters, table-led register, pagination, right-side support panels, guidance text and a Back to project link.

Tabs are:

- Outstanding: `open`, `returned_to_raiser`, `rejected_by_actioner`, `returned_to_actioner`
- Awaiting review: `submitted`
- Complete: `complete`
- Cancelled: `cancelled`
- All: every status

The default tab is Outstanding and selected tab/filter/page state is stored in the query string.

Search covers Action reference, brief, Actioner name and raiser name. Filters cover timing, workflow status, Actioner and raiser. Sorting supports urgency, due date, updated date, Action reference and Actioner. Source information is kept on Action detail pages rather than shown on the project-level register.

Summary cards are project-level and unaffected by table filters:

- Open Actions: non-terminal Actions.
- Need Action: Actions requiring intervention.
- Highest urgency: the most urgent current timing state across open Actions.

The Needs Action panel is also project-level and prioritises overdue, due today, reassignment required, rejected, returned to raiser, unassigned, awaiting review, due soon and missing due date items. The Action distribution panel shows Open, Awaiting review, Complete and Cancelled counts and is not a health indicator.

## Timing Rules

Timing state is derived separately from workflow status:

- `complete`: Green.
- `cancelled`: Grey.
- `overdue`: Red.
- `due_today`: Red.
- `missing_due_date`: Amber when no due date is set.
- `reassignment_required`: Amber.
- `unassigned`: Amber.
- `due_soon`: Amber when due within three calendar days.
- `open`: Blue/neutral.

Ordinary open Actions are not shown as Green simply because they are not near their due date.

If an assigned Actioner later becomes Viewer, suspended, removed or inactive, their ID remains visible for traceability and timing becomes reassignment required unless due today or overdue takes precedence.

## Creation

Owner, Admin and Member can create Actions from the register using the New Action dialog. Direct register creation requires:

- brief;
- optional due date;
- optional eligible Actioner.

The source defaults to Project. Arbitrary source linking is not exposed in this slice. Viewer sees the New Action button disabled with read-only guidance, and server-side RPC enforcement remains the security boundary.

Successful creation redirects to the new Action detail page. Form values are preserved after validation or server errors.

## Detail and History

The detail page shows the Action reference, workflow state, timing state, brief, due date, Actioner, raiser, acceptance owner, source, timestamps, current response where present, safe evidence links and immutable history.

History is read-only and structured by event type, actor, timestamp, state change, reason, response, evidence link and before/after values. It remains workflow history, not a comments stream.

Management controls are shown only when the current user has record authority and the operation is valid for the current state:

- amend brief;
- change due date;
- assign/reassign/unassign;
- reissue;
- complete;
- return to Actioner;
- cancel;
- Owner/Admin acceptance takeover.

Actioner submit, return-to-raiser and reject response forms are intentionally deferred to WT-ACTION-003. Assigned Actioners see a note on the detail page where those controls will arrive.

## Permissions, RLS and RPCs

The Action permission names are:

- `action.view`
- `action.create`
- `action.respond`
- `action.review`
- `action.manage`
- `action.takeover`

Viewer receives `action.view` only. Owner and Admin receive all Action permissions. Member receives normal non-takeover Action capabilities but not `action.takeover`, because MVP acceptance-owner takeover is restricted to Owner/Admin.

Database RLS permits active workspace members to read Actions and Action history for their workspace. Authenticated users receive select grants only. Direct authenticated insert, update and delete grants are not introduced.

All material writes go through named `security definer` RPC functions with `search_path = public`:

- `create_project_action`
- `submit_project_action`
- `return_project_action_to_raiser`
- `reject_project_action`
- `return_project_action_to_actioner`
- `complete_project_action`
- `cancel_project_action`
- `assign_project_action`
- `amend_project_action_brief`
- `change_project_action_due_date`
- `reissue_project_action`
- `take_over_project_action_acceptance`

The TypeScript service layer in `src/lib/projectActions.ts` exposes matching wrappers and central error mapping for permission, transition, stale-state, eligibility, terminal-state, missing-input and evidence URL failures.

## Actor Authority

The database derives the actor from `auth.uid()`. Callers cannot provide actor, raiser, workspace or acceptance-owner identity.

Owner, Admin and Member can create Actions. Viewer cannot create or mutate Actions.

An assigned Actioner must be an active Owner, Admin or Member in the same workspace. Viewer, suspended, removed and cross-workspace users are rejected for new assignment. If an existing Actioner later loses eligibility, the `actioner_id` remains for traceability but Actioner response RPCs are blocked with an ineligible-Actioner error.

Only the current eligible Actioner can:

- submit;
- return to raiser;
- reject.

Only the current eligible acceptance owner can:

- complete;
- return to Actioner;
- cancel;
- assign, unassign or reassign;
- amend brief;
- change due date;
- reissue.

Owner/Admin takeover is separate from ordinary review authority. An active workspace Owner or Admin may take over acceptance ownership with a mandatory reason. Takeover writes immutable history and does not change the original raiser. Member and Viewer cannot take over.

## Transition Matrix

| From | Actor | Operation | To |
| --- | --- | --- | --- |
| none | authorised creator | create | `open` |
| `open` | current eligible Actioner | submit | `submitted` |
| `open` | current eligible Actioner | return to raiser | `returned_to_raiser` |
| `open` | current eligible Actioner | reject | `rejected_by_actioner` |
| `returned_to_actioner` | current eligible Actioner | submit | `submitted` |
| `returned_to_actioner` | current eligible Actioner | return to raiser | `returned_to_raiser` |
| `returned_to_actioner` | current eligible Actioner | reject | `rejected_by_actioner` |
| `submitted` | acceptance owner | complete | `complete` |
| `submitted` | acceptance owner | return to Actioner | `returned_to_actioner` |
| `returned_to_raiser` | acceptance owner | reissue | `open` |
| `rejected_by_actioner` | acceptance owner | reissue | `open` |
| any non-terminal state | acceptance owner | cancel | `cancelled` |
| any non-terminal state | Owner/Admin | take over acceptance | unchanged |

Every other lifecycle transition is rejected.

`complete` and `cancelled` are terminal states. No RPC can move a terminal Action.

## Transaction and Concurrency Model

Each lifecycle RPC validates, locks the target Action row with `FOR UPDATE`, checks the expected status, optionally checks the expected `updated_at`, applies the change, appends history and returns the updated Action. If the Action update or history insert fails, the database transaction rolls back both changes.

Status-changing operations require an expected status. Status-neutral operations that could overwrite newer edits, such as reassignment, brief amendment, due-date change and takeover, also require the expected `updated_at` timestamp.

Reissue returns a returned or rejected Action to `open`. It may update the brief, due date and Actioner. The current response fields `latest_response`, `latest_evidence_url` and `submitted_at` are cleared because those fields represent the active response cycle; prior responses remain preserved in immutable history.

## Development Validation

The repository unit tests assert the migration contract statically and exercise the TypeScript RPC wrappers with mocked clients. They do not run live Supabase RLS or transaction tests.

Before wiring UI or source integrations to these RPCs, validate against a development Supabase database by applying all migrations, creating test users for Owner, Admin, Member and Viewer, and running the lifecycle matrix through authenticated RPC calls. Confirm that direct authenticated `insert`, `update` and `delete` attempts on `project_actions` and `project_action_history` still fail.

## URL and JSON Validation

Action and history evidence URLs must be null or use `http://` or `https://`.

`source_context`, `old_values` and `new_values` must be JSON objects when present. This keeps future source context and before/after history structured without introducing generic task-management fields.

## Still Deferred

The following remain outside this foundation:

- Risk integration;
- Project Dashboard Action signals;
- Personal dashboard;
- health metrics;
- Narrative events;
- Project Details integration;
- notifications;
- file uploads and attachments;
- Viewer contribution;
- new roles;
- archive/delete;
- general comments;
- working-day calculations;
- recurring Actions;
- sub-actions;
- Action dependencies.
