-- WT-RISK-GUIDE-001 risk prompt library foundation.
-- Adds global reference-data tables for the Watchtower Default Risk Prompt Library.
-- User-facing upload, download, editing and workspace overrides are intentionally future scope.

create table public.risk_prompt_libraries (
  id uuid primary key default gen_random_uuid(),
  risk_library_key text not null,
  risk_library_version text not null,
  name text not null,
  description text,
  is_default boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint risk_prompt_libraries_key_version_key unique (risk_library_key, risk_library_version),
  constraint risk_prompt_libraries_key_not_empty check (length(btrim(risk_library_key)) > 0),
  constraint risk_prompt_libraries_version_not_empty check (length(btrim(risk_library_version)) > 0),
  constraint risk_prompt_libraries_name_not_empty check (length(btrim(name)) > 0)
);

comment on table public.risk_prompt_libraries is
  'Global reference-data risk prompt library versions. The MVP uses one Watchtower Default library seeded from a controlled repository CSV.';
comment on column public.risk_prompt_libraries.risk_library_key is
  'Stable product-controlled library key from the repository CSV, for example watchtower-default.';
comment on column public.risk_prompt_libraries.risk_library_version is
  'Product-controlled library version from the repository CSV, for example 1.0.';

create table public.risk_prompt_areas (
  id uuid primary key default gen_random_uuid(),
  risk_prompt_library_id uuid not null references public.risk_prompt_libraries(id) on delete cascade,
  risk_area_key text not null,
  risk_area_title text not null,
  risk_area_order integer not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint risk_prompt_areas_library_area_key unique (risk_prompt_library_id, risk_area_key),
  constraint risk_prompt_areas_library_order_key unique (risk_prompt_library_id, risk_area_order),
  constraint risk_prompt_areas_key_not_empty check (length(btrim(risk_area_key)) > 0),
  constraint risk_prompt_areas_title_not_empty check (length(btrim(risk_area_title)) > 0),
  constraint risk_prompt_areas_order_positive check (risk_area_order > 0)
);

comment on table public.risk_prompt_areas is
  'Ordered risk areas/categories within a risk prompt library version.';

create table public.risk_prompts (
  id uuid primary key default gen_random_uuid(),
  risk_prompt_library_id uuid not null references public.risk_prompt_libraries(id) on delete cascade,
  risk_prompt_area_id uuid not null references public.risk_prompt_areas(id) on delete restrict,
  risk_prompt_id text not null,
  risk_prompt_title text not null,
  risk_prompt_guidance text not null,
  risk_prompt_order integer not null,
  risk_prompt_is_active boolean not null default true,
  risk_default_status text not null default 'draft',
  risk_source_reference text,
  risk_tags text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint risk_prompts_prompt_id_key unique (risk_prompt_id),
  constraint risk_prompts_library_prompt_key unique (risk_prompt_library_id, risk_prompt_id),
  constraint risk_prompts_area_order_key unique (risk_prompt_area_id, risk_prompt_order),
  constraint risk_prompts_prompt_id_not_empty check (length(btrim(risk_prompt_id)) > 0),
  constraint risk_prompts_title_not_empty check (length(btrim(risk_prompt_title)) > 0),
  constraint risk_prompts_guidance_not_empty check (length(btrim(risk_prompt_guidance)) > 0),
  constraint risk_prompts_order_positive check (risk_prompt_order > 0),
  constraint risk_prompts_default_status_check check (risk_default_status = 'draft')
);

comment on table public.risk_prompts is
  'Controlled guidance prompts that can later be selected to create Draft project risks. Prompt-created risks should retain source traceability back to risk_prompt_id.';
comment on column public.risk_prompts.risk_prompt_id is
  'Stable product-controlled prompt identity from the repository CSV. Existing IDs must not be reused for unrelated prompts.';
comment on column public.risk_prompts.risk_default_status is
  'Default lifecycle status for risks created from this prompt. MVP prompt-created risks are always Draft.';

create trigger set_risk_prompt_libraries_updated_at
  before update on public.risk_prompt_libraries
  for each row execute function public.set_updated_at();

create trigger set_risk_prompt_areas_updated_at
  before update on public.risk_prompt_areas
  for each row execute function public.set_updated_at();

create trigger set_risk_prompts_updated_at
  before update on public.risk_prompts
  for each row execute function public.set_updated_at();

alter table public.risk_prompt_libraries enable row level security;
alter table public.risk_prompt_areas enable row level security;
alter table public.risk_prompts enable row level security;

create policy "Authenticated users can read risk prompt libraries"
  on public.risk_prompt_libraries for select
  to authenticated
  using (true);

create policy "Authenticated users can read risk prompt areas"
  on public.risk_prompt_areas for select
  to authenticated
  using (true);

create policy "Authenticated users can read risk prompts"
  on public.risk_prompts for select
  to authenticated
  using (true);

create index risk_prompt_libraries_default_active_idx
  on public.risk_prompt_libraries (is_default, is_active, risk_library_key, risk_library_version);
create index risk_prompt_areas_library_active_order_idx
  on public.risk_prompt_areas (risk_prompt_library_id, is_active, risk_area_order);
create index risk_prompts_library_active_idx
  on public.risk_prompts (risk_prompt_library_id, risk_prompt_is_active);
create index risk_prompts_area_order_idx
  on public.risk_prompts (risk_prompt_area_id, risk_prompt_order);

grant select on table public.risk_prompt_libraries, public.risk_prompt_areas, public.risk_prompts to authenticated;
grant all privileges on table public.risk_prompt_libraries, public.risk_prompt_areas, public.risk_prompts to service_role;
