# Watchtower Database Schema v1

**Document Version:** 1.0
**Status:** Draft for WT-001B Database Foundation
**Date:** 12 June 2026
**Related ADRs:** ADR-000, ADR-001, ADR-002, ADR-004, ADR-005

---

# Purpose

This document defines the initial Watchtower application database schema.

It exists to give Codex and future contributors an explicit implementation reference before database migrations are created.

Architecture Decision Records (ADRs) explain why decisions were made.

This schema document explains what should be implemented.

---

# Scope

This document covers the foundation database tables required for:

* Application profiles
* Workspaces
* Workspace membership
* Workspace settings
* Feature flags
* Audit logging

This document does not cover:

* Projects
* Programmes
* Portfolios
* Forecasts
* Reports
* Imports
* AI outputs

Those will be defined in later schema documents.

---

# Core Principles

## Supabase Auth owns authentication

The `auth.users` table is owned and managed by Supabase.

Watchtower must not manually create or modify `auth.users`.

Application tables should reference `auth.users.id` where a user relationship is required.

---

## Workspace ownership is the security boundary

The database uses the term:

`organisation`

The user interface uses the term:

`Workspace`

All future business data must belong to an organisation/workspace.

---

## Row Level Security is mandatory

All application-owned tables must have Row Level Security (RLS) enabled.

Users must not be able to access data belonging to an organisation unless they have an active membership for that organisation.

---

## Migrations only

This schema must be implemented through Supabase migration files.

Database tables must not be created manually in the Supabase UI.

---

# Naming Standards

## Table names

Use lowercase snake_case plural table names.

Examples:

* `profiles`
* `organisations`
* `organisation_members`

## Column names

Use lowercase snake_case.

Examples:

* `created_at`
* `organisation_id`
* `display_name`

## Primary keys

Use `uuid` primary keys unless otherwise stated.

## Timestamps

Use `timestamptz`.

Standard timestamp columns:

* `created_at`
* `updated_at`
* `archived_at`
* `deleted_at`

## Soft deletion

Use `deleted_at` for soft deletion where relevant.

Do not physically delete important records unless explicitly required.

---

# Table: `profiles`

## Purpose

Stores Watchtower-specific user profile information.

Authentication remains owned by Supabase Auth.

A profile record should be created for each authenticated user.

## Relationship

One profile maps to one Supabase Auth user through `profiles.auth_user_id`.

`profiles.id` is the immutable Watchtower profile/person UUID. For historical direct sign-ups it may match the Supabase Auth UUID, but invitation Auth repair can deliberately move sign-in to a different Auth UUID.

## Fields

| Field           | Type          | Nullable | Default            | Foreign Key     | Description                                                                  |
| --------------- | ------------- | -------: | ------------------ | --------------- | ---------------------------------------------------------------------------- |
| `id`            | `uuid`        |       No | None               | None            | Primary key. Immutable Watchtower profile/person UUID.                      |
| `email`         | `text`        |       No | None               | None            | User email address copied from Supabase Auth for display/search convenience. |
| `display_name`  | `text`        |       No | Derived from email | None            | User-facing name. Initially generated from the email address.                |
| `first_name`    | `text`        |      Yes | Safe existing profile derivation where available | None | Nullable future team administration first-name field.                        |
| `last_name`     | `text`        |      Yes | Safe existing profile derivation where available | None | Nullable future team administration last-name field.                         |
| `login_name`    | `text`        |      Yes | Derived from existing profile data | None       | Future unique Watchtower login identifier; not used for login in WT-WORKSPACE-TEAM-002. |
| `contact_email` | `text`        |      Yes | Backfilled from `email` | None        | Future contact/notification email distinct from the Supabase Auth email.     |
| `avatar_url`    | `text`        |      Yes | `null`             | None            | Optional profile image URL for future use.                                   |
| `last_login_at` | `timestamptz` |      Yes | `null`             | None            | Last known successful login time. May be populated later.                    |
| `is_internal_tester` | `boolean` |       No | `false`            | None            | WT-TEST-001 internal test-tool eligibility for the scoped production test workspace only. |
| `created_at`    | `timestamptz` |       No | `now()`            | None            | Timestamp when the profile was created.                                      |
| `updated_at`    | `timestamptz` |       No | `now()`            | None            | Timestamp when the profile was last updated.                                 |
| `created_by`    | `uuid`        |      Yes | `null`             | `auth.users.id` | User or system actor that created the profile. Usually the same as `id`.     |
| `updated_by`    | `uuid`        |      Yes | `null`             | `auth.users.id` | User who last updated the profile. Useful where admins manage display names. |

## Constraints

* `id` is the primary key.
* `id` references `auth.users.id`.
* `email` must not be empty.
* `display_name` must not be empty.
* `login_name`, when present, must be lower-case normalised and unique by normalised comparison.
* `contact_email`, when present, must be lower-case normalised and email-shaped.

## Notes

Display names are initially generated from the email address.

Example:

`mark.nesbit@example.com`

becomes:

`Mark Nesbit`

Display name editing is governed by workspace settings, not hardcoded user behaviour.

`is_internal_tester` is not a workspace role, customer permission, platform administrator flag or impersonation capability. It only unlocks the scoped internal role simulation utility when the user also has active membership in the Mark.Nesbit.Professional test workspace.

`profiles.email` remains a compatibility mirror of `auth.users.email`. `contact_email` is the future contact/notification address and is backfilled from `profiles.email` where missing; this does not modify `auth.users.email`. `login_name` is schema-ready for future work but does not change the current email/password login journey. Missing login names are normalised from existing display/profile email data and receive deterministic `.02`, `.03` suffixes if the generated value already exists. `first_name` and `last_name` are backfilled only when existing profile text clearly resolves to exactly two name parts; uncertain names remain nullable and continue to use display-name fallback.

---

# Table: `organisations`

## Purpose

Stores workspaces.

The database term is `organisation`.

The user interface term is `Workspace`.

## Relationship

One organisation may have many members.

One organisation may own many future business records such as projects, reports, forecasts and imports.

## Fields

