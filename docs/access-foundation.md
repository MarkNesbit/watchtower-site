# User profile and access foundation

**Status:** WT-US-0105 validation reference  
**Last updated:** 22 July 2026
**Related:** `supabase/migrations/20260614000200_create_foundation_tables.sql`, `supabase/migrations/20260614000300_enable_rls_and_baseline_policies.sql`, `supabase/migrations/20260614000600_create_auth_onboarding.sql`, `supabase/migrations/20260722000300_workspace_profile_identity_backfill.sql`, `src/lib/permissions.ts`

## Purpose

Watchtower needs a reliable way to identify authenticated users in audit trails, ownership fields, assignments and future notification features without making permissions depend on profile data. Supabase Auth remains the account authority. Watchtower stores lightweight application profile records and derives access from active workspace membership and role.

WT-US-0105 is validation, documentation and test-focused. No schema migration is required because the existing foundation already separates account profile data from workspace membership and role data.

## Authenticated user

Supabase Auth owns account credentials, sign-up, login, password reset and email verification. Application code must not store Supabase service-role keys and must not bypass the existing auth flow.

A Watchtower account uses one primary email address. That email comes from the Supabase Auth user and is mirrored on the profile for display, audit and lookup convenience. Watchtower does not model multiple personal recovery email addresses on profiles. Future account recovery should be handled through an authorised admin/support process, not through additional profile-level recovery emails.

WT-WORKSPACE-TEAM-002 keeps this login behaviour unchanged but adds profile fields for future team administration: `first_name`, `last_name`, `login_name` and `contact_email`. WT-WORKSPACE-TEAM-004-FIX-001 backfills missing values for existing profiles and updates onboarding defaults for new profiles. `profiles.email` remains the current compatibility mirror of the Supabase Auth email. `contact_email` is the future contact/notification field and is not a login identifier in this slice. `login_name` is stored and uniquely constrained for future use, but login-name authentication is not implemented.

## Profile

A profile is account identity and audit metadata only. The current profile table is linked one-to-one to `auth.users.id` and includes:

- `id` — the Supabase authenticated user id.
- `email` — the primary account email.
- `display_name` — a user-facing display name, generated from email during onboarding when needed.
- `first_name` and `last_name` — nullable future team administration name fields, backfilled only where existing profile text safely resolves to exactly two name parts.
- `login_name` — nullable, case-normalised future login identifier with a unique normalised index. Missing login names are derived from existing display/email profile data, with deterministic `.02`, `.03` suffixes for duplicates.
- `contact_email` — nullable contact/notification email, backfilled from `email` where available. The backfill does not modify `auth.users.email`.
- `avatar_url` — nullable future-ready display metadata.
- `last_login_at` — nullable account activity metadata.
- `created_at` and `updated_at` timestamps.
- `created_by` and `updated_by` audit references.

Profiles deliberately do not store global roles, workspace roles, workspace permissions, recovery email addresses, platform superuser roles or delivery personas. WT-US-0107 adds only `can_access_preview_features`, a narrow platform-level product eligibility flag. WT-TEST-001 adds `is_internal_tester`, a restricted internal-utility eligibility flag for the Mark.Nesbit.Professional production test workspace only. Neither flag makes the profile a workspace permission source, and neither can bypass active membership, RBAC or RLS.

## Profile creation

When a Supabase user has verified their email, the onboarding trigger creates or refreshes the matching profile using the auth user id, primary email, derived display name, contact email, unique login name and safe first/last-name defaults where available. The same onboarding path also creates the user's default personal Workspace, adds an active owner membership and creates default organisation settings.

Because onboarding is keyed by the Supabase user id, each authenticated account has at most one profile record. If the auth email changes in future, the onboarding function can refresh the mirrored profile email without creating a second profile or modelling secondary email addresses.

## Workspace, organisation and membership

Watchtower user-facing language should normally say **Workspace**. The database and internal implementation currently use **organisation**.

Projects belong to a workspace/organisation. Users gain access to workspace-owned records through `organisation_members`, not through their profile. A membership links:

- a user id;
- an organisation/workspace id;
- a role;
- a membership status.

This means the same user can theoretically have different roles in different workspaces. Access checks must require an active membership, so invited, invite-expired, suspended or deactivated memberships do not grant workspace/project access.

