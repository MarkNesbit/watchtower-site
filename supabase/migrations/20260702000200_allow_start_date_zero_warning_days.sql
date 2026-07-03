-- Allow Start date records to use the app-level zero-day warning window.
-- The original project_dates table supports start_date records, but its
-- warning_days check rejected the persisted value used for Start date.

alter table public.project_dates
  drop constraint if exists project_dates_warning_days_check;

alter table public.project_dates
  add constraint project_dates_warning_days_check check (warning_days between 0 and 365);