| Field         | Type          | Nullable | Default                  | Foreign Key     | Description                                                                 |
| ------------- | ------------- | -------: | ------------------------ | --------------- | --------------------------------------------------------------------------- |
| `id`          | `uuid`        |       No | `gen_random_uuid()`      | None            | Primary key for the workspace/organisation.                                 |
| `name`        | `text`        |       No | None                     | None            | User-facing workspace name. Example: `Mark Nesbit Workspace`.               |
| `slug`        | `text`        |       No | Generated by application | None            | URL-safe unique workspace identifier. Example: `mark-nesbit-workspace`.     |
| `type`        | `text`        |       No | `personal`               | None            | Workspace type. Supported values: `personal`, `team`, `business`, `client`. |
| `created_by`  | `uuid`        |       No | None                     | `auth.users.id` | User who created the workspace.                                             |
| `created_at`  | `timestamptz` |       No | `now()`                  | None            | Timestamp when the workspace was created.                                   |
| `updated_at`  | `timestamptz` |       No | `now()`                  | None            | Timestamp when the workspace was last updated.                              |
| `archived_at` | `timestamptz` |      Yes | `null`                   | None            | Timestamp when the workspace was archived. Null means not archived.         |
| `deleted_at`  | `timestamptz` |      Yes | `null`                   | None            | Soft deletion timestamp. Null means not deleted.                            |

## Constraints

* `id` is the primary key.
* `slug` must be unique.
* `type` must be one of: `personal`, `team`, `business`, `client`.
* `name` must not be empty.
* `created_by` references `auth.users.id`.

## Notes

Every new user receives a default personal workspace.

Example:

Display name:

`Mark Nesbit`

Workspace:

`Mark Nesbit Workspace`

Type:

`personal`

---

# Table: `organisation_members`

## Purpose

Connects users to workspaces and defines their role.

This table is the basis of workspace access control.

## Relationship

Many users may belong to many organisations.

A user may belong to multiple workspaces.

A workspace may have multiple users.

## Fields

| Field             | Type          | Nullable | Default             | Foreign Key        | Description                                                                             |
| ----------------- | ------------- | -------: | ------------------- | ------------------ | --------------------------------------------------------------------------------------- |
| `id`              | `uuid`        |       No | `gen_random_uuid()` | None               | Primary key for the membership record.                                                  |
| `organisation_id` | `uuid`        |       No | None                | `organisations.id` | Workspace the membership belongs to.                                                    |
| `user_id`         | `uuid`        |       No | None                | `profiles.id`      | Immutable profile/person UUID for the workspace member.                                |
| `role`            | `text`        |       No | `member`            | None               | User role within the workspace. Supported values: `owner`, `admin`, `member`, `viewer`. |
| `status`          | `text`        |       No | `active`            | None               | Membership status. Supported values: `invited`, `invite_expired`, `active`, `suspended`, `deactivated`. |
| `invited_by`      | `uuid`        |      Yes | `null`              | `auth.users.id`    | User who invited this member. Null for automatically created owner membership.          |
| `invited_at`      | `timestamptz` |      Yes | `null`              | None               | Timestamp when the invitation was created.                                              |
| `invitation_expires_at` | `timestamptz` | Yes | `null`         | None               | Timestamp used for invitation expiry and expired-invitation state.                      |
| `accepted_at`     | `timestamptz` |      Yes | `null`              | None               | Timestamp when an invitation was accepted or activated.                                 |
| `joined_at`       | `timestamptz` |      Yes | `now()`             | None               | Timestamp when the user joined. For the original owner this may equal creation time.    |
| `suspended_at`    | `timestamptz` |      Yes | `null`              | None               | Timestamp when the membership was suspended.                                            |
| `suspended_by`    | `uuid`        |      Yes | `null`              | `auth.users.id`    | Actor who suspended the membership.                                                     |
| `suspension_reason` | `text`      |      Yes | `null`              | None               | Optional suspension reason.                                                             |
| `deactivated_at`  | `timestamptz` |      Yes | `null`              | None               | Timestamp when the membership was deactivated.                                          |
| `deactivated_by`  | `uuid`        |      Yes | `null`              | `auth.users.id`    | Actor who deactivated the membership.                                                   |
| `deactivation_reason` | `text`    |      Yes | `null`              | None               | Optional deactivation reason.                                                           |
| `reactivated_at`  | `timestamptz` |      Yes | `null`              | None               | Timestamp when a suspended/deactivated membership was reactivated.                      |
| `reactivated_by`  | `uuid`        |      Yes | `null`              | `auth.users.id`    | Actor who reactivated the membership.                                                   |
| `reactivation_reason` | `text`    |      Yes | `null`              | None               | Optional reactivation reason.                                                           |
| `created_at`      | `timestamptz` |       No | `now()`             | None               | Timestamp when the membership record was created.                                       |
| `updated_at`      | `timestamptz` |       No | `now()`             | None               | Timestamp when the membership record was last updated.                                  |
| `updated_by`      | `uuid`        |      Yes | `null`              | `auth.users.id`    | Actor who last updated controlled lifecycle fields.                                     |

## Constraints

* `id` is the primary key.
* `organisation_id` references `organisations.id`.
* `user_id` references `profiles.id`.
* `role` must be one of: `owner`, `admin`, `member`, `viewer`.
* `status` must be one of: `invited`, `invite_expired`, `active`, `suspended`, `deactivated`.
* A user should not have duplicate membership records for the same organisation.
* Each organisation should have at least one owner.
* `invited` and `invite_expired` require `invited_at`.
* `invite_expired` requires `invitation_expires_at`.
* `suspended` requires `suspended_at`.
* `deactivated` requires `deactivated_at`.

## Notes

Only `active` memberships grant access to workspace data.

Admins must not be able to demote, suspend or deactivate the owner or another admin in this foundation slice.

WT-WORKSPACE-TEAM-002 adds database functions for controlled lifecycle transitions and a trigger that protects the final active owner from deactivation, suspension or demotion. The legacy `removed` status is migrated to `deactivated`.

---

# View: `workspace_member_directory`

Provides safe same-workspace display identity for active workspace users. It includes profile UUID, membership UUID, workspace UUID, linked Auth UUID, display name, first name, last name, login name, role, membership status and deactivated presentation fields. It deliberately excludes `contact_email` and the auth email mirror.