WT-WORKSPACE-TEAM-002 migrates the legacy `removed` membership status to the product-facing `deactivated` lifecycle term and adds lifecycle timestamps and actor/reason fields for invitation expiry, acceptance, suspension, deactivation and reactivation.

## Fixed MVP roles

The fixed MVP workspace role model is:

- `owner`
- `admin`
- `member`
- `viewer`

These values are constrained on `organisation_members.role` and mirrored in the central application permission helper. They are not profile attributes.

For project permissions, owners and admins receive the full current project permission set. Members can currently view, create, view dashboard and edit project details where workspace settings allow member project creation. Viewers can view projects and dashboards but cannot create projects or edit project details.

## Permission source and helper direction

Permissions come from active workspace membership plus role. Profile fields must not grant permissions.

The current central TypeScript helper is `src/lib/permissions.ts`. It maps fixed workspace roles to project permissions and denies unknown values. Database Row Level Security uses membership-based helper functions such as `is_active_organisation_member` and `has_active_organisation_role`.

## Internal role simulation

WT-TEST-001 adds an internal-only role simulation utility under Account -> Test tools. It is scoped to the authorised Mark.Nesbit.Professional tester profile and the `mark-nesbit-professional-workspace` workspace slug. Simulation state is stored in `internal_role_simulations`, expires automatically after 4 hours, and is ignored when inactive, expired, unauthorised or outside the scoped test workspace.

Role simulation changes the effective role used by application permission helpers and the database `has_active_organisation_role` function. It does not update `organisation_members.role`, does not impersonate another user, does not create customer-facing permission management, and does not introduce a global admin capability. A persistent authenticated-app banner appears while simulation is active and provides reset back to real permissions.

WT-TEST-002 adds CSV demo people import and persona simulation to the same internal Test tools area. Imported demo people are stored in `workspace_demo_people`, scoped to the Mark.Nesbit.Professional test workspace, flagged as demo data, and never inserted into Supabase Auth or real `profiles`. The CSV import replaces demo people for the scoped workspace only and keeps real memberships untouched. Each demo person can carry a workspace role, project/persona metadata, and `notification_email` for future test notification routing. When a demo person is simulated, the real authenticated user remains Mark, while the demo person's role becomes the effective role for normal RBAC checks. Broad Mark/internal tester authority must stay explicit and must not silently override persona restrictions during simulated browsing.

Future organisation-level permission policies can extend this model by adding policy checks after active membership and fixed role have been established. They should not move permission decisions onto profiles and should not introduce user-configurable permission builders in MVP.

## Membership lifecycle administration foundation

WT-WORKSPACE-TEAM-002 adds controlled database functions for invitation, invitation expiry, activation, suspension, deactivation, reactivation and permitted profile identity correction. The functions derive the actor from `auth.uid()`, check the actor's real stored active membership role, lock the target membership row and write membership audit events.

These functions deliberately use real `organisation_members.role` rather than internal role simulation, so test simulation cannot bypass Owner/Admin protection. Admins can manage Members and Viewers only in this foundation slice. The final active Owner cannot be suspended, deactivated or demoted, and users cannot deactivate or suspend their own membership through the administration functions.

The slice also adds `workspace_member_directory` for same-workspace display identity without contact email and `workspace_member_admin_directory` for Owner/Admin future administration views that include contact/auth email fields. CSV export/import foundation tables are present for later slices, but no CSV files are generated, uploaded, parsed or applied by WT-WORKSPACE-TEAM-002.

## Workspace Team page foundation

WT-WORKSPACE-TEAM-003 adds the first read-focused Workspace Team page at `/app/workspaces/{workspaceSlug}/team`. The page is available only through the user's existing active workspace membership path and uses **Workspace** in user-facing copy while the database continues to use `organisation`.

The page reads `workspace_member_directory` for normal active workspace users. Owner/Admin users can read through `workspace_member_admin_directory` where the page needs administration-oriented lifecycle dates, but WT-WORKSPACE-TEAM-003 deliberately does not render contact email or auth email. Rows are identified by membership/profile UUIDs, never by email.

