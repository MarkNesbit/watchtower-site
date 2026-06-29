-- WT-RISK-003 risk actioner assignment foundation.
-- Adds a nullable primary actioner reference directly on project_risks for MVP assignment.
-- Full risk actions, multi-actioners, approvals, notifications, diary integration and health scoring remain future scope.

alter table public.project_risks
  add column if not exists actioner_id uuid references public.profiles(id);

comment on column public.project_risks.actioner_id is
  'Nullable primary risk actioner for MVP assignment. The actioner is responsible for carrying out mitigation, contingency, review or follow-up activity; the risk owner remains accountable for managing the risk. Future risk actions may model multiple actioners separately.';

create index if not exists project_risks_actioner_id_idx
  on public.project_risks (actioner_id);