Access is constrained by `is_active_organisation_member(organisation_id)`.

---

# View: `workspace_member_admin_directory`

Provides Owner/Admin-only membership administration display identity for future team administration. It includes the safe directory fields plus linked Auth UUID, `contact_email`, `auth_email`, `joined_at` and lifecycle timestamps. The Team page's Joined value reads `organisation_members.joined_at`, with invitation acceptance populating that field when it was previously null.

Access is constrained by `has_real_active_organisation_role(organisation_id, array['owner', 'admin'])`, which uses the real stored membership role rather than internal role simulation.

---

# Table: `workspace_membership_audit_events`

## Purpose

Append-only audit foundation for workspace membership lifecycle and profile identity correction events.

## Key fields

`organisation_id`, `organisation_membership_id`, `target_user_id`, `actor_user_id`, `event_type`, `previous_status`, `new_status`, `previous_values`, `new_values`, `reason`, `source`, `correlation_id`, `created_at`.

`target_user_id` and `actor_user_id` reference `auth.users.id`; profile UUIDs are recorded only in JSON payload fields when the audit event also needs to identify the Watchtower profile/person record. `organisation_membership_id` is the dedicated workspace membership reference.

Supported event types include `membership_invited`, `invitation_expired`, `membership_activated`, `membership_suspended`, `membership_deactivated`, `membership_reactivated`, `profile_identity_corrected`, `membership_import_proposed`, `membership_import_uploaded`, `membership_import_validation_failed`, `membership_import_validated`, `membership_import_stale_detected`, `membership_import_superseded_rejected`, `membership_import_applied`, `membership_import_failed`, `membership_export_generated`, `membership_export_read_only_generated`, `membership_export_taken_over`, `membership_export_superseded`, `workspace_membership_csv_checkout_released`, `membership_change_approved`, `membership_change_excluded`, `membership_deactivation_kept_active`, `membership_change_decision_revised`, `membership_change_blocked`, `membership_change_no_longer_required`, `membership_change_set_confirmed`, `membership_change_set_reconfirmed`, `workspace_membership_change_selection_confirmed`, `membership_addition_applied`, `profile_identity_correction_applied`, `membership_deactivation_applied`, `membership_reactivation_applied`, `membership_change_application_failed`, `membership_change_set_applied` and `membership_change_set_drift_detected`.

Owner/Admin users can read audit events for their workspace. Normal authenticated users cannot update or delete audit events.

---

# Tables: Workspace Membership CSV Administration Foundation

WT-WORKSPACE-TEAM-002 creates the schema foundation for later CSV administration without generating, uploading, parsing or applying CSV files.

The foundation tables are:

* `workspace_membership_export_runs`
* `workspace_membership_export_rows`
* `workspace_membership_import_runs`
* `workspace_membership_import_rows`
* `workspace_membership_change_decisions`

These tables store future export snapshot versions, import run state, parsed row/proposed value evidence and row-level decisions. RLS restricts access to real active Owners/Admins in the same workspace. Members and Viewers do not receive membership administration write access.

WT-WORKSPACE-TEAM-004 completes the export half of this foundation. `workspace_membership_export_runs.export_mode` distinguishes `editable` from `read_only` exports. Editable exports use `status = checked_out`, `editing_mode = checked_out` and a 24-hour `checkout_expires_at`; read-only exports use `export_mode = read_only`, `editing_mode = none` and no checkout expiry. Takeover is represented by `takeover_of_export_id`, `superseded_at`, `superseded_by`, `superseded_by_export_id` and `takeover_at`.

`workspace_membership_export_rows` stores the exact normalised membership snapshot used to generate the CSV, including membership UUID, profile/user UUID, login name, first name, last name, `contact_email`, role, membership status and lifecycle timestamps. The exported CSV column named `email` maps to `profiles.contact_email`; it does not expose `profiles.email` or `auth.users.email`.

`current_workspace_membership_snapshot_version(organisation_id)` returns a deterministic bigint hash over membership identity, role, state and lifecycle fields. `create_workspace_membership_csv_export(organisation_id, export_mode, takeover_export_id)` is the controlled security-definer export operation. It checks the actor's real active Owner/Admin role, serialises editable checkout creation with a workspace advisory transaction lock, inserts the export run and rows, supersedes a taken-over export where confirmed, and records membership export audit events. Authenticated users keep read access through RLS but direct insert/update on export runs is revoked after this function exists.

WT-WORKSPACE-TEAM-004-FIX-002 adds holder-only checkout release for editable exports. `workspace_membership_export_runs` can store `released_at`, `released_by`, `release_source = holder_undo` and `release_reason`; released exports use `status = released`, are excluded from current-checkout lookup and retain their export rows. The controlled function `release_workspace_membership_csv_checkout(organisation_id, export_id, reason, source)` requires the actor's real active Owner/Admin membership and verifies that the actor is the current checkout holder before atomically releasing the checkout and writing `workspace_membership_csv_checkout_released`.

WT-WORKSPACE-TEAM-005 completes the import evidence model for validation only. `workspace_membership_import_runs` stores the source export, uploader, original filename, file size, SHA-256 file hash, source/live snapshot versions, checkout-expired flag, stale/superseded flags, validation status and summary counts. `workspace_membership_import_rows` stores source row number for diagnostics, supplied membership/user UUIDs, raw values, normalised values, source export values, live values, proposed values, field-level differences, validation messages, proposed change type, unchanged flag and formula-safety metadata.

The upload route `/app/workspaces/{workspaceSlug}/team/import` records evidence through `record_workspace_membership_import_validation(organisation_id, source_export_id, metadata, rows)`. Authenticated users can select evidence through Owner/Admin RLS, but direct insert/update grants on the import evidence tables are revoked in favour of this controlled function. The function writes import upload, validation failed, validated, stale detected and superseded rejected audit events. It never mutates `auth.users`, `profiles` or `organisation_members`.

