# Feature flags and preview access

**Status:** WT-US-0107 implementation reference

**Last updated:** 24 June 2026

**Related:** `src/lib/featureFlags.ts`, `src/lib/permissions.ts`, `supabase/migrations/20260624000200_feature_flags_preview_access.sql`

## Purpose

Watchtower uses global product feature flags to deploy incomplete capabilities safely. Feature availability is evaluated before a capability is shown or entered, while workspace membership, RBAC and Row Level Security continue to control access to workspace data and actions.

Feature flags are product controls, not a replacement for authentication or authorisation. Preview eligibility never creates workspace membership, changes an `owner`, `admin`, `member` or `viewer` role, or grants a write permission.

## Feature states

| State | Normal account | Approved preview account |
| --- | --- | --- |
| `hidden` | Not shown; direct route blocked | Not shown; direct route blocked |
| `disabled` | Shown inactive with “This capability is not available yet.” | Same |
| `preview` | Shown inactive with “This feature is not currently available to your account.”; direct route blocked | Available, subject to membership and RBAC |
| `enabled` | Available, subject to membership and RBAC | Available, subject to membership and RBAC |

Unknown keys, missing rows and malformed states resolve to `hidden`. This is the production-safe, fail-closed default.

The first end-to-end integration is `riskManagement`. Its project dashboard tile uses the central helper and the project Risk Management routes repeat the check on direct access. Guarded routes also require an active membership in the workspace named by the route and the relevant `risk.view`, `risk.create` or `risk.edit` permission. Viewers may view the available Risk Register and detail pages, but all risk create/edit actions remain disabled.

The project dashboard also uses `projectDiary` for the user-facing **Project Narrative** tile. Project Narrative is the project event/history/story layer and is separate from the date-and-milestone **Timeline** tile. Feature-gated tile handling is shared across both capability keys. WT-US-0207 does not add a Project Narrative route, so a visible tile stays inactive with the normal capability-unavailable treatment even when its flag would otherwise permit access; it never links to a missing destination.

## Initial feature keys

- `projectDiary`
- `riskManagement`
- `riskToDiary`
- `attentionItems`
- `healthDashboard`
- `manualHealthAdjustment`
- `issues`
- `dependencies`
- `assumptions`
- `forecasting`

The migration starts `riskManagement` in `preview`; all other new keys start `hidden`.

## Granting preview access

Preview eligibility is the account-level `profiles.can_access_preview_features` boolean. It is separate from workspace roles and defaults to `false`. There is deliberately no user-facing admin console in this story.

After confirming the nominated account email, an authorised database operator can grant access through the Supabase SQL editor:

```sql
update public.profiles
set can_access_preview_features = true,
    updated_by = id
where lower(email) = lower('nominated-account@example.com');
```

Replace the example email with Mark's nominated main account. Confirm that exactly one row was changed. Set the value back to `false` to revoke preview eligibility. Do not add preview users to workspace roles they do not otherwise need.

No preview-access environment variable is required or supported by this implementation.

## Adding a feature flag

1. Add a camel-case key to `FEATURE_KEYS` in `src/lib/featureFlags.ts`.
2. Add a global `feature_flags` row in a new migration. Start unreleased capability at `hidden` unless the product owner has explicitly chosen another state.
3. Call the central helper at each relevant navigation, tile or action location.
4. Repeat the central check in every direct server route; never rely on hidden or disabled UI alone.
5. Check active workspace membership and the relevant permission separately. Add or update RLS policies for any workspace-owned data.
6. Add tests for the state transition, direct route and RBAC interaction.

Do not read raw environment variables at feature call sites or use profile preview eligibility as an RBAC shortcut.

## Moving a feature through release states

Change state through a reviewed migration for normal delivery. For short-lived UAT validation in an explicitly controlled environment, an authorised database operator may update the global row:

```sql
update public.feature_flags
set state = 'hidden'
where key = 'riskManagement' and organisation_id is null;

update public.feature_flags
set state = 'disabled'
where key = 'riskManagement' and organisation_id is null;

update public.feature_flags
set state = 'preview'
where key = 'riskManagement' and organisation_id is null;

update public.feature_flags
set state = 'enabled'
where key = 'riskManagement' and organisation_id is null;
```

Use the progression `hidden` → `disabled` → `preview` → `enabled` when it fits the release plan. A capability may skip a presentation state if the product owner does not need it, but it must never become enabled merely because configuration is absent or invalid.

## Manual validation

1. Set `riskManagement` to `hidden`: confirm the tile is absent and the direct route returns the unavailable page with a blocked response.
2. Set it to `disabled`: confirm the tile is visible but inactive with “This capability is not available yet.” and the direct route is blocked.
3. Set it to `preview`: confirm a normal account sees an inactive tile and cannot enter the route; grant preview eligibility to a nominated account and confirm it can enter.
4. While using a preview-enabled Viewer account, confirm the New Risk and Edit Risk actions remain inactive and read-only helper text is shown.
5. While using a preview-enabled Owner, Admin or Member account, confirm the New Risk form opens and saves a risk with a generated reference.
6. Set it to `enabled`: confirm active workspace members can enter while Viewer write restrictions remain.
7. Delete the test row or set an invalid state in an isolated test database and confirm the helper treats the capability as hidden. Restore the reviewed state afterwards.

Subscription tiers, billing, organisation purchases, A/B testing, analytics and a feature-flag administration UI remain out of scope.
