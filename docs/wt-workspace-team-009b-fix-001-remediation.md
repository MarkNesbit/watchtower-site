# WT-WORKSPACE-TEAM-009B-FIX-001 Production Remediation

This note records the safe remediation pattern for the fallback workspace defect.
It is intentionally parameterised and must not be run until the affected rows
have been reviewed in production.

## Defect Shape

A previously accepted workspace member may have triggered verified-user
onboarding after deactivation. The unsafe trigger treated the Auth identity as a
first-time account and created:

- a personal workspace owned by the affected Auth UUID;
- an active Owner membership for that personal workspace;
- a duplicate profile row keyed by the Auth UUID rather than the retained
  workspace person/profile UUID.

The legitimate workspace membership, Auth user and original profile/person row
must be retained.

## Read-Only Assessment

Use the affected person's known login name or profile name to confirm the
legitimate membership row and any workspaces created by the linked Auth UUID.
Do not rely on workspace-name matching alone.

```sql
with affected_profiles as (
  select p.id, p.auth_user_id, p.first_name, p.last_name, p.login_name
  from public.profiles p
  where lower(coalesce(p.login_name, '')) = lower(:login_name)
),
affected_auth as (
  select auth_user_id from affected_profiles where auth_user_id is not null
  union
  select om.auth_user_id
  from public.organisation_members om
  join affected_profiles ap on ap.id = om.user_id
  where om.auth_user_id is not null
)
select
  'membership' as row_type,
  ap.id as profile_id,
  om.id as membership_id,
  om.role,
  om.status,
  o.id as workspace_id,
  o.name as workspace_name,
  o.slug,
  o.type,
  o.created_by
from affected_profiles ap
join public.organisation_members om on om.user_id = ap.id
join public.organisations o on o.id = om.organisation_id
union all
select
  'created_workspace' as row_type,
  null,
  null,
  null,
  null,
  o.id,
  o.name,
  o.slug,
  o.type,
  o.created_by
from affected_auth aa
join public.organisations o on o.created_by = aa.auth_user_id
order by row_type, workspace_name;
```

## Cleanup Pattern

Only use this pattern after confirming all IDs. The cleanup must target only the
unintended personal workspace and its fallback Owner membership. It must not
touch the legitimate retained profile/person row, the legitimate workspace
membership, the Auth user, invitation evidence or membership audit history. Keep
the duplicate Auth-keyed profile row as evidence unless a separate approved
cleanup has confirmed every reference.

```sql
begin;

-- Required review parameters:
-- :fallback_workspace_id
-- :fallback_membership_id
-- :duplicate_profile_id
-- :affected_auth_user_id

-- Confirm the fallback workspace is personal and was created by the affected
-- Auth UUID.
select id, name, slug, type, created_by
from public.organisations
where id = :fallback_workspace_id
  and type = 'personal'
  and created_by = :affected_auth_user_id
for update;

-- Confirm the fallback membership is the active Owner membership in only that
-- fallback workspace.
select id, organisation_id, user_id, auth_user_id, role, status
from public.organisation_members
where id = :fallback_membership_id
  and organisation_id = :fallback_workspace_id
  and user_id = :duplicate_profile_id
  and role = 'owner'
  and status = 'active'
for update;

-- Confirm the duplicate profile is keyed by the Auth UUID and is not the
-- original workspace person/profile row.
select id, auth_user_id, login_name
from public.profiles
where id = :duplicate_profile_id
  and id = :affected_auth_user_id
for update;

-- Prefer a soft workspace removal if the product schema supports deleted_at.
update public.organisations
   set deleted_at = now()
 where id = :fallback_workspace_id
   and type = 'personal'
   and created_by = :affected_auth_user_id;

update public.organisation_members
   set status = 'deactivated',
       deactivated_at = coalesce(deactivated_at, now()),
       deactivation_reason = coalesce(deactivation_reason, 'Invalid fallback workspace created by WT-WORKSPACE-TEAM-009B-FIX-001 defect remediation.')
 where id = :fallback_membership_id
   and organisation_id = :fallback_workspace_id
   and user_id = :duplicate_profile_id
   and role = 'owner'
   and status = 'active';

-- Do not delete the duplicate profile in this first remediation. It may be
-- referenced by the fallback membership/audit evidence and should remain until
-- a separately approved cleanup proves it is safe to remove.

rollback;
```

Change `rollback` to `commit` only after the selected rows and foreign-key
references have been reviewed and the product owner has approved remediation.
