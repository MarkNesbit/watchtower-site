# Project Narrative

**Status:** WT-NARRATIVE-001 table layout foundation on the WT-NARRATIVE-002 schema

**Migration:** `20260624000400_project_narrative_schema_foundation.sql`

**Scope:** Workspace-isolated records, data access, permissions, and the first project-level assurance table

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

## Page and table layout

The canonical route is `/app/workspaces/{workspaceSlug}/projects/{projectSlug}/narrative`. It resolves active workspace membership and the project within that workspace, observes the internal `projectDiary` feature flag, checks `narrative.view`, and then uses the scoped Narrative list helper. The project dashboard's **Project Narrative** tile links to this route whenever the feature is accessible.

The page hero contains the **Project Narrative** title, its helper text, the visible **Add narrative entry** action, and disabled foundation controls for entry/source type, attention, date range, and source. Manual entry creation and functional filtering remain deferred, so both areas explain their unavailable state. Viewers receive the same read access as other active members but no active mutation control.

Entries render newest first in an accessible, horizontally scrollable table with exactly these columns:

1. Ref
2. Attention
3. Details
4. Created by
5. Created

There is deliberately no Type column. The internal `entry_number` remains audit/export-readiness data and is not a visible row-number column. Ref displays `source_ref` when present and otherwise `narrative_ref`. It is styled and focusable as the future detail interaction, while clearly marked unavailable until the source-record modal story is delivered.

Attention displays both text and a colour treatment, including a quieter neutral state. Details render title and body as escaped Astro template content. Creator display uses profile name/email where the existing profile RLS relationship makes it available and otherwise shows `Workspace member`; UUIDs are not exposed. Creation timestamps currently use a simple explicit UTC display. A shared effective-viewer-timezone DTS helper remains future work.

The empty state explains that future manual updates and RAID-linked activity will appear in one assurance timeline.

## Data-access foundation

`src/lib/projectNarrative.ts` centralises the allowed source and attention values and provides scoped list/create helpers. The page uses the list helper, which always filters by both workspace and project and sorts by `created_at` descending then `entry_number` descending. The create helper applies role checks and safe defaults, while the database remains the final validation and security boundary; the page does not call it because creation UI is outside this story.

## Validation

Automated tests cover the migration structure, project/workspace foreign key, allowed values, manual-entry defaults, future source metadata, atomic project-scoped numbering, immutable identities, UTC/IANA fields, RLS role intent, application permissions, scoped newest-first listing, Ref selection, route/table structure, dashboard routing, and absence of out-of-scope integrations.

For an environment with the Supabase CLI and local Docker runtime, validate the complete migration chain with:

```bash
npx supabase db reset
npm test
```

Then exercise authenticated owner/member/viewer users in two workspaces to confirm the RLS paths against the live local API.

## Explicitly deferred

- Manual Narrative entry creation.
- Source-record modal behaviour from Ref.
- Risk-to-Narrative and other RAID event integrations.
- Functional/full filter and search behaviour.
- Notification, digest, attention-item, CSV export, AI, and browser badge behaviour.
- Edit and delete UI. Before any delete UI is introduced, confirm whether Members retain delete permission or whether deletion becomes Owner/Admin-only or archive-based.
- A shared effective-viewer-timezone DTS display helper.
