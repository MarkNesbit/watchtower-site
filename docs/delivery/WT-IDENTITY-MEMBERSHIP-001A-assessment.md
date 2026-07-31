# WT-IDENTITY-MEMBERSHIP-001A — Identity, registration and membership relationship assessment

**Status:** Read-only assessment
**Date:** 31 July 2026
**Evidence:** repository migrations, application code and focused existing tests. No production data was read or changed.

## 1. Executive summary

Watchtower now has three intended UUIDs: `auth.users.id` for sign-in, `profiles.id` for the person, and `organisation_members.id` for that person's workspace membership. This is a sound direction, but the July invitation work deliberately made profile and Auth UUIDs diverge while several older delivery paths still assume they are the same.

The resulting contract is inconsistent in four material places:

- Risk owner/actioner storage correctly uses profile UUIDs, but their selectors load profiles directly. Profile RLS permits only the caller's own profile, so same-workspace names often fail to enrich and deliberately fall back to `Workspace member <reference>`.
- Project People UI submits `workspace_member_directory.profile_id`, but `project_people.user_id` remains an FK to `auth.users.id`. For an accepted invitation with distinct IDs, the insert is rejected; the preceding removal update can leave the role empty. This confirms the reported non-persistence.
- Action tables are profile-keyed, but their actor comparisons use `auth.uid()`/Auth UUIDs. An invited person with different UUIDs cannot reliably create, respond to, manage, or be displayed in Actions. Creation attempts to put the Auth UUID in `raiser_id`, `acceptance_owner_id`, audit and history columns that reference profiles.
- New direct registrations still write the legacy equal-ID shape and omit the newer `auth_user_id` linkage fields; accepted invitations use the split-ID shape. Compatibility fallbacks mask this difference instead of resolving it.

The proposed canonical direction is suitable, subject to one adjustment: a project participation record should reference `organisation_members.id` (not merely profile ID), while person/audit references that identify a human may retain `profiles.id`. This gives workspace-specific eligibility and makes multi-workspace history unambiguous.

## 2. Current identity model

- **Authentication identity:** `auth.users.id` is canonical for authentication and is returned by `auth.uid()` / `auth.getUser()`.
- **Person/profile:** `public.profiles` is the canonical person record. `profiles.id` was originally both the profile and Auth UUID; `20260723001800` intentionally removes that dependency. `profiles.auth_user_id` is now the explicit nullable, unique Auth link (`20260723001600`). Therefore one Auth user can have at most one linked profile, but a profile can have no linked Auth user.
- **Workspace membership:** `organisation_members.id` is the membership UUID. `user_id` is now documented as the immutable profile UUID; `auth_user_id` identifies the account able to use it. The legacy `(organisation_id, user_id)` uniqueness and newer `(organisation_id, auth_user_id)` uniqueness prevent duplicates within one workspace, not across workspaces.
- **Person name:** `first_name + last_name`, then `display_name`, then `login_name` are the directory order. Older delivery helpers often only request `display_name, email`; the Risk form then renders its explicit `Workspace member ${id.slice(0, 8)}` fallback.

The workspace directory view is the one existing workspace-scoped person projection. It joins membership to profile and is restricted to an active member of that workspace. In contrast, the baseline `profiles` select policy is `id = auth.uid()`. That direct lookup is incompatible with a split-ID accepted invitee.

## 3. Registration and invitation journeys

