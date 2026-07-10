-- WT-RISK-GUIDE-005 audit completeness for raised risks.
-- New manual and prompt-created project risks should carry both created_by and updated_by on insert.

create or replace function public.set_project_risk_audit_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Authenticated user is required for risk audit fields.' using errcode = '42501';
  end if;

  if tg_op = 'INSERT' then
    new.created_by = auth.uid();
    new.updated_by = auth.uid();
  elsif tg_op = 'UPDATE' then
    new.updated_by = auth.uid();
  end if;

  return new;
end;
$$;

comment on function public.set_project_risk_audit_fields() is
  'Binds project risk created_by and updated_by to auth.uid(). Inserts set both fields so raised-by and latest-updated-by are available immediately.';

revoke all on function public.set_project_risk_audit_fields() from public;