The page shows a safe membership directory with role, lifecycle state, relevant dates, simple state filters and search by name/login. The rendered lifecycle labels are `Active`, `Invited`, `Invitation expired`, `Suspended` and `Deactivated`; the database value `invite_expired` must not appear in the UI. Deactivated people remain visible for history as neutral inactive rows and use the display pattern `Jane Smith [deactivated]`.

For the Team page Login column, `login_name` is preferred. If it is absent, the page may fall back to `display_name` because that field is already exposed in the safe directory; it must not fall back to `profiles.email`, `contact_email`, `auth_email` or raw UUIDs for Member/Viewer visibility.

CSV update and membership-history controls are visible but disabled in this slice. Members and Viewers see an Owner/Admin-required explanation. WT-WORKSPACE-TEAM-003 does not implement mutation, invitation delivery, CSV generation, CSV parsing, CSV apply behaviour, login-name authentication, shared-contact-email authentication or service-role access.

## Workspace Team CSV export and advisory checkout

WT-WORKSPACE-TEAM-004 enables Owner/Admin CSV export from `/app/workspaces/{workspaceSlug}/team` through the server-side POST route `/app/workspaces/{workspaceSlug}/team/export`. The route resolves the requested workspace through the current user's active membership, requires the real stored role to be Owner or Admin, calls the controlled database function `create_workspace_membership_csv_export`, and returns a UTF-8 CSV download.

Editable exports create a `workspace_membership_export_runs` record, persist normalised `workspace_membership_export_rows`, record a deterministic `membership_snapshot_version`, and start a 24-hour advisory checkout. Read-only exports create their own versioned snapshot and audit event but use `export_mode = read_only`, do not start checkout, and cannot replace the active editable export. Expired or superseded exports remain historical but do not block a new editable export.

The checkout is advisory, not a database lock on membership changes. The database remains authoritative, and future upload validation must compare the file's `export_id` and `membership_snapshot_version` with the current database state. Transactional enforcement uses a security-definer RPC with a workspace-scoped advisory transaction lock and row locking on active export runs, so two concurrent editable requests cannot both create an active editable checkout. Takeover requires explicit confirmation, marks the earlier editable export as superseded, links the new export through `takeover_of_export_id`, and writes supersession/takeover audit events.

The current checkout holder can select the user-facing `Undo` action from the active checkout notice. Internally this calls `release_workspace_membership_csv_checkout` through the POST route `/app/workspaces/{workspaceSlug}/team/export/release`; the operation is a holder-only checkout release with `release_source = holder_undo`. It sets release metadata, removes the export from the active checkout position and writes a `workspace_membership_csv_checkout_released` audit event, but it does not delete the export record, snapshot rows, import evidence, review decisions or the user's downloaded CSV. Another active Owner/Admin can immediately create a new editable export after release.

CSV filenames use `watchtower-workspace-team-{workspace-slug}-{YYYYMMDD-HHmm}-{mode}.csv`. Columns are stable and repeated on every row: `export_id`, `membership_snapshot_version`, `exported_at`, `export_mode`, `workspace_membership_id`, `user_id`, `login_name`, `first_name`, `last_name`, `email`, `workspace_role`, `membership_status`, `invited_at`, `invitation_expires_at`, `accepted_at`, `last_login_at`, `added_at`, `deactivated_at`, `reactivated_at`, `proposed_membership_action`. The CSV `email` column maps to `profiles.contact_email`; the Supabase authentication email mirror is deliberately not exported.

Snapshot versions are deterministic hashes over membership UUID, profile UUID, first name, last name, login name, contact email, last login timestamp, role, membership status and invitation/activation/suspension/add/deactivation/reactivation timestamps. They are not derived from `exported_at`.

CSV cells are RFC-4180 escaped and formula-injection protected. Values beginning with `=`, `+`, `-` or `@` are prefixed with a single quote in the exported file. Successful browser exports wait for the server response, trigger the CSV download, close the export dialog and refresh after editable export or takeover so the current checkout notice is visible. Failed exports keep the dialog open and show an accessible retryable error. WT-WORKSPACE-TEAM-005 reverses that leading quote only when validating imported values that were formula-protected by export.

WT-WORKSPACE-TEAM-004 does not implement CSV upload, parsing, comparison, approval or membership mutation. WT-WORKSPACE-TEAM-005 adds upload, parsing, validation and comparison evidence only. These slices do not implement invitation delivery, Supabase Auth account creation, role change UI, profile correction UI, audit history UI, shared-email login or password-flow changes.

