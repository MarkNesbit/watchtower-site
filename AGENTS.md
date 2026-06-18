# Watchtower Codex Working Rules

These instructions apply to the whole repository.

## Required reading before implementation changes

Before implementing Watchtower changes, Codex/developers should read:

- `README.md`
- `docs/product-overview.md`
- `docs/watchtower-platform.md`
- `docs/project-model.md`
- `docs/cloudflare-workers-deployment.md`
- Relevant Supabase migrations for schema or Row Level Security changes.
- Relevant source files for the feature being changed.

## Product and implementation rules

- Do not change the Supabase Auth flow without explicit instruction.
- Do not weaken Row Level Security.
- Do not add service-role keys to application code.
- Do not change Cloudflare routing or deployment unless the task is explicitly deployment-related.
- Keep production domain routing documented: `https://watch-tower.co.uk` must point to the Cloudflare Worker deployment, not the old Pages deployment.
- Prefer small, reviewable changes.
- Preserve workspace/organisation isolation.
- Use "Workspace" in user-facing language and "organisation" in database/internal language unless existing code requires otherwise.
- For project fields, distinguish required, optional, and health-significant fields.
- Do not assume optional project fields are unimportant.
