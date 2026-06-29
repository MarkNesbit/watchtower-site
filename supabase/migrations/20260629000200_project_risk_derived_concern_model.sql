-- WT-RISK-005: derived risk concern model.
-- Keep the stored rag_status column for compatibility while the app derives concern
-- from exposure and assurance signals.

update public.project_risks
set status = 'closed'
where status = 'accepted';

alter table public.project_risks
  drop constraint if exists project_risks_status_check;

alter table public.project_risks
  add constraint project_risks_status_check
  check (status in ('draft', 'open', 'monitoring', 'mitigating', 'escalated', 'materialised', 'closed'));

comment on column public.project_risks.rag_status is
  'Legacy/transitional stored concern value retained for compatibility. Application UI derives risk concern from probability, impact and assurance signals.';
