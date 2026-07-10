-- WT-RISK-GUIDE-005 prompt-created draft risk traceability.
-- Links draft project risks back to the controlled risk prompt that created them.

alter table public.project_risks
  add column if not exists source_risk_prompt_id uuid references public.risk_prompts(id);

comment on column public.project_risks.source_risk_prompt_id is
  'Nullable source prompt for risks created from the guided risk identification flow. Manual risks leave this null.';

create unique index if not exists project_risks_project_source_prompt_key
  on public.project_risks (project_id, source_risk_prompt_id)
  where source_risk_prompt_id is not null
    and deleted_at is null;

create index if not exists project_risks_source_risk_prompt_id_idx
  on public.project_risks (source_risk_prompt_id)
  where source_risk_prompt_id is not null;
