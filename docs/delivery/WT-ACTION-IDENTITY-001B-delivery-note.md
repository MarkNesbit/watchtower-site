# WT-ACTION-IDENTITY-001B delivery note

Action reads now resolve the authenticated account to an explicit Profile and active workspace Membership through `src/lib/actionIdentity.ts`. My Actions and Action detail ownership presentation use the resolved Profile ID only as a named temporary compatibility translation for existing profile-keyed Action columns.

Resolution fails closed for no authenticated account, no workspace membership, ambiguous membership, and ineligible lifecycle state. It uses the workspace-person directory, does not require project participation, and does not widen Profile RLS.

No Action responsibility or audit storage changed. Creation and lifecycle RPCs remain known split-ID defects because they still compare/write Auth and Profile IDs incorrectly; WT-ACTION-IDENTITY-001C must convert them transactionally.

Narrative: WT-ACTION-IDENTITY-001B completed — canonical Action identity resolver. Watchtower can resolve authenticated users for Action reads and ownership presentation without equal UUID assumptions; lifecycle writes remain deferred to 001C.