## Workspace Team CSV upload validation

WT-WORKSPACE-TEAM-005 enables Owner/Admin users to upload an amended editable Workspace Team CSV to `/app/workspaces/{workspaceSlug}/team/import`. The route is POST-only, workspace-scoped and requires the user's real active Owner/Admin membership. Members, Viewers and inactive memberships cannot upload or read import evidence.

Upload validation uses the WT-004 export contract exactly and does not accept undocumented column aliases. Only editable exports can enter the change-validation journey. Read-only exports are rejected, superseded editable exports are rejected, expired editable checkouts produce a warning, and stale source snapshots remain comparable against current live Workspace Team data.

Released editable exports are retained as historical evidence but cannot be uploaded for membership administration. WT-WORKSPACE-TEAM-005 rejects a released file with a clear message to download a new editable export. Uploading a released file never restores current-checkout status, and any later replacement export remains the valid source for the next editing journey.

The import path uses a Workers-compatible CSV parser and Web Platform byte APIs rather than Node-only globals. It supports quoted commas, escaped quotes, CRLF/LF, quoted line breaks, Unicode text, blank values and UTF-8 BOM. Uploaded values are normalised by trimming surrounding whitespace, converting optional blanks to null, normalising email/role/action casing and preserving raw values for diagnostics.

Formula-safety reversal is limited to Watchtower's own export protection. If an exported value beginning with `=`, `+`, `-` or `@` was prefixed with a single quote by WT-004 and still matches the stored source snapshot, upload validation reverses that protection and records the reversal. Newly introduced formula-like text remains data, is never executed, and is escaped by normal page rendering.

Existing retained rows are identified by immutable membership UUID plus user/profile UUID. Email and row number never identify an existing person. Existing rows may propose first-name, last-name and contact-email corrections only. Login name, role, membership status, export metadata and lifecycle timestamps are protected fields; edits to those fields are validation conflicts.

New-person rows must leave membership UUID, user UUID, login name, lifecycle timestamps and status blank. They require first name, last name and valid contact email. A blank role defaults to Viewer; an invalid non-blank role is an error. General workspaces reject duplicate contact email for different people. The designated immutable internal test workspace may allow duplicate contact email for validation purposes only; email still never resolves identity.

Removed source rows are classified as proposed deactivations only after structural validation succeeds. Retained deactivated rows remain unchanged unless `proposed_membership_action` is explicitly set to `reactivate` for that existing deactivated membership. Upload validation creates `workspace_membership_import_runs` and `workspace_membership_import_rows` evidence with file hash, raw/normalised values, source/live snapshots, field differences, summary counts and audit events. It does not approve or apply changes.

WT-WORKSPACE-TEAM-005 does not implement approvals, final confirmation, membership application, profile mutation, role changes, invitation delivery, Supabase Auth user creation, password links, reassignment actions, CSV history UI, shared-contact authentication or restricted-project access.

## Workspace Team CSV change review and approval

WT-WORKSPACE-TEAM-006 enables Owner/Admin users to review a validated upload at `/app/workspaces/{workspaceSlug}/team/imports/{importRunId}/review`. Review is workspace-scoped and requires the user's real active Owner/Admin membership. Member, Viewer, inactive and cross-workspace access is denied by route checks, RLS and controlled database functions.

The review page groups proposed additions, identity corrections, deactivations, reactivations and invalid/protected rows. Unchanged rows stay suppressed. Additions show first name, last name, contact email, requested/effective role and Viewer defaults. Corrections show only changed name/contact-email fields and repeat that contact-email correction does not change Supabase authentication login. Deactivation and reactivation cards show current role/state/lifecycle context and preliminary responsibility impact counts from current reliable schema.

Every valid material proposal starts as `pending` in `workspace_membership_change_decisions`. Decisions are recorded through `record_workspace_membership_change_decision(decision_id, decision, reason)` as `approved`, `excluded` or `keep_active`; protected, superseded, blocked and no-longer-required states cannot be approved. Revisions before final confirmation increment `decision_version` and append `decision_history` with actor, previous/new decision, reason, timestamp and live snapshot. Direct authenticated insert/update grants on the decision and import-run tables remain revoked in favour of the controlled functions.

