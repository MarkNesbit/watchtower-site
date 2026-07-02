# Project Narrative

**Status:** WT-NARRATIVE-READSTATE-001 user read-state

**Migrations:** `20260624000400_project_narrative_schema_foundation.sql`, `20260625000100_project_narrative_entry_links.sql`, `20260702000100_project_narrative_read_states.sql`

**Scope:** Workspace-isolated records, data access, permissions, manual entry creation, structured links, limited risk-generated entries, per-user read-state, and the project-level assurance table/detail modal

## Purpose and source-of-truth boundary

Project Narrative is a project-level assurance timeline. It is designed to hold manual project updates, key delivery events, and deliberately selected references to activity in Risks, Issues, Dependencies, and Assumptions.

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

Allowed source types are `manual`, `risk`, `issue`, `dependency`, `assumption`, and `system`. Manual entries default to `manual` and may omit both source metadata fields. WT-RISK-NARRATIVE-001 risk entries use `source_type = risk`, the authoritative `project_risks.risk_id` in `source_record_id`, and the human-readable risk reference in `source_ref`. The migration does not add a foreign key from `source_record_id` because the future RAID tables do not all exist yet.

The database requires at least one of `title` or `details` to contain non-whitespace text so future source-generated entries can remain flexible. The WT-NARRATIVE-003 manual entry form is stricter: manual entries require both Title and Details for usable project context. `source_ref`, when present, cannot be blank.

`project_narrative_entry_links` stores optional structured hyperlinks for an entry. Each link includes:

- an internal UUID `id`;
- workspace and project ownership through `organisation_id` and `project_id`;
- `narrative_entry_id` pointing at the parent entry;
- required `label` and `url`;
- `created_by` and `created_at` audit fields.

Composite foreign keys require the link, parent Narrative entry, and project to belong to the same workspace. Link URLs are validated by the application and constrained in the database to `http://` or `https://` schemes. Unsafe schemes such as `javascript:` are rejected. Links are deleted with their parent entry. WT-NARRATIVE-003 does not add link editing or deletion UI.

`project_narrative_read_states` stores one personal read-state row per workspace, project and authenticated user. Each row includes:

- an internal UUID `id`;
- workspace and project ownership through `organisation_id` and `project_id`;
- `user_id` for the signed-in user whose state is being tracked;
- `last_viewed_at`, plus created/updated timestamps.

The unique key is `(organisation_id, project_id, user_id)`. Composite foreign keys require the read-state project to belong to the same workspace. The identity fields cannot be changed after creation; only `last_viewed_at` is granted for authenticated updates.

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

- owners, admins, members, and viewers can read entries and links in an active workspace they belong to;
- owners, admins, and members can create entries and links in that workspace;
- owners, admins, members, and viewers can read, create, and update only their own read-state rows for projects in an active workspace they belong to;
- existing database policies still permit entry update/delete for readiness, but WT-NARRATIVE-003 exposes no edit or delete UI;
- viewers cannot create, update, or delete entries;
- ordinary workspace members cannot read or mutate another user's Narrative read-state;
- users cannot read or mutate entries in another workspace;
- client inserts cannot supply workspace ownership, entry numbers, Narrative references, or creator identity;
- client updates cannot change immutable identity or scope fields.

The counter table has RLS enabled and no authenticated-client policies or grants. It is used only by the security-definer insert trigger and service-role maintenance.

## Page, creation modal, and detail modal

The canonical route is `/app/workspaces/{workspaceSlug}/projects/{projectSlug}/narrative`. It resolves active workspace membership and the project within that workspace, observes the internal `projectDiary` feature flag, checks `narrative.view`, and then uses the scoped Narrative list helper. The project dashboard's **Project Narrative** tile links to this route whenever the feature is accessible.

The page follows the authenticated project page design standard in `docs/ui-page-design-standard.md`. The hero contains Workspace context, project context, the **Project Narrative** title, and its helper text. The primary **New Entry** action sits in the main content panel header. Owners, admins, and members can open the create modal. Viewers see the same action disabled without creating a separate helper-copy block. A compact filter/status panel remains visible as a future control area and is labelled as coming soon.

The create modal captures Title, Attention level, Details, and optional Links. Title and Details are required, Attention defaults to Neutral, and allowed attention values remain `neutral`, `green`, `amber`, and `red`. Link rows require both a label and a safe URL. Successful manual saves use `source_type = manual`, leave `source_record_id` and `source_ref` null, close the modal through a redirect back to the page, and show the refreshed newest-first table.

Entries render newest first in an accessible, horizontally scrollable table with exactly these columns:

1. Ref
2. Details
3. Created by
4. Created

There is deliberately no Type or separate Attention column. The internal `entry_number` remains audit/export-readiness data and is not a visible row-number column. Ref displays `source_ref` when present and otherwise `narrative_ref` as a RAG/attention pill with a visible attention label. Clicking the Ref opens a read-only detail modal without navigating away from the Project Narrative page.

The Ref pill displays both text and a colour treatment, including a quieter neutral state, so attention is not conveyed by colour alone. Details render title and body as escaped Astro template content. Creator display uses profile name/email where the existing profile RLS relationship makes it available and otherwise shows `Workspace member`; UUIDs are not exposed. Creation timestamps currently use a simple explicit UTC display. A shared effective-viewer-timezone DTS helper remains future work.

