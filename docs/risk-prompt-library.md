# Watchtower Default Risk Prompt Library

**Status:** WT-RISK-GUIDE-001 foundation
**Scope:** Controlled repository CSV, normalized reference-data tables, idempotent seed/upsert, and read-only Account-page Risk Management visibility

## Purpose

The Watchtower Default Risk Prompt Library is product-controlled guidance for later guided risk identification. Prompts are not project facts, are not assessed risks, and must not pre-populate likelihood, impact, exposure, owner, actioner or mitigation details.

Selected prompts will be used by later slices to create Draft risks for human review and completion. This foundation only stores and displays the available default library.

## Source file

The controlled CSV lives at:

```text
data/risk-prompts/watchtower_default_risk_prompt_library_v1_0.csv
```

The MVP V1.0 file contains:

- 12 active risk areas;
- 96 active risk prompts;
- stable `risk_prompt_id` values;
- risk-scoped CSV fields;
- prompt guidance, ordering, source reference and tags;
- `risk_default_status=draft` for every prompt.

The application does not parse the CSV on page requests. Runtime pages read seeded database records.

## Database scope

The MVP uses one global default library rather than duplicating prompt records per workspace. Workspace-linked activation, custom libraries, organisation-managed libraries and multiple active libraries are future scope.

The migration `20260708000100_risk_prompt_library_foundation.sql` adds:

- `risk_prompt_libraries`;
- `risk_prompt_areas`;
- `risk_prompts`.

Authenticated users can read the reference data. No authenticated user can upload, download, insert, update, delete or replace prompt-library records through the UI. Seed/import execution is an administrative deployment concern.

## Stable-ID rules

- `risk_library_key` and `risk_library_version` identify a library version.
- `risk_prompt_id` is the stable prompt identity and must not be reused for unrelated prompts.
- Existing prompts should normally be deactivated with `risk_prompt_is_active=false` rather than removed.
- Removed CSV rows are not deleted automatically from the database.
- A seed run fails if an incoming `risk_prompt_id` already belongs to a different library version.

## Seed and validation

Validate the CSV:

```bash
npm run seed:risk-prompts
```

Generate the deployment SQL:

```bash
npm run seed:risk-prompts:sql
```

Apply directly when `psql` and `DATABASE_URL` are available:

```bash
DATABASE_URL=postgres://... node scripts/seed-risk-prompts.mjs --apply
```

The generated seed SQL is:

```text
supabase/seed-risk-prompts.sql
```

The seed runs in a transaction, upserts the library and areas, then upserts prompts using `risk_prompt_id`. Running it repeatedly must not create duplicates. Changed titles, guidance, ordering and active state update existing records.

Validation fails clearly for missing required headers, missing required values, duplicate prompt IDs, inconsistent area metadata, duplicate area ordering, duplicate prompt ordering, unsupported booleans, non-positive order values and non-draft default status.

## Account-page modal

The Account page includes a read-only Risk Management modal. It shows the active default library name, version, active risk-area count and active prompt count from the database.

Future functions are displayed separately as unavailable:

- Upload custom risk prompt library;
- Download or export risk prompt library;
- Workspace-specific risk libraries;
- Organisation-managed risk libraries;
- Alternative assessment profiles;
- Custom risk exposure models.

These entries are non-interactive and do not implement upload or download functionality.

## Risk Register prompt modal

WT-RISK-GUIDE-002 adds the first Risk Register modal for guided risk identification. WT-RISK-GUIDE-003 hardens the cross-category selection journey, and WT-RISK-GUIDE-004 adds the selected-only review mode. The entry point is the `Risk Suggestions` action on the project Risk Register.

The modal reads the active default library from Supabase through the same reference tables created in WT-RISK-GUIDE-001:

- active default library only;
- active risk areas only, ordered by `risk_area_order`;
- active prompts only, ordered by `risk_prompt_order`.

The page fails safely when the active default library cannot be loaded, when no active library exists, when no active areas exist, or when an area has no active prompts. User-facing messages are generic and do not expose raw database errors.

Risk areas are rendered as accessible tabs. Only the selected tab panel displays its prompt rows in full. Prompt controls use stable `risk_prompt_id` values for identity, so duplicate titles would still be independent selections.

Selection state is temporary and client-side only for the lifetime of the open modal. The authoritative state is one `Set<string>` of selected `risk_prompt_id` values; tab badges and the sticky footer total are derived from that set rather than stored as separate mutable counters. Users can select prompts across multiple risk-area tabs, return to earlier tabs without losing checked controls, and deselect prompts with counts updating immediately. Unknown prompt IDs are ignored and selections are pruned to the currently loaded active library.