Live recalculation runs before rendering review cards and again before final confirmation. It checks that the source export/import is still eligible, the membership still exists in the workspace, the membership/user pairing still matches, role/status/profile values remain current, duplicate contact-email state has not introduced a conflict, protected Owner/Admin changes remain blocked, self-deactivation is denied and the final active Owner is protected.

WT-WORKSPACE-TEAM-006/007-FIX-002 persists bulk review draft choices on the existing decision rows through `review_selected`, `review_draft_reason`, `review_draft_updated_by` and `review_draft_updated_at`. Valid proposals default selected. Switching a proposal off or on, or adding an exclusion comment, saves through `save_workspace_membership_review_draft_selection`; this records draft state only and does not create final approval/exclusion audit events. Browser refresh, deployment refresh or accidental navigation reloads the saved draft state for the same import, so no CSV re-upload is required merely because the modal was closed or the page refreshed. Another authorised Owner/Admin sees the saved draft state; Member, Viewer, inactive and cross-workspace requests are denied by the same workspace-scoped checks.

Final confirmation calls `confirm_workspace_membership_change_set(import_run_id)`. It requires every valid proposal to be decided, reruns live recalculation, blocks approved stale/protected/no-longer-required proposals, stores `approved_change_set`, `approved_change_set_summary`, `approved_change_set_version`, canonical `approved_live_snapshot_version`, legacy `approved_change_set_snapshot_version`, `approval_locked_at` and sets the import to `approved_for_application`. `approved_live_snapshot_version` is the exact decimal text returned by `current_workspace_membership_snapshot_version_text`; application code must not convert it through JavaScript number parsing or JSON numeric transport. This is the WT-007 handoff state only: no profile, auth, invitation, membership lifecycle, role or reassignment mutation is applied by WT-WORKSPACE-TEAM-006.

WT-WORKSPACE-TEAM-006/007-FIX-001 adds deliberate recovery for already-approved imports whose approved live snapshot was not recorded or no longer matches live state. The Team page shows `Re-review required` and an active `Re-review approved changes` action while keeping Apply disabled. No CSV re-upload is required while the proposals remain valid. Re-review preserves the current approved/excluded choices, reruns live recalculation, then calls `reconfirm_workspace_membership_approved_change_set` to record the current exact `approved_live_snapshot_version`, increment the approved set version and write `membership_change_set_reconfirmed` audit evidence with previous/new versions and previous/new snapshots, including null previous snapshots. No membership, profile, auth or invitation delivery mutation occurs during reconfirmation. The production migration deployment is required before repairing production approved imports; the fix deliberately does not silently backfill missing approved snapshots.

WT-WORKSPACE-TEAM-007-FIX-001 makes transactional application use the same bounded internal shared-contact policy as validation and review: `apply_workspace_membership_change_set` calls `public.is_internal_role_simulation_workspace(p_organisation_id)` before rejecting duplicate approved addition contact email. For normal workspaces, duplicate contact email remains a blocking application error and the transaction commits no partial membership, profile, auth or handoff changes. For the designated internal workspace, the current 28 approved additions may share `Mark.Nesbit.Professional@gmail.com` as communication metadata only; WT-007 still creates 28 distinct profiles, 28 distinct memberships, 28 unique pending login/auth identities and 28 invitation handoff records, while the two excluded rows remain untouched. Application audit/run metadata records `shared_contact_exception_applied`, the policy source and the count of additions using shared contact without repeating the contact email in general application metadata. Invitation delivery remains separate.

## Workspace Team CSV transactional application

WT-WORKSPACE-TEAM-007 adds the controlled apply step for a confirmed import. The Team page shows an application summary only for imports in `approved_for_application`, compares the locked `approved_live_snapshot_version` with the current live snapshot and posts to `/app/workspaces/{workspaceSlug}/team/imports/{importRunId}/apply`. The confirmation says that the operation will either complete in full or make no changes; if the approved set includes additions, it also states that new members will be created in an invited state and invitation delivery will follow separately.

The route delegates to `apply_workspace_membership_change_set(p_organisation_id, p_import_run_id, p_operation_key)`. The function requires the actor's real active Owner/Admin membership, serialises concurrent attempts, uses the frozen `approved_change_set` stored by WT-006 and ignores any client-supplied proposal list. It revalidates the import state, source export, approved decision versions, live snapshot and target membership/profile values before any membership or profile row is changed.

