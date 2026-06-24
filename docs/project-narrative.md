# Project Narrative Foundation

**Status:** WT-NARRATIVE-002 schema and data-access foundation

**Migration:** `20260624000400_project_narrative_schema_foundation.sql`

**Scope:** Database records, reference allocation, audit fields, Row Level Security, and non-UI data-access helpers

## Purpose and source-of-truth boundary

Project Narrative is a project-level assurance timeline. It is designed to hold manual project updates, key delivery events, and—through later integrations—references to activity in Risks, Issues, Dependencies, and Assumptions.

The Narrative is contextual and auditable, but it is not the editable source of truth for RAID data. A source-generated entry may retain a source UUID and a display reference such as `Risk-HHH-003`; the underlying Risk or other RAID record remains authoritative and must be changed in its own module.

The user-facing term is **Project Narrative**. The existing `projectDiary` and `riskToDiary` feature keys remain internal compatibility names until a separate feature-key migration is agreed. New schema and helper names use `narrative` consistently.

## Data model

`project_narrative_entries` stores one structured record per narrative event. Each record includes:

- an internal UUID `id`;
- workspace and project ownership through `organisation_id` and `project_id`;
- immutable `entry_number` and `narrative_ref` identities;
- `source_type`, optional `source_record_id`, and optional `source_ref` for future source linking;
- `attention_level` with `neutral`, `green`, `amber`, and `red` values;
- a title, details, or both;
- creator/updater identities and timestamps;
- optional IANA `created_timezone` and `updated_timezone` context.

Allowed source types are `manual`, `risk`, `issue`, `dependency`, `assumption`, and `system`. Manual entries default to `manual` and may omit both source metadata fields. The migration does not add a foreign key from `source_record_id` because the future RAID tables do not all exist yet.

At least one of `title` or `details` must contain non-whitespace text. `source_ref`, when present, cannot be blank.

## Entry numbering and references

Entry identity is assigned in the database, not accepted from application clients. Each project has its own increasing sequence:

```text
NAR-{PROJECT_REF}-{NNN}
```

For example, the first entry for project `HHH` is `NAR-HHH-001`.

The internal `project_narrative_counters` table uses an atomic row update per project. This serialises concurrent allocations and remembers the highest number issued even if an entry is later deleted, preventing reference reuse. Authenticated clients have no direct access to the counter table.

Both `(project_id, entry_number)` and `(project_id, narrative_ref)` are unique. Update triggers also prevent the workspace, project, entry number, Narrative reference, creator, and creation timestamp from changing after insertion. A project must already have a valid `projects.project_ref`; entries for early projects without one are rejected pending a controlled project-reference assignment.

## Audit timestamps and timezone context

`created_at` and `updated_at` use PostgreSQL `timestamptz`, following the Watchtower DTS rule that persisted instants are UTC-compatible. The application must later render those instants in the signed-in viewer's effective timezone.

The optional timezone context fields accept `UTC` or region-based IANA names found in PostgreSQL's timezone catalogue, such as `Europe/London`, `Asia/Kolkata`, and `America/New_York`. Fixed offsets and abbreviations such as `+01:00`, `BST`, and `GMT` are not accepted as context values.

`created_by` is bound to `auth.uid()` for authenticated inserts. `updated_by` and `updated_at` are set on updates. A future system integration using the service role must still provide a valid `created_by` identity.

## Permissions and Row Level Security

Project access currently follows active workspace membership; there is no separate project-membership model. The project/workspace composite foreign key prevents an entry from naming a project in a different workspace.

RLS and the application permission map enforce:

- owners, admins, members, and viewers can read entries in an active workspace they belong to;
- owners, admins, and members can create, update, and delete entries in that workspace;
- viewers cannot create, update, or delete entries;
- users cannot read or mutate entries in another workspace;
- client inserts cannot supply workspace ownership, entry numbers, Narrative references, or creator identity;
- client updates cannot change immutable identity or scope fields.

The counter table has RLS enabled and no authenticated-client policies or grants. It is used only by the security-definer insert trigger and service-role maintenance.

## Data-access foundation

`src/lib/projectNarrative.ts` centralises the allowed source and attention values and provides scoped list/create helpers for later server-side routes. The list helper always filters by both workspace and project. The create helper applies role checks and safe defaults, while the database remains the final validation and security boundary.

No Project Narrative page calls these helpers yet.

## Validation

Automated tests cover the migration structure, project/workspace foreign key, allowed values, manual-entry defaults, future source metadata, atomic project-scoped numbering, immutable identities, UTC/IANA fields, RLS role intent, application permissions, and absence of out-of-scope UI/integrations.

For an environment with the Supabase CLI and local Docker runtime, validate the complete migration chain with:

```bash
npx supabase db reset
npm test
```

Then exercise authenticated owner/member/viewer users in two workspaces to confirm the RLS paths against the live local API.

## Explicitly deferred

WT-NARRATIVE-002 does not implement a Project Narrative route or page, manual-entry form, table/modal/filter behaviour, RAID-to-Narrative generation, attention-item or notification delivery, digest logic, CSV export, AI analysis, or browser badges/counts. Those require separate product and implementation stories.