WT-WORKSPACE-TEAM-006 completes the non-destructive review half of the import journey. `workspace_membership_change_decisions` stores one current decision per valid material proposal, with `decision` values `pending`, `approved`, `excluded`, `keep_active`, `blocked`, `superseded` and `no_longer_required`; legacy `rejected` and `skipped` remain allowed for compatibility. `decision_version`, `previous_decision`, `decision_history`, `decided_by`, `decided_at`, `reason`, `live_recalculation_status`, `live_snapshot_version`, recalculated live/proposed values and preliminary `impact_counts` preserve the evidence for later application.

The review route `/app/workspaces/{workspaceSlug}/team/imports/{importRunId}/review` calls controlled functions only: `ensure_workspace_membership_change_decisions`, `recalculate_workspace_membership_change_proposals`, `record_workspace_membership_change_decision` and `confirm_workspace_membership_change_set`. These functions require the actor's real active Owner/Admin membership, reject superseded or ineligible imports, recalculate live state before display and final confirmation, protect Owner/Admin proposals, deny self-deactivation, preserve the final active Owner and write decision audit events.

WT-WORKSPACE-TEAM-006/007-FIX-002 adds persisted draft review fields to the same decision table: `review_selected`, `review_draft_reason`, `review_draft_updated_by` and `review_draft_updated_at`. Valid proposals default selected. `save_workspace_membership_review_draft_selection` updates only these draft fields for the current decision row after real Owner/Admin workspace checks, preserving refresh-safe modal state across browser refresh, deployment refresh, accidental navigation and cross-admin handoff. Final confirmation converts persisted draft selection into final decisions atomically when the client submits the persisted-draft mode: selected rows become `approved`, unselected additions/corrections/reactivations become `excluded`, and unselected deactivations become `keep_active`. Draft saving does not mutate membership, profile, auth or invitation delivery data and does not create final approval/exclusion audit events.

Final confirmation sets the import to `approved_for_application` and stores a versioned `approved_change_set`, `approved_change_set_summary`, `approved_change_set_version`, canonical `approved_live_snapshot_version` and legacy `approved_change_set_snapshot_version`. `approved_live_snapshot_version` is decimal text from `current_workspace_membership_snapshot_version_text` and is the application contract; callers must not coerce it through JavaScript `Number`, `parseInt`, `parseFloat` or JSON numeric snapshot transport. This is a WT-WORKSPACE-TEAM-007 handoff contract, not an apply operation. WT-006 does not mutate `auth.users`, `profiles`, `organisation_members`, invitation records, roles or reassignment records.

WT-WORKSPACE-TEAM-006/007-FIX-001 adds `reconfirm_workspace_membership_approved_change_set` for approved imports whose exact approval snapshot is missing or stale. The function reruns the live proposal calculation, preserves existing approved/excluded decisions unless the caller submits a deliberate selection update, records the current exact `approved_live_snapshot_version`, increments `approved_change_set_version`, writes `membership_change_set_reconfirmed` with previous/new versions and previous/new snapshots, and returns the import to `approved_for_application`. No CSV re-upload is required while the proposals remain valid. No membership, profile, auth or invitation delivery mutation occurs during reconfirmation. The production migration deployment is required before production approved imports can be repaired; the migration does not silently backfill unknown approved snapshots.

WT-WORKSPACE-TEAM-007-FIX-001 updates `apply_workspace_membership_change_set` so duplicate contact email handling is gated by the same immutable internal policy used earlier in WT-005/WT-006: `public.is_internal_role_simulation_workspace(p_organisation_id)`. Outside that policy, duplicate approved addition contact email and duplicate contact email against existing workspace profiles still fail the whole application and leave the import in `application_failed_pending_review`. Inside the policy, contact email is treated only as communication metadata: email is never used as identity, no existing profile is reused because an email matches, and each approved addition gets a generated profile UUID, membership UUID, deterministic pending login name/auth email and invitation handoff row. Application evidence records `shared_contact_exception_applied`, `shared_contact_policy_source` and `shared_contact_addition_count`. Invitation delivery is still not performed by WT-007. A production migration deployment is required for this behaviour.

WT-WORKSPACE-TEAM-007 transactionally applies only the frozen approved set through `apply_workspace_membership_change_set`. The function requires the actor's real active Owner/Admin membership, checks the source export has not been superseded, compares the exact live snapshot text against `approved_live_snapshot_version`, verifies current decision versions and locks target membership/profile rows before applying changes. Drift or controlled validation failures are recorded as application-run and audit evidence before any membership/profile/auth mutation.

WT-WORKSPACE-TEAM-007-FIX-002 adds `release_workspace_membership_csv_checkout_after_application`, an internal finalisation helper called by `apply_workspace_membership_change_set` after the application run, import run and batch audit evidence are applied. The helper derives the source editable checkout through `workspace_membership_import_runs.source_export_id`, requires the import and application run to be `applied`, then uses the existing checkout release fields with `release_source = application_completed` and `release_reason = Approved Workspace Team changes applied successfully.` The `workspace_membership_csv_checkout_released` audit event records source export, import, application, previous holder, prior expiry and release metadata. Already released, expired, superseded, missing and read-only source exports are no-ops, preserving idempotency. An active checkout release failure rolls the application back rather than leaving ambiguous state. The migration also repairs already-applied imports whose active source editable checkout still exists. No export rows, snapshot rows, import rows, decisions, application runs, invitation handoffs or audit evidence are deleted, and invitation delivery is not added. A production migration deployment is required.

* `workspace_membership_change_application_runs`
* `workspace_membership_invitation_handoffs`

`workspace_membership_change_application_runs` records each application attempt with an idempotency `operation_key`, requested/applied actor and timestamps, status values `requested`, `applying`, `applied`, `failed`, `drift_detected`, `rolled_back` and `already_applied`, expected/applied counts, live snapshot before/after and controlled failure details. `workspace_membership_invitation_handoffs` records pending invitation-delivery work for approved additions after the transaction creates a `profiles` row, an invited `organisation_members` row and, in historical deployed migrations, a synthetic placeholder `auth.users` row. The handoff table does not store invitation tokens and WT-007 does not send invitation email. WT-008A-FIX-005 treats placeholder-only Auth rows as requiring Supabase Auth Admin provisioning before delivery or setup links.