Application is all-or-nothing inside the database transaction. Approved additions create the profile/contact-email record, create an invited workspace membership and write a pending invitation handoff marker. Historical WT-007 migrations created a pending Supabase Auth identity by inserting a minimal placeholder `auth.users` row directly with a synthetic `@pending.watchtower.invalid` auth email; WT-008A-FIX-005 treats those rows as unusable until a supported Supabase Auth Admin flow creates a real email identity. Invitation delivery remains separate: WT-007 does not send emails, create password links or expose tokens. Profile corrections update only `first_name`, `last_name` and `contact_email`; login name, profile UUIDs, membership UUIDs and role remain unchanged. Deactivation and reactivation reuse the existing membership row, preserve evidence and write lifecycle audit events.

Excluded proposals remain untouched. Snapshot drift, superseded source exports, changed decisions, changed targets, duplicate additions, protected roles, self-deactivation and known responsibility impact stop the apply before membership/profile/auth mutation and record application-run/audit evidence. Successful application sets the import to `applied`, records `workspace_membership_change_application_runs`, writes per-change and batch audit events and leaves export rows, import rows, snapshots and decisions available as historical evidence.

WT-WORKSPACE-TEAM-007-FIX-002 releases the source editable checkout only after successful application finalisation. The database derives the source export from `workspace_membership_import_runs.source_export_id`, never from browser input, and releases only an active editable checkout by setting `status = released`, `editing_mode = none`, `released_at`, `released_by`, `release_source = application_completed` and `release_reason = Approved Workspace Team changes applied successfully.` It writes `workspace_membership_csv_checkout_released` audit evidence with the source export, import run, application run, previous holder, prior expiry and release source. Already released, expired, superseded, missing or read-only source exports are safe no-ops and do not create duplicate release events. If checkout release cannot be recorded, the application rolls back under the existing transaction rollback path; failed or rolled-back applications keep the checkout active. A forward repair in the production migration also releases any still-active source checkout for already-applied imports. Validation, approval, re-review and holder Undo do not release through `application_completed`, and invitation delivery remains separate.

WT-WORKSPACE-TEAM-008 adds secure invitation delivery, acceptance and activation on top of the WT-007 handoff. The new `workspace_membership_invitations` lifecycle is deliberately separate from `organisation_members.status`: delivery state can be `pending_delivery`, `sending`, `delivered`, `delivery_failed`, `opened`, `accepted`, `expired`, `cancelled` or `superseded`, while membership remains `invited` until successful acceptance moves it to `active`. Delivery alone does not activate workspace access.

Invitation acceptance is the only user-facing activation path through the membership lifecycle guard. The acceptance RPC verifies the current invitation, signed-in Auth UUID, profile UUID, membership UUID, role and invited membership state before setting the same transaction-local lifecycle marker pattern used by other controlled membership functions. The original WT-008 identity-preparation guard exception was intentionally limited to invitation expiry metadata; activation is a separate invariant because accepting an invitation changes workspace access.

Invitation preparation uses `prepare_workspace_membership_invitations(organisation_id, membership_ids, idempotency_key, token_hashes)`. The browser can select memberships but cannot supply role, profile identity, auth user identity, expiry or delivery strategy. The RPC derives the existing profile, membership, intended role, contact email and WT-007 handoff evidence from the database, stores only SHA-256 token hashes, applies one current invitation per membership and supersedes older current links on resend. Tokens are generated server-side by the route, kept only in memory long enough to build the email link and are invalidated after acceptance, cancellation, supersession or expiry.

Normal workspace invitation delivery uses the invited profile's unique `contact_email` as the recipient and authentication email only when no conflicting auth account exists. If another Supabase Auth account already owns the intended auth email, WT-008 records `existing_account_link_required` and blocks automatic linking; email may locate a candidate account but does not authorise identity linking. If duplicate contact emails are detected outside an explicit delivery policy, WT-008 records `shared_contact_policy_required` and leaves each row retryable.

