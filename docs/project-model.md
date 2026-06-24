# Watchtower Project Model

**Status:** Product working reference for WT-002B preparation

**Last updated:** 24 June 2026

**Related:** `docs/architecture/ADR-002 Workspace and Membership Model.md`, `docs/architecture/ADR-003 Project Domain Model.md`, `supabase/migrations/20260617000100_create_projects.sql`

## Purpose of a project in Watchtower

A project is the core object a user navigates, reviews, and progressively enriches in Watchtower.

Watchtower should help users understand a project's current position, delivery confidence, governance clarity, risks, dependencies, and next actions. Project records should support both simple early capture and later maturity, assurance, and health assessment.

Projects belong to workspaces. The database and migrations use the internal term `organisation`; the user interface should normally use the term `Workspace` unless existing code or schema names require otherwise.

## Required, optional, and health-significant fields

Watchtower distinguishes three separate concepts:

| Concept | Meaning |
| --- | --- |
| Required field | A field that must be present to create or save a project. |
| Optional field | A field that can be left blank without blocking project creation or saving. |
| Health-significant field | A field that may be optional for data entry but still affect future Red/Amber/Green health indicators if it is missing, vague, stale, or contradictory. |

**Principle:** Optional does not mean unimportant. Some optional fields should not block creation, but their absence may increase project uncertainty and may contribute to future Amber or Red project health indicators.

## Initial required fields for creation

Project creation should remain deliberately lightweight. The current/default required fields should be minimal so users can capture a project early and enrich it over time.

The intended required concepts are:

- Project name/title.
- Workspace/organisation ownership.
- Created by / creator identity.
- Project status or lifecycle state, with a sensible default.
- Created/updated timestamps.

Current implementation notes:

- The database currently uses `projects.name` for the user-facing project title.
- The database currently uses `organisation_id` for workspace ownership.
- The database currently uses `created_by` for creator identity.
- The database currently uses `status` with allowed values `proposed`, `active`, `paused`, `completed`, and `cancelled`; application creation defaults to `proposed`.
- The database currently includes `health`, defaulting to `unknown`. This is present for future health display but should not be treated as a full Red/Amber/Green scoring implementation.
- The database currently includes generated/default `created_at` and `updated_at` timestamps.
- The application currently requires a Watchtower-generated `project_ref` for new project creation. It is a fixed user-facing reference, not an editable creation field.
- The database currently requires a `slug` for URL-safe identity within a workspace. This is an implementation field, not a primary user-facing product field.
- The current schema has nullable `description`, `archived_at`, and `deleted_at` fields.

Future naming preference: user-facing documentation and UI may use "project title" where clearer, but implementation should stay aligned with the current `name` field until a dedicated schema/naming task changes it.

## Recommended optional fields

The following project fields may be added progressively as the product matures. They are not all part of the current schema and should not be forced into WT-002B unless explicitly implemented by that task.

- Short description.
- Project owner.
- Sponsor.
- Delivery lead / delivery manager.
- Business area / client / department.
- Strategic objective / intended outcome.
- Success criteria.
- Current phase or lifecycle stage.
- Delivery approach, for example Scrum, Kanban, hybrid, waterfall, discovery, or unknown.
- Start date.
- Target date.
- Forecast date.
- Budget/funding status.
- Priority.
- Known risks.
- Known issues.
- Key assumptions.
- Dependencies.
- Related projects.
- Required-for relationships.
- Dependent-on relationships.
- Programme/portfolio grouping.
- Forecast confidence.
- Last reviewed date.
- Next review date.

## Health-significant field examples

| Field | Required at creation? | Health-significant? | Possible future health impact if missing/weak |
| --- | --- | --- | --- |
| Project name/title | Yes | Yes | Weak or vague naming may make ownership, reporting, and navigation unclear. |
| Workspace/organisation ownership | Yes | Yes | Missing or incorrect ownership would break isolation and make accountability unclear. |
| Project owner | No | Yes | Amber or Red risk if accountability is unclear, especially for active or committed work. |
| Sponsor | No | Yes | Amber if the governance route, escalation route, or senior accountability is unclear. |
| Target date | No | Yes | Amber or Red if a delivery commitment exists without a date, or if a date is stale or contradicted by forecast evidence. |
| Dependencies | No | Yes | Amber or Red if dependencies are unknown, vague, blocked, or only captured through a non-specific relationship such as `relates to`. |
| Delivery approach | No | Yes | Amber if the delivery method is unknown for an active project where cadence, evidence, or delivery controls should be clear. |
| Success criteria | No | Yes | Amber if value, completion criteria, or acceptance expectations are unclear. |
| Forecast confidence | No | Yes | Amber or Red if the project has delivery commitments but no evidence-based forecast or confidence signal. |
| Last reviewed date | No | Yes | Amber if the project information is stale, particularly for active delivery or committed work. |

## Red/Amber/Green principles