WT-WORKSPACE-TEAM-008 adds `workspace_membership_invitations` and `workspace_invitation_delivery_policies`. `workspace_membership_invitations` stores one membership-specific invitation lifecycle with organisation, membership, profile, auth user, application/handoff references, version, current flag, intended role, recipient email, restricted auth email, delivery strategy, SHA-256 token hashes only, issuer, expiry, delivery/open/accept/cancel/supersede timestamps, attempt counts, delivery operation key, sanitized email provider/message id evidence, provider accepted timestamp, failure code/message, correlation id and timestamps. A partial unique index enforces one current invitation per membership, and a token-hash unique index prevents duplicate live tokens. Supported invitation statuses are `pending_delivery`, `sending`, `delivered`, `delivery_failed`, `opened`, `accepted`, `expired`, `cancelled` and `superseded`; these do not replace `organisation_members.status`.

`workspace_invitation_delivery_policies` is the explicit delivery-policy foundation for unusual workspace delivery. Normal workspaces use `normal_smtp`. The bounded internal path uses `internal_gmail_alias` only when follow-up migration `20260723001200_workspace_invitation_internal_delivery_policy.sql` has seeded a locked policy row for that `organisation_id`; runtime delivery preparation does not infer the strategy from workspace name, slug, domain or duplicate contact email, and a later workspace rename does not change the policy. The locked internal row is seeded from the server-side internal workspace configuration and stores the base mailbox/prefix in restricted database configuration that workspace users cannot read or mutate directly. The generated auth and delivery alias is `base-local + "+" + prefix + "." + normalised-login + "." + first-12-profile-uuid-hex + "@" + base-domain`, preserving shared `contact_email` while guaranteeing unique deterministic aliases. `test_record_only` is reserved for controlled internal validation where delivery is recorded but production email is not claimed.

WT-008 RPCs are:

- `prepare_workspace_membership_invitations` derives profile, membership, intended role, contact email, auth email and handoff evidence server-side; stores hashed tokens only; supersedes old current links on resend/retry; reuses the existing profile, membership and auth UUID from the WT-007 handoff; and blocks duplicate shared-contact delivery without a locked internal policy.
- `begin_workspace_membership_invitation_delivery_attempt` claims a pending invitation as `sending` before the outbound provider call so the same current invitation cannot be handed to the provider twice by an idempotent retry.
- `record_workspace_membership_invitation_delivery_result` records provider acceptance or provider/configuration failure without activating membership and stores only sanitized provider evidence.
- `cancel_workspace_membership_invitation` invalidates the current token while leaving membership invited.
- `get_workspace_membership_invitation_by_token` validates the token hash before returning safe public invitation details and marks delivered links opened.
- `accept_workspace_membership_invitation` transactionally marks the invitation accepted and moves the linked membership to `active` only for the correct signed-in auth user, preserving the approved role.
- `workspace_invitation_identityless_auth_user_report` identifies current invited memberships whose invitation Auth user has email populated in `auth.users` but no email identity in `auth.identities`. It returns UUIDs, statuses and email domain only for service-role diagnostics.
- `get_workspace_invitation_auth_identity_repair_candidates`, `record_workspace_invitation_auth_identity_repair` and `verify_workspace_invitation_auth_placeholder_release` support service-role-only, idempotent remediation. The application uses Supabase Auth Admin to create a valid email identity and the database transaction remaps explicit `auth_user_id` columns on `profiles`, `organisation_members` and the current invitation without changing profile UUID, membership UUID, role or membership status. The placeholder release verifier must pass before the application hard-deletes a historical identity-less Auth placeholder to free the deterministic invitation alias.

Acceptance is authorised by a transaction-local `workspace_invitation_acceptance` lifecycle marker after the RPC has locked and verified the current invitation and invited membership. The membership guard permits only `invited` to `active`, population of acceptance/join dates, and normal update metadata; role, organisation, profile/person UUID, membership UUID, Auth UUID and deactivation/reactivation fields must remain unchanged. Direct table updates and unrelated RPCs still receive the standard controlled-lifecycle rejection.

Owner/Admin RLS can read invitation rows for their workspace. Policy rows are restricted database configuration: authenticated workspace users cannot directly select or mutate them, and locked policy rows reject update/delete. Normal authenticated users cannot directly mutate invitation rows; mutation occurs only through the controlled RPCs. `profiles.auth_user_id` and `organisation_members.auth_user_id` are explicit sign-in links and may differ from the immutable Watchtower profile/person UUIDs after invitation Auth repair. Production migration deployment is required before WT-008 can run against a live Supabase project. WT-WORKSPACE-TEAM-008A production email delivery uses Resend from the Cloudflare Worker with `WATCHTOWER_EMAIL_PROVIDER=resend`, `WATCHTOWER_RESEND_API_KEY`, `WATCHTOWER_EMAIL_FROM_NAME`, `WATCHTOWER_EMAIL_FROM_ADDRESS`, optional `WATCHTOWER_INVITATION_REPLY_TO` and `WATCHTOWER_SITE_URL=https://watch-tower.co.uk`; provider DNS verification for SPF/DKIM/DMARC remains an operational requirement outside the database migration.

Approved additions become invited memberships using deterministic login names and synthetic `@pending.watchtower.invalid` auth emails; contact email is stored on `profiles.contact_email`. Approved profile corrections update only `first_name`, `last_name` and `contact_email`, leaving `profiles.email`, auth email, login name, UUIDs, role and membership state unchanged. Approved deactivations and reactivations reuse the existing membership row, retain export/import/review evidence and write per-change plus batch audit events. Excluded proposals remain untouched.

---

# Table: `internal_role_simulations`

## Purpose

Stores short-lived WT-TEST-001 role simulation state for the authorised internal tester in the Mark.Nesbit.Professional production test workspace.

This table changes effective permission resolution only. It must not update or replace `organisation_members.role`.

## Fields

