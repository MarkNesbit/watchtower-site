# WT-ACTION-IDENTITY-001C4 — Approval and governance workflow

**Status:** Implemented; production deployment remains blocked pending C5.

C4 converts approval (`complete_project_action` from Submitted), return, rejection, submitted Approver replacement and Approver self-withdrawal. Each resolves the caller through C1, resolves profile-keyed responsibilities to active memberships, and records Auth, Profile and Membership attribution atomically. Approved completion records `completion_route: approved`; direct completion remains the C3 no-Approver path.

Only the current active Approver can approve, return, reject or withdraw. Actioner/Approver overlap fails closed. Submitted replacement preserves submission; withdrawal returns the Action to Open, removes the approval requirement and never completes it automatically. Owner/Admin takeover remains deferred for C5 because it requires a safe shared governance-authority boundary.

Cancellation, amendments, due-date changes, reissue, dashboard escalation and live split-ID manual acceptance remain deferred. Do not deploy C1–C4 independently.

**Narrative:** WT-ACTION-IDENTITY-001C4 completed — approval and governance identity repaired. Watchtower can now approve, return and reject Actions through workspace membership authority without relying on equal Auth and Profile UUIDs. Approver replacement and withdrawal are transactional, former or inactive Approvers lose authority immediately, Actioner self-approval is blocked server-side, and approved completion is recorded distinctly from direct completion.
