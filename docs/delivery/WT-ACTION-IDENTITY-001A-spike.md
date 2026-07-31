# WT-ACTION-IDENTITY-001A — Action identity and lifecycle integrity spike

**Status:** Read-only investigation  
**Date:** 31 July 2026  
**Evidence:** Action migrations, Action UI/helpers, the prior identity assessment and focused Action tests. No production data, migrations or application behaviour were changed.

## 1. Executive summary

The Action lifecycle is not safe for accepted invitees whose Auth, profile and membership UUIDs differ. The schema defines person fields as profile foreign keys, while creation, history, audit triggers and every lifecycle permission helper obtain `auth.uid()` and use it as if it were that profile UUID. Equal-ID legacy accounts mask both the foreign-key failure and the permission-comparison failure.

Creation by a split-ID user fails before an Action row or history row can commit because `raiser_id`, `acceptance_owner_id`, `created_by` and `updated_by` receive the Auth UUID but reference `profiles(id)`. Where an Action somehow contains profile IDs, the split-ID Actioner, raiser and acceptance owner are not recognised because RPCs and both Action pages compare those profile IDs directly with Auth IDs. History has the same defect: `actor_user_id` references profiles but receives the Auth actor.

Workspace scoping is generally server-side and sound for currently usable equal-ID records. However, the identity mismatch makes the intended lifecycle unavailable to split-ID members and prevents the product self-approval rule from being reliably represented or enforced.

## 2. Current Action identity model

- `project_actions.raiser_id`, `actioner_id` and `acceptance_owner_id` reference `profiles(id)`.
- `project_actions.created_by` and `updated_by` also reference `profiles(id)`.
- `project_action_history.actor_user_id` references `profiles(id)`.
- There is no Action-specific audit-event table and no `submitted_by`, `approved_by`, `returned_by`, `rejected_by`, `completed_by`, `cancelled_by` or `reissued_by` column. The sole lifecycle actor record is the corresponding immutable history row.
- `project_action_require_authenticated_actor()` returns `auth.uid()`; all lifecycle functions name it `actor_id` and supply it to profile-keyed storage and comparisons.
- The canonical workspace-person reader is used for Action display and selectors, but it does not translate the authenticated caller to profile or membership identity before an Action comparison.

## 3. Person-field reference matrix

| Action field or operation | Stored identifier | Actual value supplied | Expected identifier | Permission comparison | Status | Evidence |
| --- | --- | --- | --- | --- | --- | --- |
| Raiser | `project_actions.raiser_id` → Profile | `auth.uid()` | Profile today; membership under target | profile field vs Auth actor in review UI/RPC indirectly | Broken split-ID write | `create_project_action` |
| Actioner | `project_actions.actioner_id` → Profile | UI selector supplies Profile | Profile today; membership under target | Profile field directly compared with Auth actor | Broken split-ID recognition | `listEligibleActioners`; `project_action_assert_current_actioner` |
| Acceptance owner / approver | `acceptance_owner_id` → Profile | creation/take-over supply Auth; initial Action defaults to raiser Auth | Profile today; membership under target | Profile field directly compared with Auth actor | Broken split-ID write and review | creation/take-over RPCs |
| `created_by` | Profile | insert trigger overwrites with Auth | Auth audit or Profile person, explicitly separated | none | Broken split-ID write | `prepare_project_action_insert` |
| `updated_by` | Profile | update trigger overwrites with Auth | Auth audit or Profile person, explicitly separated | none | Broken split-ID update | `set_project_action_update_audit_fields` |
| Submitted/returned/rejected/completed/cancelled/reissued actor | No Action-table column | Auth actor supplied to history | Auth audit plus optional Profile/Membership snapshot | lifecycle helper uses Auth directly | History FK fails for split IDs | lifecycle RPCs and `project_action_insert_history` |
| History actor | `project_action_history.actor_user_id` → Profile | `auth.uid()` | Auth audit or resolved Profile explicitly | display resolves profile/Auth aliases only after read | Broken split-ID history | history schema and helper |
| Audit-event actor | No Action audit table | Not applicable | Auth audit event if introduced | Not applicable | Missing audit model | schema inventory |

`project_action_history` event type has no distinct `approved` event: completion is the approval transition and uses `completed`. Green is therefore derived only after `complete`, not after `submitted`.

## 4. Action creation path

