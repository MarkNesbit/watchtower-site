# WT-ACTION-IDENTITY-001C3 — Actioner workflow conversion

**Status:** Implemented; combined C1–C5 release remains blocked.

`save_project_action_progress`, `submit_project_action` and direct `complete_project_action` now resolve the caller with the C1 workspace identity resolver and compare the caller membership to the active membership resolved from the profile-keyed Actioner field. Progress is Actioner-only. Submission requires `approval_required` and an active, distinct Approver. Direct completion requires an Actioner and no Approver.

All converted writes use explicit Auth, Profile and Membership history attribution in one transaction. Direct completion records `completion_route: direct`; submission remains outstanding. Returned Actions (`returned_to_actioner`) may receive progress and be resubmitted by the same Actioner. The profile-keyed responsibility columns and C2 audit compatibility fields remain until 001D.

Approval, return authority, rejection, cancellation, amendments, reissue and takeover are unchanged for C4/C5. Manual split-ID acceptance was not run because no live split-ID fixture environment is available. Do not deploy C1–C3 independently.

**Narrative:** WT-ACTION-IDENTITY-001C3 completed — Actioner workflow identity repaired. Watchtower Actioners can now progress, directly complete or submit Actions using workspace membership authority without relying on equal Auth and Profile UUIDs. Unassigned Actions are blocked from work, direct completion is available only where no Approver exists, and Returned Actions can be amended and resubmitted with complete transactional history.
