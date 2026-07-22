# User profile and access foundation

**Status:** WT-US-0105 validation reference  
**Last updated:** 23 June 2026  
**Related:** `supabase/migrations/20260614000200_create_foundation_tables.sql`, `supabase/migrations/20260614000300_enable_rls_and_baseline_policies.sql`, `supabase/migrations/20260614000600_create_auth_onboarding.sql`, `src/lib/permissions.ts`

## Purpose

Watchtower needs a reliable way to identify authenticated users in audit trails, ownership fields, assignments and future notification features without making permissions depend on profile data. Supabase Auth remains the account authority. Watchtower stores lightweight application profile records and derives access from active workspace membership and role.

WT-US-0105 is validation, documentation and test-focused. No schema migration is required because the existing foundation already separates account profile data from workspace membership and role data.

## Authenticated user

Supabase Auth owns account credentials, sign-up, login, password reset and email verification. Application code must not store Supabase service-role keys and must not bypass the existing auth flow.

A Watchtower account uses one primary email address. That email comes from the Supabase Auth user and is mirrored on the profile for display, audit and lookup convenience. Watchtower does not model multiple personal recovery email addresses on profiles. Future account recovery should be handled through an authorised admin/support process, not through additional profile-level recovery emails.

WT-WORKSPACE-TEAM-002 keeps this login behaviour unchanged but adds profile fields for future team administration: `first_name`, `last_name`, `login_name` and `contact_email`. `profiles.email` remains the current compatibility mirror of the Supabase Auth email. `contact_email` is the future contact/notification field and is not a login identifier in this slice. `login_name` is stored and uniquely constrained for future use, but login-name authentication is not implemented.

## Profile

A profile is account identity and audit metadata only. The current profile table is linked one-to-one to `auth.users.id` and includes:

- `id` — the Supabase authenticated user id.
- `email` — the primary account email.
- `display_name` — a user-facing display name, generated from email during onboarding when needed.
- `first_name` and `last_name` — nullable future team administration name fields.
- `login_name` — nullable, case-normalised future login identifier with a unique normalised index.
- `contact_email` — nullable contact/notification email, initially backfilled from `email` where available.
- `avatar_url` — nullable future-ready display metadata.
- `last_login_at` — nullable account activity metadata.
- `created_at` and `updated_at` timestamps.
- `created_by` and `updated_by` audit references.

Profiles deliberately do not store global roles, workspace roles, workspace permissions, recovery email addresses, platform superuser roles or delivery personas. WT-US-0107 adds only `can_access_preview_features`, a narrow platform-level product eligibility flag. WT-TEST-001 adds `is_internal_tester`, a restricted internal-utility eligibility flag for the Mark.Nesbit.Professional production test workspace only. Neither flag makes the profile a workspace permission source, and neither can bypass active membership, RBAC or RLS.

## Profile creation

When a Supabase user has verified their email, the onboarding trigger creates or refreshes the matching profile using the auth user id, primary email and derived display name. The same onboarding path also creates the user's default personal Workspace, adds an active owner membership and creates default organisation settings.

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