| Field             | Type          | Nullable | Default             | Foreign Key        | Description                                                                       |
| ----------------- | ------------- | -------: | ------------------- | ------------------ | --------------------------------------------------------------------------------- |
| `id`              | `uuid`        |       No | `gen_random_uuid()` | None               | Primary key for the simulation record.                                            |
| `user_id`         | `uuid`        |       No | None                | `auth.users.id`    | Authorised internal tester running the simulation.                                |
| `organisation_id` | `uuid`        |       No | None                | `organisations.id` | Scoped Mark.Nesbit.Professional test workspace.                                   |
| `simulated_role`  | `text`        |       No | None                | None               | Effective role to simulate: `owner`, `admin`, `member`, or `viewer`.              |
| `demo_person_id`  | `uuid`        |      Yes | `null`              | `workspace_demo_people.id` | Optional WT-TEST-002 demo persona driving the effective role.              |
| `is_active`       | `boolean`     |       No | `true`              | None               | Whether the simulation can still be considered active before expiry checks.        |
| `expires_at`      | `timestamptz` |       No | None                | None               | Automatic expiry timestamp, capped to 4 hours from creation by RLS insert policy. |
| `created_at`      | `timestamptz` |       No | `now()`             | None               | Timestamp when the simulation was created.                                        |
| `updated_at`      | `timestamptz` |       No | `now()`             | None               | Timestamp when the simulation was last updated.                                   |

## Notes

Only one active simulation should exist per user/workspace. RLS limits create/reset access to the authenticated user whose profile is marked `is_internal_tester = true`, who is an active member of the scoped `mark-nesbit-professional-workspace` workspace, and whose simulation expires within 4 hours. Expired or inactive rows are ignored by effective-role resolution.

This is not customer-facing permission management, not impersonation and not a global admin model.

---

# Table: `workspace_demo_people`

## Purpose

Stores WT-TEST-002 workspace-scoped demo people/personas for internal testing in the Mark.Nesbit.Professional production test workspace.

Demo people are not Supabase Auth users, invitations or real profile records. They provide team-modelling metadata for internal RBAC, ownership/actioner and future notification-routing tests.

## Fields

| Field                      | Type          | Nullable | Default             | Foreign Key        | Description                                                                  |
| -------------------------- | ------------- | -------: | ------------------- | ------------------ | ---------------------------------------------------------------------------- |
| `id`                       | `uuid`        |       No | `gen_random_uuid()` | None               | Primary key for the demo person.                                             |
| `organisation_id`          | `uuid`        |       No | None                | `organisations.id` | Scoped Mark.Nesbit.Professional test workspace.                              |
| `display_name`             | `text`        |       No | None                | None               | Demo person's display name.                                                  |
| `email`                    | `text`        |       No | None                | None               | Demo persona email identity. Not an auth account.                             |
| `notification_email`       | `text`        |       No | None                | None               | Future test notification routing address.                                     |
| `workspace_role`           | `text`        |       No | None                | None               | Demo effective role: `admin`, `member`, or `viewer`; owner personas blocked. |
| `project_role`             | `text`        |      Yes | `null`              | None               | Optional persona/project responsibility label.                                |
| `is_default_risk_owner`    | `boolean`     |       No | `false`             | None               | Test metadata for future risk ownership defaults.                             |
| `is_default_risk_actioner` | `boolean`     |       No | `false`             | None               | Test metadata for future risk action responsibility defaults.                 |
| `notes`                    | `text`        |      Yes | `null`              | None               | Internal tester notes.                                                       |
| `status`                   | `text`        |       No | `active`            | None               | `active` or `removed`.                                                       |
| `is_demo_person`           | `boolean`     |       No | `true`              | None               | Enforced demo/test data marker.                                               |
| `linked_profile_id`        | `uuid`        |      Yes | `null`              | `profiles.id`      | Future optional link to a real profile; CSV import keeps this null.          |
| `created_by`               | `uuid`        |      Yes | `auth.uid()`        | `auth.users.id`    | Authenticated internal tester who created the row.                            |
| `updated_by`               | `uuid`        |      Yes | `auth.uid()`        | `auth.users.id`    | Last authenticated internal tester to update the row.                         |
| `created_at`               | `timestamptz` |       No | `now()`             | None               | Timestamp when the row was created.                                          |
| `updated_at`               | `timestamptz` |       No | `now()`             | None               | Timestamp when the row was last updated.                                     |

## Notes

CSV import replaces demo people for the scoped workspace only. It must not insert into `auth.users`, must not replace real `profiles`, and must not alter `organisation_members`. Persona simulation may reference one active demo person from this table; the real authenticated user remains the Mark/internal tester while the demo person's workspace role drives effective RBAC.

---

# Table: `organisation_settings`

## Purpose

Stores workspace-level configuration and policy settings.

Keeping settings separate from `organisations` avoids bloating the core workspace table.

## Relationship

One organisation has one settings record.

`organisation_settings.organisation_id` is both primary key and foreign key.

## Fields

| Field                             | Type          | Nullable | Default  | Foreign Key        | Description                                                                               |
| --------------------------------- | ------------- | -------: | -------- | ------------------ | ----------------------------------------------------------------------------------------- |
| `organisation_id`                 | `uuid`        |       No | None     | `organisations.id` | Primary key. References the workspace these settings belong to.                           |
| `allow_user_display_name_editing` | `boolean`     |       No | `false`  | None               | Controls whether users can edit their own display name.                                   |
| `require_mfa`                     | `boolean`     |       No | `false`  | None               | Future policy controlling whether workspace members must use Multi-Factor Authentication. |
| `default_member_role`             | `text`        |       No | `member` | None               | Default role assigned to invited users unless specified otherwise.                        |
| `allow_member_project_creation`   | `boolean`     |       No | `true`   | None               | Controls whether members can create projects.                                             |
| `allow_member_data_upload`        | `boolean`     |       No | `true`   | None               | Controls whether members can upload data files.                                           |
| `created_at`                      | `timestamptz` |       No | `now()`  | None               | Timestamp when the settings record was created.                                           |
| `updated_at`                      | `timestamptz` |       No | `now()`  | None               | Timestamp when the settings record was last updated.                                      |

## Constraints

* `organisation_id` is the primary key.
* `organisation_id` references `organisations.id`.
* `default_member_role` must be one of: `admin`, `member`, `viewer`.

## Notes

Owner should not be a default invited role.

Owner assignment should be explicit.

---

# Table: `feature_flags`

## Purpose