The Project Dashboard Narrative tile is a user-specific awareness signal, not project health. It counts `project_narrative_entries.created_at > last_viewed_at` for the current user/project. If no read-state exists, all existing entries count as unseen so a first-time viewer does not receive a false Green. The tile maps unseen count to RAG state as follows: Green for 0 unseen entries, Amber for 1-3, Red for 4 or more, and Unknown only when the read-state cannot be calculated safely.

Rendering the project dashboard does not mark entries as read. Opening the Project Narrative page loads the entries and then upserts the current user's `project_narrative_read_states.last_viewed_at` for that workspace/project. The dashboard tile remains visually simple with only icon and title; unseen counts are exposed through accessible status labels rather than visible badges.

Project Narrative read-state remains user-specific and is not included in Projects page attention aggregation in WT-SIGNAL-CONSISTENCY-001. The Projects page currently aggregates non-user-specific Project Details and Risk area signals only, so one user's unseen Narrative entries do not change another user's project-list reference pill.

The detail modal displays the Narrative reference, title, attention level, details, links, source type, source reference when present, created by/at, and updated by/at when present. For manual entries the source type displays as `Manual`; an empty source reference row is not shown.

For risk-generated entries, the same modal can show read-only current source-risk detail: risk reference, title, description, lifecycle status, probability, impact, owner, actioner, review/due dates, latest update, mitigation/response and contingency. It presents overall concern, exposure, and attention/assurance as separate RAG signals so a high-exposure risk is not treated as the same thing as missing action. The modal includes an explicit Open full risk in new tab action using the workspace-safe Risk Detail route with `target="_blank"` and `rel="noopener noreferrer"`. It does not expose risk editing controls, so Owner/Admin/Member users still edit risks only in Risk Management and Viewer users remain read-only.

If a risk-linked Narrative entry points at a risk that can no longer be loaded for the selected workspace/project, the modal shows a safe unavailable message instead of displaying stale or cross-scope data. Opening or closing the modal does not update read-state beyond the existing page-open read-state behaviour.

The empty state explains that future manual updates and RAID-linked activity will appear in one assurance timeline, while respecting the user's create permission.

## Data-access foundation

`src/lib/projectNarrative.ts` centralises the allowed source and attention values and provides scoped list/create/read-state helpers. The page uses the list helper, which always filters by both workspace and project and sorts by `created_at` descending then `entry_number` descending. The create helper applies role checks, requires manual Title and Details, defaults source fields to manual/null, validates link rows, rejects unsafe URL protocols, inserts the entry, and then attaches any structured links to the created entry scope. The read-state helpers resolve the authenticated user, count unseen entries for the dashboard without mutating state, and upsert `last_viewed_at` only from the Narrative page. For risk-linked entries, the page detects `source_type = risk` with a `source_record_id` and fetches current risk data through the existing scoped Risk helper, filtering by the selected workspace and project before matching risk IDs. The database remains the final validation and security boundary.

## WT-RISK-NARRATIVE-001 risk entries

WT-RISK-NARRATIVE-001 adds deliberately limited Risk-to-Narrative integration. Risk-generated entries are created only for two events:

- a new risk is raised;
- an existing risk changes from non-Red to Red using the WT-RISK-005 derived overall concern.

The raised-risk entry is enough when a newly created risk is already Red, so create never also emits a duplicate "became Red" entry. Updating a risk that is already Red does not create another Red narrative entry unless the risk first moves out of Red and later becomes Red again.

Routine risk edits do not populate Project Narrative. Description edits, owner changes, actioner changes, review-date or due-date changes, mitigation or contingency changes, comments, routine lifecycle changes, Green to Amber movement, Amber to Green movement, Red to Amber/Green movement, and Red staying Red are not Narrative events unless the derived overall concern changes from non-Red to Red. Risk comments remain on the risk record and do not create Narrative entries.

Risk remains the source of truth. Project Narrative stores only concise event context and source linkage, not a duplicate risk data store or historical replay. This slice does not introduce attention items, notifications, daily digests, health scoring, AI summaries, issue creation, or risk editing from the Narrative modal.

## Validation

Automated tests cover the migration structure, project/workspace foreign key, allowed values, manual-entry defaults, source metadata, structured link schema/RLS, read-state schema/RLS, no-read-state unseen-count behaviour, last-viewed filtering, read-state upsert behaviour, link validation, atomic project-scoped numbering, immutable identities, UTC/IANA fields, RLS role intent, application permissions, scoped newest-first listing, Ref/detail modal behaviour, risk source preview/open-full-risk behaviour, route/table structure, dashboard routing, dashboard read-only behaviour, risk raised and non-Red-to-Red triggers, duplicate prevention, non-trigger routine edits/comments, and absence of attention item, notification, health scoring and AI behaviour.

For an environment with the Supabase CLI and local Docker runtime, validate the complete migration chain with:

```bash
npx supabase db reset
npm test
```

Then exercise authenticated owner/member/viewer users in two workspaces to confirm the RLS paths against the live local API.

## Explicitly deferred

- Other RAID event integrations beyond the limited WT-RISK-NARRATIVE-001 risk raised and risk became Red events.
- Risk, Issue, Dependency, or Assumption creation from Narrative entries.
- Promotion or conversion from Narrative to RAID.
- Functional/full filter and search behaviour.
- Notification, digest, attention-item, CSV export, AI, and browser badge behaviour.
- Edit and delete UI for entries or links. Before any delete UI is introduced, confirm whether Members retain delete permission or whether deletion becomes Owner/Admin-only or archive-based.
- A shared effective-viewer-timezone DTS display helper.
