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

WT-RISK-GUIDE-002 adds the first Risk Register modal for guided risk identification. WT-RISK-GUIDE-003 hardens the cross-category selection journey. The entry point is the `Risk Suggestions` action on the project Risk Register.

The modal reads the active default library from Supabase through the same reference tables created in WT-RISK-GUIDE-001:

- active default library only;
- active risk areas only, ordered by `risk_area_order`;
- active prompts only, ordered by `risk_prompt_order`.

The page fails safely when the active default library cannot be loaded, when no active library exists, when no active areas exist, or when an area has no active prompts. User-facing messages are generic and do not expose raw database errors.

Risk areas are rendered as accessible tabs. Only the selected tab panel displays its prompt rows in full. Prompt controls use stable `risk_prompt_id` values for identity, so duplicate titles would still be independent selections.

Selection state is temporary and client-side only for the lifetime of the open modal. The authoritative state is one `Set<string>` of selected `risk_prompt_id` values; tab badges and the sticky footer total are derived from that set rather than stored as separate mutable counters. Users can select prompts across multiple risk-area tabs, return to earlier tabs without losing checked controls, and deselect prompts with counts updating immediately. Unknown prompt IDs are ignored and selections are pruned to the currently loaded active library.

Closing the modal clears selections; reopening starts with no selected prompts, no tab-count badges and a `0 prompts selected` footer total. The tab accessible name includes the area title and selected count, while the visible badge is decorative for assistive technology to avoid duplicate announcements.

The footer reserves space for later workflow controls. `Show selected only` remains disabled until WT-RISK-GUIDE-004. `Create risks` remains disabled until WT-RISK-GUIDE-005, where selected prompts will create Draft risk records for review and assessment. WT-RISK-GUIDE-003 does not create project risks, source-prompt traceability fields, notifications, attention items, selection sessions, local-storage records or project-data recommendations.

## Deployment and rollback

Deployment order:

1. Apply `20260708000100_risk_prompt_library_foundation.sql`.
2. Run `npm run seed:risk-prompts` before deployment to validate the CSV.
3. Apply `supabase/seed-risk-prompts.sql` or run `node scripts/seed-risk-prompts.mjs --apply` with `DATABASE_URL`.
4. Verify the default library reports 12 active areas and 96 active prompts.

Development rollback can drop the three prompt-library tables after dependent seed data is no longer needed. Production rollback should prefer marking the library inactive rather than deleting reference records, unless a controlled data-removal plan exists.

## Explicit exclusions

WT-RISK-GUIDE-001 does not implement prompt selection, category tabs, switches, cross-tab state, Show selected only, Draft risk creation, prompt-created risk source fields, risk activation, CSV upload/download, custom prompt editing, workspace overrides, multiple selectable libraries, assessment profile configuration, exposure model changes, AI prompt generation, search, filtering or analytics.