Controls whether platform features are visible or enabled.

Feature flags allow incomplete features to be deployed safely but hidden from users.

Feature flags are product controls, not security controls.

## Relationship

Feature flags may be global or workspace-specific.

If `organisation_id` is null, the flag is global.

If `organisation_id` is populated, the flag applies to that workspace.

## Fields

| Field             | Type          | Nullable | Default             | Foreign Key        | Description                                                        |
| ----------------- | ------------- | -------: | ------------------- | ------------------ | ------------------------------------------------------------------ |
| `id`              | `uuid`        |       No | `gen_random_uuid()` | None               | Primary key for the feature flag.                                  |
| `key`             | `text`        |       No | None                | None               | Machine-readable feature key. Example: `project_tracking_enabled`. |
| `name`            | `text`        |       No | None                | None               | Human-readable feature name. Example: `Project Tracking`.          |
| `description`     | `text`        |      Yes | `null`              | None               | Explanation of what the feature flag controls.                     |
| `enabled`         | `boolean`     |       No | `false`             | None               | Whether the feature is enabled.                                    |
| `organisation_id` | `uuid`        |      Yes | `null`              | `organisations.id` | Optional workspace-specific override. Null means global.           |
| `created_at`      | `timestamptz` |       No | `now()`             | None               | Timestamp when the flag was created.                               |
| `updated_at`      | `timestamptz` |       No | `now()`             | None               | Timestamp when the flag was last updated.                          |

## Constraints

* `id` is the primary key.
* `key` must not be empty.
* Global flags should be unique by `key` where `organisation_id` is null.
* Workspace-specific flags should be unique by `key` and `organisation_id`.

## Initial Feature Flags

Suggested initial global flags:

| Key                          | Default | Description                                                          |
| ---------------------------- | ------: | -------------------------------------------------------------------- |
| `auth_enabled`               |  `true` | Enables authentication foundation behaviour once auth screens exist. |
| `project_tracking_enabled`   | `false` | Controls project tracking features.                                  |
| `programme_tracking_enabled` | `false` | Controls programme tracking features.                                |
| `portfolio_tracking_enabled` | `false` | Controls portfolio tracking features.                                |
| `monte_carlo_enabled`        | `false` | Controls Monte Carlo forecasting features.                           |
| `ai_reports_enabled`         | `false` | Controls AI-generated reporting features.                            |

---

# Table: `audit_log`

## Purpose

Records security-relevant and administration-relevant events.

Audit logging is required from the beginning to support traceability, troubleshooting and future compliance needs.

## Relationship

Audit records may relate to a workspace, user or entity.

`organisation_id` may be null for account-level events that occur before a workspace exists.

## Fields

| Field             | Type          | Nullable | Default             | Foreign Key        | Description                                                            |
| ----------------- | ------------- | -------: | ------------------- | ------------------ | ---------------------------------------------------------------------- |
| `id`              | `uuid`        |       No | `gen_random_uuid()` | None               | Primary key for the audit event.                                       |
| `organisation_id` | `uuid`        |      Yes | `null`              | `organisations.id` | Workspace affected by the event. Null for account-level events.        |
| `actor_user_id`   | `uuid`        |      Yes | `null`              | `auth.users.id`    | User who performed the action. Null for system-generated events.       |
| `action`          | `text`        |       No | None                | None               | Machine-readable event name. Example: `workspace.created`.             |
| `entity_type`     | `text`        |      Yes | `null`              | None               | Type of entity affected. Example: `profile`, `organisation`, `member`. |
| `entity_id`       | `uuid`        |      Yes | `null`              | None               | Identifier of the affected entity where applicable.                    |
| `old_values`      | `jsonb`       |      Yes | `null`              | None               | Previous values for changed fields.                                    |
| `new_values`      | `jsonb`       |      Yes | `null`              | None               | New values for changed fields.                                         |
| `ip_address`      | `text`        |      Yes | `null`              | None               | Optional IP address for security investigation.                        |
| `user_agent`      | `text`        |      Yes | `null`              | None               | Optional browser/device information.                                   |
| `created_at`      | `timestamptz` |       No | `now()`             | None               | Timestamp when the audit event was recorded.                           |

## Constraints

* `id` is the primary key.
* `organisation_id` references `organisations.id`.
* `actor_user_id` references `auth.users.id`.
* `action` must not be empty.

## Initial Audit Actions

Suggested initial audit action names:

* `user.registered`
* `user.email_verified`
* `user.logged_in`
* `user.logged_out`
* `user.password_reset_requested`
* `user.password_reset_completed`
* `workspace.created`
* `workspace.renamed`
* `workspace.archived`
* `member.invited`
* `member.joined`
* `member.role_changed`
* `member.suspended`
* `member.removed`
* `profile.display_name_changed`
* `feature_flag.updated`

---

# Required Database Functions

## Function: derive display name from email

Purpose:

Generate an initial display name from the email address.

Example:

`mark.nesbit@example.com`

becomes:

`Mark Nesbit`

This may be implemented as a database function or application helper.

For onboarding consistency, Codex should choose the simplest reliable implementation.

---

## Function: update `updated_at`

Purpose:

Automatically refresh `updated_at` timestamps when records are updated.

This should preferably be implemented as a reusable database trigger function.

---

# Required Onboarding Behaviour

When a new Supabase Auth user is created, the application must eventually create:

1. `profiles` record
2. `organisations` record
3. `organisation_members` owner record
4. `organisation_settings` record
5. `audit_log` records

However, the exact implementation point is to be decided in WT-001B or WT-001D.

Options include:

* Database trigger on `auth.users`
* Application-level onboarding transaction

Codex must not invent this behaviour without making the implementation choice explicit.

---

# Row Level Security Requirements

RLS must be enabled on all application-owned tables.

Initial policy intent:

## `profiles`

Users may read their own profile.

Workspace owners/admins may later read or manage member profiles where required.

## `organisations`

Users may read organisations where they have an active membership.

Owners/admins may update workspace settings according to role permissions.

## `organisation_members`

Users may read membership records for organisations where they have active membership.

Owners/admins may manage members, subject to owner-protection rules.

## `organisation_settings`