| Journey | Auth user | Profile | Workspace membership | Workspace creation | Risk or concern |
| --- | --- | --- | --- | --- | --- |
| Normal registration | `signUp`; verified-user trigger uses Auth UUID | Created with `id = Auth UUID`; current trigger omits `auth_user_id` | Active Owner; current trigger omits `auth_user_id` | Personal workspace if no membership lifecycle | Preserves legacy equal-ID shape; login-name reset cannot resolve it from `profiles.auth_user_id`. |
| Imported/invited new person | Initial placeholder Auth record, later server-side valid Auth provisioning/remap | Created before delivery; profile UUID is preserved | Invited; then `auth_user_id` is remapped | None | Split IDs are intended, but break legacy profile/Auth assumptions. |
| Invited existing Auth user | Provisioning can discover a matching Auth email | Remap guard rejects an Auth user already linked to another profile | Cannot safely remap if the Auth user is already linked | None | No demonstrated supported path to add an existing Watchtower person to a second workspace through this invitation flow. |
| Acceptance | Must equal invitation `auth_user_id` | Reused; no new profile | Invited → active, with `accepted_at`/`joined_at` | None | Guard checks invitation, membership, profile, role and Auth linkage atomically. |
| Repeated acceptance/callback | Same Auth user | Reused | No second activation | None | Token is cleared and state is no longer acceptable; replay is rejected/audited. |
| Deactivated sign-in | Existing Auth user | Reused | No active membership returned | None | `/app/no-active-workspace` is the intended result. Existing accidental personal fallbacks are filtered in routing, not repaired. |

`complete_verified_user_onboarding` is idempotent for the historic equal-ID journey but was also the source of unsafe fallback workspaces. The current `20260731000500` version returns before bootstrap when any retained membership lifecycle exists and when an existing linked profile differs from Auth UUID. It runs on verification-state change, not on every sign-in; routing must therefore remain active-membership based.

## 4. Workspace membership lifecycle

The supported states are `invited`, `invite_expired`, `active`, `suspended` and `deactivated`. Invitation, acceptance, suspension and reactivation timestamps/actors are present. The acceptance guard requires the membership's `user_id`, `auth_user_id`, role and organisation to match the invitation, so a newly accepted membership should have a named profile and an Auth link.

Historic records remain a risk: the profile foreign key on `organisation_members.user_id` was recreated `NOT VALID` after the Auth/profile split. Existing invalid rows are not retroactively checked. `auth_user_id` is nullable and ordinary registration continues to rely on the `auth_user_id IS NULL AND user_id = auth.uid()` compatibility rule.

## 5. Project participation path

`project_people` is the project participation/project-role table. It has project and workspace scope, one real person or demo persona, active/removed status, and an active-workspace-member validation trigger. Project participation does not grant access; normal access remains workspace RBAC.

The UI option source is correct for the new model: `listProjectPersonOptions` reads `workspace_member_directory` and submits `user:<profile_id>`. The save helper validates the same profile UUID against `organisation_members.user_id` and inserts it into `project_people.user_id`. However, `20260630000200_project_people_assignments.sql` defines that column as `references auth.users(id)` and no later migration changes it. This is a confirmed write/schema mismatch for split-ID people. It fails at the insert; because the helper removes the existing active role before inserting, a failed replacement can also make a previously shown assignment disappear.

Project participation is not required by Risks or Actions. Both selectors use eligible active workspace members, not `project_people`, so project-role assignment presently has no bearing on delivery responsibility eligibility.

## 6. Responsibility reference matrix

| Area | Stored identifier | Expected identifier | Display-name source | Status | Evidence |
| --- | --- | --- | --- | --- | --- |
| Risk owner/actioner | `project_risks.owner_id` / `actioner_id`: profile UUID | Profile UUID today; membership UUID under target contract | Direct `profiles` lookup, then `Workspace member <ref>` | Broken display | Risk schema; `src/lib/projectRisks.ts` `listRiskOwnerOptions` and `enrichRiskProfiles`; `RiskForm.astro`. |
| Project roles | `project_people.user_id`: Auth UUID FK | Helper submits profile UUID; target: membership UUID | `workspace_member_directory` keyed by profile UUID | Confirmed write failure for split IDs | `20260630000200`; `src/lib/projectPeople.ts`. |
| Action raiser | Profile UUID FK | RPC supplies Auth UUID | Direct `profiles` lookup | Confirmed schema/RPC mismatch | `project_actions` schema; `create_project_action`. |
| Action actioner | Profile UUID FK | Selector and assignment RPC use profile UUID; response/UI comparisons use Auth UUID | Direct `profiles` then membership enrichment | Broken actor matching/display | `listEligibleActioners`; action assignment and response RPCs. |
| Action acceptance owner | Profile UUID FK | RPC supplies Auth UUID | Direct `profiles` lookup | Confirmed schema/RPC mismatch | Action schema and creation/authorisation functions. |
| Action history actor/audit | Profile UUID FK | RPC supplies Auth UUID | Direct `profiles` lookup | Confirmed schema/RPC mismatch | `project_action_history` and workflow RPCs. |
| Project/date/narrative audit fields | Mixed: several tables reference profiles while triggers use `auth.uid()`; read-state uses Auth UUID | Must be explicitly classified as audit actor vs person | Mostly direct `profiles` lookup | High-risk adjacent inconsistency | Risk/narrative/date migrations; expand only in follow-on inventory. |