Closing the modal clears selections; reopening starts with no selected prompts, no tab-count badges and a `0 prompts selected` footer total. The tab accessible name includes the area title and selected count, while the visible badge is decorative for assistive technology to avoid duplicate announcements.

`Show selected only` is enabled only when the modal has at least one selected prompt. It switches the modal from the risk-area tab view into a derived review view using the same selected-ID set. Selected prompts are grouped by source risk area in `risk_area_order` and shown in `risk_prompt_order`. Deselecting in the review view removes the prompt from the shared Set, updates the original tab badge and footer total immediately, and removes empty groups. Removing every prompt shows a deliberate empty state with a `Browse risk areas` action that returns to the normal tab view.

WT-RISK-GUIDE-005 makes the footer `Create` action functional for users whose existing workspace role can create project risks. The browser submits only selected stable `risk_prompt_id` values to the project-scoped server endpoint. The server reloads prompt titles and guidance from Supabase, checks the current workspace/project route, enforces `risk.create`, includes only active prompts from the active default library and active areas, and inserts one Draft `project_risks` record per eligible non-duplicate prompt.

Prompt-created risks are raised Draft records in a basic-capture state. They are visible in the Risk Register and Draft tab immediately, but they still need project-specific detail, assessment and ownership before becoming Active/Open. They are created with `status='draft'`, no owner or actioner, no review or due date, no mitigation or contingency plan, and the same safe required probability/impact storage defaults used for draft compatibility. The stored `rag_status='blue'` value is technical compatibility for the legacy required column only; Draft must not be presented as an assessed Blue risk. Prompt-created Drafts do not appear in Needs Action as active work, do not create Project Narrative entries and do not send notifications.

Each created risk stores `project_risks.source_risk_prompt_id`, a nullable foreign key to `risk_prompts(id)`. Manual risks leave this field null. Duplicate prevention is layered: the client disables the create button while a request is in flight, the server checks existing non-deleted risks with the same source prompt in the same project, and migration `20260709000100_project_risk_prompt_source.sql` adds a partial unique index on `(project_id, source_risk_prompt_id)` where the source prompt is present and the risk is not soft-deleted. The same prompt can still seed a risk in a different project. This one non-deleted project risk per source prompt per project rule is an MVP constraint and should be reviewed later against real usage data.

The app-layer create strategy is deterministic partial success rather than an explicit multi-row transaction. Valid, non-duplicate prompts are inserted sequentially using the existing risk-reference generation path; duplicates are skipped and reported. A concurrent duplicate conflict from the unique index is handled as a skipped duplicate. Unexpected insert failures stop the request and return a safe error message without exposing raw database details.

On success with at least one created risk, the modal clears its temporary selection by closing/reloading, the Risk Register refreshes, and the user is moved to the Draft tab with a page-level success message that includes created and skipped counts. If every selected prompt already exists for the project, the modal stays open, keeps the selection available and shows a duplicate-only message. Expected errors such as missing selection, unavailable library or insufficient permission are shown in the modal while preserving selections where retry is useful.

Follow-up requirement: Draft age can be derived from `project_risks.created_at` and raised-by can be derived from `created_by`. A future slice should surface how long each risk has remained Draft and challenge Drafts older than an initial 14-day threshold.

## Deployment and rollback

Deployment order:

1. Apply `20260708000100_risk_prompt_library_foundation.sql`.
2. Run `npm run seed:risk-prompts` before deployment to validate the CSV.
3. Apply `supabase/seed-risk-prompts.sql` or run `node scripts/seed-risk-prompts.mjs --apply` with `DATABASE_URL`.
4. Verify the default library reports 12 active areas and 96 active prompts.
5. Apply `20260709000100_project_risk_prompt_source.sql` before enabling prompt-created Draft risks.
6. Apply `20260710000100_project_risk_insert_updated_by.sql` so newly raised manual and prompt-created risks carry `updated_by` immediately.
7. Smoke test one Draft risk creation in a non-production or controlled test project, then repeat a duplicate create to confirm the duplicate skip path.

Development rollback can drop the three prompt-library tables after dependent seed data is no longer needed. Production rollback should prefer marking the library inactive rather than deleting reference records, unless a controlled data-removal plan exists.

If the WT-RISK-GUIDE-005 UI/API must be rolled back after the traceability migration has run, leave the nullable `source_risk_prompt_id` column in place unless a controlled data-removal plan exists. If the duplicate index causes an unexpected production conflict, the safer rollback is to drop `project_risks_project_source_prompt_key` while keeping the traceability column.

## Explicit exclusions

WT-RISK-GUIDE-005 does not implement draft review workflow, draft activation workflow, risk scoring, owner/actioner assignment, due-date assignment, bulk edit, AI generation, prompt recommendation, prompt-library editing, persisted selection sessions, workspace-specific libraries, notifications or Needs Action generation for created Draft risks.