Users may read settings for organisations where they have active membership.

Owners/admins may update settings.

## `feature_flags`

Users may read enabled global flags and applicable workspace flags.

Only administrative/system flows may update feature flags.

## `audit_log`

Users should not generally update audit records.

Owners/admins may later view audit records for their workspace.

Audit logs should be append-only in normal application usage.

---

# WT-001B Migration Expectations

WT-001B should create migrations for:

1. Core enum/check constraints or equivalent validation
2. `profiles`
3. `organisations`
4. `organisation_members`
5. `organisation_settings`
6. `feature_flags`
7. `audit_log`
8. Updated timestamp trigger helper
9. Basic RLS enablement
10. Initial read policies where safe
11. Seed data for initial global feature flags if appropriate

WT-001B must not create:

* Login pages
* Registration pages
* Dashboard UI
* Project tables
* Programme tables
* Portfolio tables
* Forecast tables
* Import tables

---

# Open Implementation Questions

The following decisions should be confirmed during WT-001B or before WT-001D:

1. Should profile/workspace creation happen via database trigger or application onboarding logic?
2. Should audit log writes happen via database triggers, application service functions, or both?
3. Should `profiles.email` be kept in sync automatically with `auth.users.email`?
4. How should owner-protection rules be enforced initially?
5. Should initial RLS policies be read-only until application flows exist?

---

# Current Decision

For WT-001B, create the foundation schema and safe RLS baseline.

Do not yet implement full onboarding behaviour unless explicitly instructed.

The priority is to establish the database foundation safely and repeatably through migrations.

---

# Project Dates Addendum

WT-PROJ-DATES-001 adds `project_dates` and `project_date_comments` as structured, workspace-scoped project setup records.

`project_dates` belongs to one `organisation_id` and one `project_id`, with a composite foreign key back to `projects(id, organisation_id)`. Supported `date_type` category values are `project-start`, `target-end`, `review`, `gateway`, `milestone`, `uat`, `testing`, `load-testing`, `integration`, `deployment`, `cutover`, `training`, `go-live`, `hypercare` and `other`. `title` is required for display. `start_date` is the application-required Timeline start date for new records, while the legacy `target_date` column is retained during compatibility migration. `end_date` is optional and inclusive. `description` is optional. `status` is controlled separately from category with `scheduled`, `upcoming`, `started`, `complete`, `delayed`, `at-risk` and `cancelled`. `show_on_timeline` defaults true so existing records remain visible after migration. `warning_days` defaults to 14 so future configurable warning periods can be added without changing the table shape. `removed_at` is used for soft removal.

`project_date_comments` belongs to one project date and repeats `organisation_id` and `project_id` for explicit workspace/project scoping. A composite foreign key ensures comments cannot cross-link to a date from another project or workspace. Comments preserve author and timestamp and do not change the date itself.

Project dates now auto-populate the Project delivery layer of the Timeline through a transient adapter projection. The Timeline does not persist duplicate event rows. They do not replace Risks, Issues, Dependencies, Assumptions, Actions, Decisions or Project Narrative.

---

# Project Actions Addendum

WT-ACTION-001A adds the initial Project Actions data foundation through migration `20260712000200_project_actions_schema_foundation.sql`. WT-ACTION-001B adds controlled transactional lifecycle operations through migration `20260712000300_project_actions_transactional_lifecycle.sql`.

The Action schema is project and workspace scoped:

* `project_action_counters` allocates concurrency-safe per-project Action numbers.
* `project_actions` stores the one authoritative Action record.
* `project_action_history` stores immutable structured workflow history.

Action references are generated in the database from the owning project's immutable project reference:

```text
Action-{PROJECT_REF}-{NNN}
```

The initial source-type list is deliberately narrow: `project`, `risk`, `project_details` and `narrative`. Issue, Dependency, Assumption and Decision sources remain future work until those authoritative modules exist.

Viewer remains read-only. Authenticated users have select access only for Action records and history under active workspace membership. They do not receive direct insert, update or delete grants, and Actions do not have archive/delete fields.

All writes use explicit `security definer` RPCs that derive the actor from `auth.uid()`, validate workspace membership and role, lock the Action row, verify expected state, update the Action, append immutable history and return the updated Action in one database transaction. The RPC surface is intentionally named per operation rather than exposed as a generic update function:

* `create_project_action`
* `submit_project_action`
* `return_project_action_to_raiser`
* `reject_project_action`
* `return_project_action_to_actioner`
* `complete_project_action`
* `cancel_project_action`
* `assign_project_action`
* `amend_project_action_brief`
* `change_project_action_due_date`
* `reissue_project_action`
* `take_over_project_action_acceptance`

Owner, Admin and Member can create Actions. Only active Owner/Admin/Member profiles in the same workspace can be assigned as Actioner. Current eligible Actioners can submit, return to raiser or reject. Current acceptance owners can review, complete, return, cancel, reassign, amend, change due date and reissue. Active Owner/Admin users can take over acceptance ownership with a mandatory reason; the original raiser is not changed.

Valid workflow transitions are limited to the MVP matrix: create to `open`; Actioner response from `open` or `returned_to_actioner` to `submitted`, `returned_to_raiser` or `rejected_by_actioner`; acceptance-owner review from `submitted` to `complete` or `returned_to_actioner`; reissue from `returned_to_raiser` or `rejected_by_actioner` to `open`; cancellation from any non-terminal state; and Owner/Admin takeover without status change. `complete` and `cancelled` are terminal.

History is append-only for authenticated users. No authenticated update/delete grants are provided, and a trigger prevents non-service-role update/delete attempts.

WT-ACTION-002 adds the first authenticated Actions interface at `/app/workspaces/{workspaceSlug}/projects/{projectSlug}/actions` with detail pages at `/app/workspaces/{workspaceSlug}/projects/{projectSlug}/actions/{actionId}`. The register uses query-backed tabs, search, filters, sorting and pagination; direct register creation uses the controlled `create_project_action` RPC with Project as the source. Detail pages show read-only immutable history and expose only state-valid management controls backed by the WT-ACTION-001B RPCs. Viewer remains read-only. The complete Actioner response journey remains deferred to WT-ACTION-003.
