# WT-ACTION-IDENTITY-001C2 — Action creation and responsibility management

**Status:** Implemented; combined release remains blocked pending C3–C5.

## Converted surface

- `create_project_action`
- `assign_project_action` (assign, replace and clear Actioner)
- `set_project_action_approver` (appoint, replace and clear Approver before submission)

Each resolves the authenticated caller with `resolve_action_identity` for the Action workspace. Selected Actioner and Approver values are workspace membership IDs. The migration validates an active membership in that workspace, translates it to the legacy profile ID only at the write boundary, and never requires a `project_people` assignment for eligibility.

## Authority and integrity

The Raiser, or an active Project Manager, Product Owner or Delivery Manager project assignment, may manage responsibilities. The server rejects unauthenticated, ambiguous, inactive and cross-workspace identities. Actioner and Approver membership IDs cannot match; Raisers may be either responsibility. Replacement updates and their history run in one transaction, so a failed validation leaves the previous holder intact.

`project_actions` remains profile-keyed for `raiser_id`, `actioner_id` and `acceptance_owner_id` until 001D. C2 adds only explicit Auth audit compatibility columns and history actor membership attribution. `approval_required` records whether a new Action has an appointed Approver while the legacy non-null acceptance-owner column is retained. These are compatibility fields, not a responsibility storage migration.

## Lifecycle boundary

Creation, self-assignment, unassigned Actions, optional due dates and optional Approvers are safe at the C2 boundary. Progress, submission, direct completion, approval, return, rejection, cancellation, amendment and reissue remain on legacy identity semantics and are deliberately unmodified. C3 can reuse the C2 resolver, membership-to-profile translator and atomic history pattern.

## Deferred work and deployment

Dashboard queues, notifications, deactivated-Approver escalation, host-linked Actions and the membership-based responsibility persistence migration remain deferred. Do not deploy 001B, C1 or C2 independently; production validation requires the combined C1–C5 lifecycle release.

## Narrative

**WT-ACTION-IDENTITY-001C2 completed — Action creation and responsibility identity repaired.** Watchtower can now create Actions and manage Actioner and Approver responsibilities using workspace membership authority without relying on equal Auth and Profile UUIDs. Self-raised and unassigned Actions are supported, non-project-team workspace members remain eligible, responsibility changes are atomic and Actioner/Approver overlap is blocked server-side.
