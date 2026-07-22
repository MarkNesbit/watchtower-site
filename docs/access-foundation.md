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

CSV filenames use `watchtower-workspace-team-{workspace-slug}-{YYYYMMDD-HHmm}-{mode}.csv`. Columns are stable and repeated on every row: `export_id`, `membership_snapshot_version`, `exported_at`, `export_mode`, `workspace_membership_id`, `user_id`, `login_name`, `first_name`, `last_name`, `email`, `workspace_role`, `membership_status`, `invited_at`, `invitation_expires_at`, `accepted_at`, `last_login_at`, `added_at`, `deactivated_at`, `reactivated_at`. The CSV `email` column maps to `profiles.contact_email`; the Supabase authentication email mirror is deliberately not exported.

Snapshot versions are deterministic hashes over membership UUID, profile UUID, first name, last name, login name, contact email, last login timestamp, role, membership status and invitation/activation/suspension/add/deactivation/reactivation timestamps. They are not derived from `exported_at`.

CSV cells are RFC-4180 escaped and formula-injection protected. Values beginning with `=`, `+`, `-` or `@` are prefixed with a single quote in the exported file. Successful browser exports wait for the server response, trigger the CSV download, close the export dialog and refresh after editable export or takeover so the current checkout notice is visible. Failed exports keep the dialog open and show an accessible retryable error. WT-WORKSPACE-TEAM-005 should normalise that leading quote back only when validating imported values that were formula-protected by export.

WT-WORKSPACE-TEAM-004 does not implement CSV upload, parsing, comparison, approval or membership mutation. It also does not implement invitation delivery, Supabase Auth account creation, role change UI, profile correction UI, audit history UI, shared-email login or password-flow changes.

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