The Action page submits the selected Actioner option ID. The option source is `workspace_member_directory`, so it is a profile UUID and correctly excludes inactive/invited/suspended/deactivated members. The creation RPC derives the raiser and acceptance owner from `auth.uid()`, checks active workflow membership by comparing that Auth UUID to `organisation_members.user_id` (a profile UUID), then inserts the Auth UUID into four profile foreign keys. The insert trigger repeats that overwrite for `created_by` and `updated_by`.

For an equal-ID user the checks and foreign keys happen to succeed. For a split-ID creator, `project_action_assert_actor_can_create` rejects before insert because it searches `organisation_members.user_id = auth.uid()`; if that were corrected alone, the profile foreign keys would reject the insert. The history insert is in the same RPC transaction, so a history foreign-key error rolls back the Action row rather than silently omitting history.

## 5. Assignment and reassignment path

Initial assignment, assignment/reassignment, unassignment and reissue receive an Actioner ID from the profile-keyed selector. The server-side eligibility helper checks active `organisation_members.user_id`, role Owner/Admin/Member and target workspace, so it does not require `project_people` participation and rejects cross-workspace, invited, suspended and deactivated candidates.

The stored Actioner value is therefore profile-keyed, but all response checks compare it directly with Auth. Amendment, reassignment and reissue require the acceptance owner; that owner is also currently compared as profile versus Auth. The new Project People persistence repair does not change this Action contract.

## 6. Actioner permission path

`submit`, `return to raiser`, `reject`, and progress update call `project_action_assert_current_actioner`. It requires `actioner_id = actor_id`, where `actor_id` is `auth.uid()`, then tests active membership with the same Auth-to-profile mismatch. Consequently a split-ID Actioner cannot progress, submit, return or reject an otherwise correctly profile-assigned Action.

The register and detail pages independently use the same incorrect direct comparison for My Actions, default scope, response controls and direct-complete visibility. A workspace-person display may show the right name because the reader aliases profile and Auth IDs, but that display improvement does not authorise the Actioner.

## 7. Raiser and approver permission path

Review, return-to-actioner, completion, cancellation, amendment, due-date change, reassignment and reissue call `project_action_assert_acceptance_owner`, which compares `acceptance_owner_id` directly with Auth. Owner/Admin take-over also stores the Auth UUID in `acceptance_owner_id`. Split-ID raisers/approvers therefore cannot use the lifecycle.

The self-approval rule is not enforced. Creation sets acceptance owner to raiser, assignment permits the same person as Actioner, and no RPC rejects `actioner_id` resolving to the acceptance owner/raiser. An equal-ID user can submit then complete their own Action; a split-ID user instead encounters the earlier mismatches. This is a product-rule defect, not merely a display defect.

## 8. Lifecycle history and audit

Every lifecycle RPC writes history before returning. Since the history actor column is profile-keyed but receives Auth UUID, split-ID transitions either fail their prior permission check or, after a partial permission repair, fail history insertion and roll back the transition. No path swallows this failure; the transactional outcome is safer than partial state but unavailable to split IDs.

There is no separate Action audit table. `created_by` and `updated_by` ambiguously attempt to serve as profile references while triggers write Auth identity. History does not retain membership identity or a historical display snapshot, so later deactivation is only best-effort display through the workspace-person directory.

## 9. Split-ID test findings

Focused existing Action tests pass, but they test static migration/helper contracts and use equal identifiers. No repository fixture executes a complete lifecycle where Auth ID differs from profile and membership IDs.

Reasoned split-ID scenario: User A cannot create because active-member creation checks use A's Auth UUID against profile-keyed membership, and the raiser/acceptance-owner/profile audit inserts would reject it. If a service or historic record supplies profile IDs, User B appears by name but cannot see it in My Actions, update progress, submit, return or reject because B's Auth UUID does not equal stored Actioner profile UUID. User A cannot review for the same reason. History actor storage is also incompatible. The complete required lifecycle therefore **fails** for split-ID identities.

## 10. Security and workspace-isolation findings

Action and history reads use active workspace RLS. UI readers scope by organisation and project. Lifecycle RPCs lock the Action row, derive its organisation, and require the Auth actor to be active in that same workspace; candidate Actioners are checked against that same workspace. Project participation is not consulted. This prevents a person active only in another workspace from acting or being assigned.

The highest security issue is the missing self-approval guard. The identity defects currently deny split-ID users rather than grant cross-workspace access, but any remediation must resolve the caller to the active membership before responsibility comparison and must not add an Auth/Profile fallback that selects a membership in another workspace. Service-role tests are insufficient evidence because service execution bypasses normal caller identity/RLS context.

## 11. Confirmed defects