Internal shared-contact testing is supported only through a locked `workspace_invitation_delivery_policies` row with the `internal_gmail_alias` strategy. Follow-up migration `20260723001200_workspace_invitation_internal_delivery_policy.sql` seeds that row once for the configured internal workspace by using the existing server-side internal workspace control, then stores the policy by `organisation_id` and prevents update/delete. Runtime delivery preparation trusts only that locked row, so a later workspace rename does not enable or disable the policy. The strategy preserves the shared `contact_email`, generates the auth and delivery alias from the configured base mailbox, policy prefix, login name and profile UUID suffix, and never infers mode from workspace name, slug, email domain or duplicate email occurrence.

The server route `/app/workspaces/{workspaceSlug}/team/invitations/send` supports bulk send, individual send, retry, resend and cancellation for real active Owners/Admins. WT-WORKSPACE-TEAM-008A sends both HTML and plain-text invitation content through Resend using server-side Worker configuration only: `WATCHTOWER_EMAIL_PROVIDER=resend`, `WATCHTOWER_RESEND_API_KEY`, sender fields and `WATCHTOWER_SITE_URL=https://watch-tower.co.uk`. The acceptance URL is generated from that production HTTPS origin rather than browser request origin. Before calling the provider the database claims the pending invitation as `sending`, which preserves retry/idempotency and avoids duplicate provider handoffs for the same current invitation. Provider acceptance is recorded as sent/awaiting acceptance; it does not prove mailbox delivery and does not activate workspace access. Without valid provider configuration WT-008A records `provider_not_configured` as `delivery_failed` rather than claiming success. A bounded `WATCHTOWER_INVITATION_DELIVERY_MODE=test_record_only` mode can mark delivery as recorded for internal validation without exposing tokens in logs or browser output.

WT-WORKSPACE-TEAM-008A-FIX-005 provisions invitation Auth identities through the server-side Supabase Auth Admin API before delivery or password setup links are attempted. It reports identity-less historical invitation users with `workspace_invitation_identityless_auth_user_report(organisation_id)`, which returns UUIDs, statuses and email domain only. If the existing placeholder Auth row cannot be used, Watchtower creates a valid temporary internal Auth user, transactionally remaps only explicit `auth_user_id` links on the profile, membership and current invitation, verifies the malformed placeholder Auth user is identity-less, password-less, unreferenced by Auth linkage and not linked to an active membership, hard-deletes that placeholder to release the deterministic alias, and then assigns the alias to the replacement. `profiles.id` and `organisation_members.user_id` remain the original Watchtower profile/person UUIDs; `profiles.auth_user_id`, `organisation_members.auth_user_id` and `workspace_membership_invitations.auth_user_id` hold the sign-in Auth UUID. Repair is idempotent, service-role only, audited in `workspace_invitation_auth_identity_repairs`, and never writes to `auth.identities` directly.

The public `/invitations/accept` page validates the opaque token hash before showing safe invitation details. Valid details are limited to workspace name, invited person/login, intended role and expiry. Acceptance calls `accept_workspace_membership_invitation(token_hash)` as the signed-in linked auth identity; a different signed-in account is blocked. The activation transaction locks the invitation and membership, rechecks token validity, verifies the auth user/profile/membership relationship, marks the invitation accepted, moves the membership to `active`, preserves the approved role and writes audit events. Replayed, expired, cancelled and superseded links cannot activate membership.

WT-008 audit events include `workspace_invitation_prepared`, `workspace_invitation_delivery_attempted`, `workspace_invitation_delivered`, `workspace_invitation_delivery_failed`, `workspace_invitation_opened`, `workspace_invitation_expired`, `workspace_invitation_cancelled`, `workspace_invitation_superseded`, `workspace_invitation_accepted`, `workspace_membership_activated` and `workspace_invitation_replay_rejected`. Audit metadata records workspace, invitation, membership, profile, actor, status movement, delivery strategy, recipient domain, attempt/version, sanitized provider name/message id and failure code without storing raw tokens, passwords, provider secrets, raw provider responses or full email bodies.

## Workspace Team individual member role management

WT-WORKSPACE-TEAM-009A restricts the Workspace Team page to active Workspace Owners and Admins. Members and Viewers do not receive the navigation link and direct route access returns a guarded unavailable state. Database functions continue to use real active membership, not profile flags or internal role simulation, for membership administration authority.

