-- WT-001B foundation seed data: initial global product feature flags.
insert into public.feature_flags (key, name, description, enabled)
values
  ('auth_enabled', 'Authentication', 'Enables authentication foundation behaviour once auth screens exist.', true),
  ('project_tracking_enabled', 'Project Tracking', 'Controls project tracking features.', false),
  ('programme_tracking_enabled', 'Programme Tracking', 'Controls programme tracking features.', false),
  ('portfolio_tracking_enabled', 'Portfolio Tracking', 'Controls portfolio tracking features.', false),
  ('monte_carlo_enabled', 'Monte Carlo Forecasting', 'Controls Monte Carlo forecasting features.', false),
  ('ai_reports_enabled', 'AI Reports', 'Controls AI-generated reporting features.', false)
on conflict do nothing;