1. Creation writes Auth IDs into four profile foreign keys and fails for split-ID creators.
2. Active-member creation and Actioner eligibility helpers compare Auth IDs to profile-keyed membership `user_id`.
3. All Actioner and acceptance-owner lifecycle checks compare Auth IDs directly with profile responsibility IDs.
4. Action register/detail My Actions and controls repeat the same direct comparison client-side.
5. History actor and `updated_by` triggers write Auth IDs into profile foreign keys.
6. The self-approval rule is absent; equal-ID users can self-submit/self-complete when they are both Actioner and acceptance owner.
7. Existing tests do not execute the mandated split-ID lifecycle.

## 12. Data-integrity risks

No production counts were read. Before migration, run service-authorised, aggregate-only checks returning counts and UUID prefixes only for: Action person/audit fields that do not resolve to a profile; fields matching an Auth UUID but not the intended profile; responsibilities without a membership in the Action workspace; history actors without a resolvable person; Actioner/acceptance-owner pairs resolving to one person through different ID domains; active Actions assigned to inactive members; cross-workspace responsibility references; and lifecycle state changes without their expected history event.

Because current foreign keys normally reject mismatched Auth writes, live split-ID failures are expected chiefly as failed RPCs rather than corrupt committed Action rows. Legacy, service-created or constraint-bypassed records still require the aggregate check.

## 13. Recommended canonical contract

Use Auth ID only for the authenticated actor. Use Profile ID for global human attribution. Use workspace membership ID for current Action responsibilities (`actioner`, acceptance owner and, if product wants workspace-specific raiser responsibility). Each RPC must resolve `auth.uid()` to the caller's active membership in the Action workspace, compare membership IDs for responsibility, and write Auth actor plus optional resolved profile/membership values explicitly to history/audit.

The Action UI should receive the canonical workspace-person model and compare the current resolved membership ID, not raw Auth UUID. New assignment must require active accepted membership, not project participation. Historical labels should retain a profile/display snapshot or resolve retained membership data after deactivation. Add an explicit server-side prohibition on an Actioner approving their own Action after resolving both responsibilities to the same person/membership.

The present profile-keyed Action schema makes an incremental first slice safer than immediately converting every responsibility to membership IDs: first split Auth audit from Profile responsibility and centralise caller resolution, then migrate current responsibilities with compatibility/backfill evidence.

## 14. Proposed implementation slices

1. **WT-ACTION-IDENTITY-001B — identity resolver and audit correction.** Add one workspace-scoped Auth-to-profile/membership resolver; stop triggers/history from writing Auth into profile FKs; add explicit Auth actor fields; test all lifecycle RPCs with split IDs.
2. **WT-ACTION-IDENTITY-001C — responsibility contract migration.** Decide and migrate Actioner/acceptance-owner (and raiser if applicable) to membership UUIDs, retain profile/snapshot history, backfill/validate with aggregate evidence, and update indexes/FKs.
3. **WT-ACTION-IDENTITY-001D — lifecycle authority and self-approval.** Centralise permission checks on resolved active membership, update My Actions/detail controls, block self-approval server-side, and cover cross-workspace/deactivation cases.
4. **WT-ACTION-IDENTITY-001E — integrity remediation and observability.** Run approved aggregate diagnostics, remediate only categorised rows transactionally, validate deferred constraints, and add production-safe lifecycle failure telemetry.

## 15. Open product decisions

- Should raiser remain a global profile attribution or become the creator's workspace membership responsibility?
- Should acceptance owner default to raiser, or must a distinct eligible approver be chosen at creation?
- Is an Owner/Admin take-over allowed when it would make that person both Actioner and approver? Recommended: no, unless a documented exception uses a separate approver.
- What historical snapshot fields are required if a profile or membership is later deactivated/removed?
- Should Viewer remain excluded from Action assignment and response, as current workflow role logic does?

## Evidence index

- Action schema, RLS, profile foreign keys and audit triggers: `20260712000200_project_actions_schema_foundation.sql`.
- Lifecycle actor derivation, permissions, history and transitions: `20260712000300_project_actions_transactional_lifecycle.sql`.
- Current creation/due-date function definitions: `20260713000100_project_actions_optional_due_date.sql`.
- Progress transition: `20260714000100_project_action_progress_update.sql`.
- UI wrappers/read enrichment: `src/lib/projectActions.ts` and Action register/detail routes.
- Identity model context: `docs/delivery/WT-IDENTITY-MEMBERSHIP-001A-assessment.md`.