Watchtower should not define a full project health scoring algorithm yet. Until a dedicated health/scoring task exists, use these principles only:

- Green means the project has sufficient clarity and no obvious unmanaged warning signs.
- Amber means there is uncertainty, missing health-significant data, stale information, unclear ownership, unclear dependency position, or weakened delivery confidence.
- Red means there is a material unmanaged risk, missing critical ownership, blocked dependency, breached commitment, or significant delivery confidence concern.
- Missing data should usually start as uncertainty, not automatic failure.
- The impact of missing fields should depend on lifecycle stage and commitment level.
- Early idea/discovery projects should tolerate more unknowns.
- Active delivery or committed projects should be held to higher clarity expectations.

## Lifecycle and stage considerations

Field expectations may vary depending on project stage. Possible future stages include:

- Idea.
- Discovery.
- Planning.
- Active delivery.
- Paused.
- Completed.
- Cancelled / archived.

Exact lifecycle values must remain aligned with the current schema and code until a dedicated lifecycle task changes them. The current implementation uses `status` values `proposed`, `active`, `paused`, `completed`, and `cancelled`.

## Future relationship model note

Future project intelligence may need explicit project relationship types. Do not implement these as part of WT-002B unless they already exist or the task explicitly asks for them.

Possible future relationship types:

- `relates to`: default non-specific relationship. This should add uncertainty/risk because it lacks clear meaning.
- `dependent on`: this project depends on another project.
- `required for`: this project is a prerequisite/enabler for another project.
- `programme`: grouped under a programme.
- `portfolio`: grouped under a portfolio.

This relationship model is future scope and is not part of WT-002B unless separately specified.

## WT-002B implementation guidance

WT-002B should:

- Allow users to view a project detail page.
- Allow users to edit existing core fields.
- Preserve lightweight project creation.
- Avoid forcing all optional or health-significant fields immediately.
- Avoid implementing full Red/Amber/Green scoring yet.
- Avoid implementing dependency modelling yet.
- Keep workspace isolation and Row Level Security intact.

## WT-002B implemented foundation

WT-002B adds the first project detail and edit foundation without broadening the project schema. The project list links to project detail pages by the existing workspace-scoped `slug`. The detail page displays the project name, workspace context, status, health, created timestamp, updated timestamp, and a resolved creator display value only when the profile can be read safely.

Editable project fields are limited to the existing core fields `name` and `status`. The `status` field remains constrained to the existing values `proposed`, `active`, `paused`, `completed`, and `cancelled`. Health, slug, workspace/organisation ownership, creator identity, and timestamps are display-only or internal implementation fields and are not exposed as editable form fields.

Project creation remains lightweight. `created_by` continues to be populated automatically from the authenticated Supabase user when a project is created. The current schema does not include `updated_by`; WT-002B therefore does not add it and recommends a later small audit migration when the surrounding profile/audit display pattern is ready.

WT-002B does not implement Red/Amber/Green scoring, RAID tables, dependency modelling, programme/portfolio modelling, or additional optional project fields.

## WT-US-0202B system-generated fixed project references

Projects now have a dedicated `projects.project_ref` field for the user-facing project reference code. This is separate from `projects.slug`: the slug remains a URL-safe routing identifier only and must not be used as a delivery record reference.

Project references are short project codes rather than descriptive labels. Watchtower generates each new reference from the project name, shows the expected reference to the authorised creator as a fixed read-only preview, and independently derives the final value on the server. Users cannot supply, amend, or override a project reference during MVP. The stored reference is normalised to uppercase, must be 3-4 uppercase alphanumeric characters, and must start with a letter.

Project references are unique within a workspace/organisation, but the same reference may be reused in another workspace/organisation. If the preferred generated reference is already in use, Watchtower assigns a numeric-suffix alternative automatically rather than asking the user to resolve the collision. Project names are also unique within a workspace/organisation so that project lists and cross-project views remain unambiguous.

For MVP, `project_ref` is immutable after creation. The project edit page displays it read-only, but normal authenticated project update flows must not change it. A future admin-only override may be considered, but is deliberately outside this scope.

Future risk references will use the authoritative project reference in the compound format `Risk-{PROJECT_REF}-{NNN}`, for example `Risk-HHH-003`. Existing early projects that do not yet have a valid project reference should be assigned one through a controlled future process or recreated before Risk records can be created against them.

## Feature-gated project capabilities

WT-US-0107 applies the central `riskManagement` feature flag to the Risks dashboard tile and the direct `/app/projects/{projectSlug}/risks` route. `hidden` removes the tile, `disabled` keeps it visible but inactive, `preview` allows only approved preview accounts, and `enabled` releases it generally. All states remain subject to active workspace membership and RBAC; Viewer access remains read-only when the capability is available. The route is a release-control placeholder and does not expand the risk UI scope described in `docs/risk-foundation.md`.
