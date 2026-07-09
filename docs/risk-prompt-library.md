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

## Deployment and rollback

Deployment order:

1. Apply `20260708000100_risk_prompt_library_foundation.sql`.
2. Run `npm run seed:risk-prompts` before deployment to validate the CSV.
3. Apply `supabase/seed-risk-prompts.sql` or run `node scripts/seed-risk-prompts.mjs --apply` with `DATABASE_URL`.
4. Verify the default library reports 12 active areas and 96 active prompts.

Development rollback can drop the three prompt-library tables after dependent seed data is no longer needed. Production rollback should prefer marking the library inactive rather than deleting reference records, unless a controlled data-removal plan exists.

## Explicit exclusions

WT-RISK-GUIDE-001 does not implement prompt selection, category tabs, switches, cross-tab state, Show selected only, Draft risk creation, prompt-created risk source fields, risk activation, CSV upload/download, custom prompt editing, workspace overrides, multiple selectable libraries, assessment profile configuration, exposure model changes, AI prompt generation, search, filtering or analytics.
