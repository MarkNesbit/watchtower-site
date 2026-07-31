# WT-IDENTITY-MEMBERSHIP-001B delivery note

## Delivered read contract

`workspace_member_directory` is now the canonical workspace-scoped person source. `src/lib/workspacePeople.ts` maps its database rows into a typed model that keeps Auth, profile and membership UUIDs separate. It provides a safe display label in the order name, display name, login name, then a membership-reference fallback; email is not used as a general person label.

The directory is limited to callers with an active membership in the requested workspace. It exposes no contact or authentication email and does not widen `profiles` RLS. `assignment_eligible` means an active, accepted workspace membership: invited, expired, suspended and deactivated memberships are excluded from new assignment options. The full scoped directory remains available to resolve retained historic selections.

## Updated surfaces

- Risk owner/actioner options and Risk/person/comment enrichment read the contract rather than `profiles`.
- Action responsibility options and Action label enrichment read the contract, including legacy Auth-ID-to-profile mapping for display only.
- Project People option labels and retained assignment labels read the contract.

Risks and Actions are now explicitly assignable to any eligible workspace member; project participation remains a separate concern.

## Deferred identity repair

This slice intentionally does not change write identifiers, Action RPC actor comparisons or `project_people.user_id` foreign-key semantics. The known split-ID Action actor/responsibility defect and Project People persistence defect remain follow-on work. No registration, invitation or workspace-bootstrap behaviour changed.