## 7. Confirmed defects and inconsistencies

1. **Risk responsibility labels are not workspace-directory labels.** The code reads active membership profile IDs, then attempts a direct profile read. Same-workspace profile visibility is not granted by RLS, errors are swallowed, and the form deliberately shows the short-reference fallback. This fully explains the observed label.
2. **Project team replacement cannot persist for split identities.** The selector and client validation use profile ID; the database still accepts only Auth UUID. The UI says saved only on success, but a failed insert follows removal of the old active assignment.
3. **Actions are internally inconsistent after the Auth/profile decoupling.** `create_project_action` derives `actor_id` from `auth.uid()` then inserts it into profile-FK fields; response/UI comparisons also compare Auth actor to profile-held Action responsibility. This did not fail in the equal-ID model but is incompatible with an accepted/remapped invited member.
4. **Normal registration leaves the explicit linkage nullable.** The final onboarding definition inserts profile/membership `id`/`user_id` from `new.id` but does not set `auth_user_id`, while login-name and invitation paths require the explicit column. Compatibility succeeds, contract clarity does not.
5. **Existing-user multi-workspace invitation remains unresolved.** The repair guard deliberately prohibits attaching a replacement Auth user already linked to another profile; there is no evidence of a separate “reuse profile/create membership” journey.

## 8. Data-integrity risks

No production query credentials or approved target were supplied, so this assessment does not make claims about live counts. Before any refactor, run a service-role, read-only, aggregate-only integrity report for:

- memberships whose `user_id` has no profile; profiles with null/missing `auth_user_id`; memberships whose `auth_user_id` differs from the linked profile;
- duplicate non-null `profiles.auth_user_id`, `(organisation_id, user_id)`, or `(organisation_id, auth_user_id)` relationships;
- active/accepted memberships missing expected lifecycle dates or with no current accepted invitation where one is required by the invitation path;
- `project_people.user_id`, risk owner/actioner and Action person fields that cannot resolve to the identifier type their current foreign key/consumer expects;
- personal workspace/Owner memberships created for an Auth UUID that also has a retained invited, suspended or deactivated membership lifecycle.

Return only category counts and anonymised UUID prefixes. Preserve full rows, Auth emails, tokens and invitation hashes outside the report.

## 9. Security and workspace-isolation findings

Workspace isolation is generally sound: RLS checks active membership through `is_active_organisation_member`, updated to recognise `auth_user_id` with a legacy fallback. The directory view scopes profile display to the caller's active workspace. Risk and Action selector eligibility is also workspace-scoped by `organisation_id` and active status.

The weakness is not cross-workspace access but inconsistent joins and swallowed profile-read failures. Direct `profiles` selects are too narrow for shared workspace display and produce unusable labels. Service-role invitation provisioning can bypass RLS by design; it is protected by service-role-only RPCs, but it masks the differing-ID paths from normal-user testing. A person active in one workspace and deactivated in another is correctly eligible only where active, provided the consumer uses membership status rather than its bare profile/Auth UUID.

## 10. Recommended canonical contract

Adopt the proposed direction with these precise rules:

1. `auth.users.id` is authentication only. Store it in `profiles.auth_user_id` and `organisation_members.auth_user_id`; make the relationship non-null for authenticable people after legacy remediation.
2. `profiles.id` is immutable global person identity. It supplies person attributes and historical attribution, never workspace authority.
3. `organisation_members.id` is immutable workspace-person identity. It is the required reference for project participation and current delivery responsibilities.
4. `project_people` references membership ID for real people (demo identity remains a separate discriminator). It validates active status and project/workspace scope atomically.
5. Risk and Action current assignee/owner fields reference membership ID. Project eligibility is a separate validation; historical snapshots or retained profile IDs should support display after deactivation.
6. Every UI label receives one workspace-scoped person view model: membership ID, profile ID, Auth ID only when needed internally, lifecycle/eligibility, role and resolved display label. No delivery screen reads `profiles` directly for another member.
7. Audit columns must be explicitly split: `actor_auth_user_id` for authenticated actor, optionally `actor_profile_id`/snapshot for human display. Do not overload one UUID field.

This contract is unsuitable only if Watchtower requires one person to hold multiple independent memberships in the same workspace; current unique constraints expressly disallow that. The existing migration history means a transition must retain legacy profile/Auth reads temporarily, not reinterpret existing UUID values in place.

## 11. Proposed follow-on slices

1. **WT-IDENTITY-001B: identity-read contract.** Build one secure membership-person view/model; replace direct cross-user `profiles` reads in Risk, Actions and Project People; add split-ID fixtures.
2. **WT-PROJECT-TEAM-DEFECT-001: participation persistence.** Decide/implement the membership foreign key, make replacement atomic, backfill/validate existing assignments and prevent remove-before-insert loss.
3. **WT-ACTION-IDENTITY-001: Action actor and responsibility remediation.** Separate Auth actor from profile/membership assignee fields across Action RPCs, history, UI comparisons and tests.
4. **WT-IDENTITY-001C: registration/invitation convergence.** Always write explicit Auth linkage, provide an existing-person/multi-workspace invitation journey, and remove only proven-safe compatibility fallbacks.
5. **WT-IDENTITY-001D: integrity migration and observability.** Run approved aggregate audit, remediate categories transactionally, validate deferred constraints, and add operational diagnostics.

## 12. Open decisions requiring product-owner agreement

- Should a person have a single global profile across all workspaces (recommended), and should invitation of an existing Watchtower person reuse it rather than create a new profile?
- **Product decision (WT-IDENTITY-MEMBERSHIP-001B):** risks and Actions are assignable to any accepted, active member of the same workspace. Project participation is a separate project-team concern and is not an eligibility prerequisite. Invited, expired, suspended and deactivated memberships are excluded from new selectors; retained historic responsibilities remain nameable.
- Should deactivated people remain visibly named on historic responsibilities (recommended), or be anonymised? This determines whether snapshot fields are mandatory.
- Is `project_people` one primary holder per role sufficient, or are multiple current holders required? The current partial unique index allows only one primary active role holder.
- When a legacy direct registration has null `auth_user_id`, should it be repaired automatically during sign-in or through a controlled data migration? A controlled migration is safer.

## Evidence index

- Identity split and explicit links: `supabase/migrations/20260723001600_workspace_invitation_valid_auth_identity_provisioning.sql` and `20260723001800_workspace_invitation_auth_placeholder_release.sql`.
- Registration/bootstrap guard: `supabase/migrations/20260731000500_prevent_deactivated_user_workspace_fallback.sql`; workspace resolver: `src/lib/projects.ts`.
- Directory/RLS: `20260614000300_enable_rls_and_baseline_policies.sql` and `20260722000100_workspace_membership_lifecycle_audit_schema.sql`.
- Project People mismatch: `20260630000200_project_people_assignments.sql`; `src/lib/projectPeople.ts`; `src/pages/app/workspaces/[workspaceSlug]/projects/[projectId]/details.astro`.
- Risk display mismatch: `src/lib/projectRisks.ts`; `src/components/app/RiskForm.astro`.
- Action mismatch: `20260712000200_project_actions_schema_foundation.sql`; `20260712000300_project_actions_transactional_lifecycle.sql`; `src/lib/projectActions.ts`.
