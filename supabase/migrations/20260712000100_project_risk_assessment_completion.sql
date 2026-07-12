alter table public.project_risks
	add column if not exists assessment_completed_at timestamptz,
	add column if not exists assessment_completed_by uuid references public.profiles(id) on delete set null;

comment on column public.project_risks.assessment_completed_at is
	'Timestamp set when a Draft risk receives an explicit probability and impact assessment. Existing compatibility defaults are not backfilled.';

comment on column public.project_risks.assessment_completed_by is
	'Profile that recorded the explicit probability and impact assessment for Draft activation readiness.';