Active memberships render as green interactive person pills that open a member details modal. Invited memberships render as amber non-interactive pills and do not open the modal. The modal displays full name, login name, contact email, workspace role, membership status, invitation status, joined/invited/accepted dates and last login when available. Profile UUIDs, membership UUIDs and authentication email are not displayed in the standard interface, and first name, last name, login name and contact email remain read-only.

Role changes are handled by the controlled `change_workspace_member_role(organisation_id, membership_id, target_role, expected_snapshot_version, edit_session_id)` function. Owners may assign Viewer, Member, Admin or Owner to another active member. Owners cannot change their own role. Admins may change Viewers and Members only between Viewer and Member; they cannot assign Admin or Owner, cannot alter Admins or Owners and cannot change their own role. The browser only shows permitted options, but the RPC independently validates every transition and rejects cross-workspace, inactive, invited, self-change and unauthorised direct requests.

The modal uses `workspace_member_edit_sessions` for an advisory membership-scoped edit session. A second Owner/Admin can still view current member information, but role controls become read-only while another active session exists and the modal names the current editor. Sessions release on modal close, cancel or successful save and expire automatically so abandoned browser sessions cannot permanently block a member.

Role saves include the current workspace membership snapshot version. If membership data changed after the modal opened, the RPC rejects the save rather than overwriting newer data. Successful saves update `organisation_members.role`, set `updated_by`, refresh `updated_at` through the existing trigger and record a `workspace_membership_role_changed` audit event with previous role, new role, actor and timestamp. Failed and cancelled modal changes do not create completed role-change audit events.

WT-WORKSPACE-TEAM-009A does not edit profile identity, send/resend/cancel invitations, deactivate/reactivate/suspend memberships, add responsibility-impact summaries, add audit-history UI, create project-specific roles, add an ownership-transfer wizard or change the CSV workflow.

## Workspace Team individual member deactivation

WT-WORKSPACE-TEAM-009B extends the active-member modal with a permitted `Deactivate user` journey. Owners may deactivate another active Viewer, Member, Admin or Owner, while Admins may deactivate only active Viewers and Members. Self-deactivation, invited/inactive/deactivated memberships, cross-workspace memberships and unauthorised direct requests are rejected by the server-side RPC rather than relying on the visible modal controls.

Before confirmation, the modal shows a high-level responsibility-impact summary for reliable current schema references: active risks owned, active risk action responsibilities, outstanding actions assigned and actions awaiting the member's approval. These counts are informational only and do not block deactivation by themselves. Project-role responsibility counts are deliberately marked unavailable while `WT-PROJECT-TEAM-DEFECT-001` remains open, so the modal does not present those counts as reliable.

Deactivation requires the existing membership-scoped advisory edit session, a current workspace membership snapshot version and a mandatory free-text reason of 500 characters or fewer. The save transaction revalidates actor authority, selected active membership, session ownership, final active Owner protection, stale snapshot state and the responsibility summary before changing the membership lifecycle state to `deactivated`. It records `deactivated_at`, `deactivated_by`, `deactivation_reason`, update metadata and a `membership_deactivated` audit event sourced from `workspace_member_modal_deactivation`.

WT-WORKSPACE-TEAM-009B does not edit profile identity, authentication identity or email fields, delete users, alter historical project/risk/action/comment/narrative references, perform responsibility reassignment, implement reactivation, fix project member assignment persistence, send notifications, expose audit history or change the CSV workflow.

## Future concepts not implemented in MVP

The following concepts are recognised as possible future needs but are explicitly not implemented by WT-US-0105:

- rich profile page;
- profile avatar upload UI;
- multiple email addresses per account;
- personal recovery email addresses;
- Single Sign-On;
- Multi-Factor Authentication;
- notification preferences;
- organisation-level permission configuration UI;
- custom permission builder;
- Watchtower platform admin or global superuser;
- delivery persona-driven permissions.

Account-level preview eligibility is implemented as a product availability control and is documented separately in `docs/feature-flags.md`; a platform admin role or superuser permission remains out of scope.

Delivery personas may later support onboarding, dashboards, templates or AI assistance. They must remain product metadata unless a future story intentionally changes the permission model.

## Follow-up backlog notes

No broad access-control refactor was required for WT-US-0105. As the product adds more domains, new write paths should continue to route role decisions through central helpers and RLS membership functions, with any duplicated permission checks consolidated in small follow-up tasks.
