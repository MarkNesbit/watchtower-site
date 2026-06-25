# Watchtower Project Model

**Status:** Product working reference through WT-NARRATIVE-003

**Last updated:** 25 June 2026

**Related:** `docs/architecture/ADR-002 Workspace and Membership Model.md`, `docs/architecture/ADR-003 Project Domain Model.md`, `docs/project-narrative.md`, `supabase/migrations/20260617000100_create_projects.sql`, `supabase/migrations/20260624000300_project_relationship_foundation.sql`, `supabase/migrations/20260624000400_project_narrative_schema_foundation.sql`, `supabase/migrations/20260625000100_project_narrative_entry_links.sql`

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

## WT-US-0208 project relationship readiness

WT-US-0208 adds a database and helper-code foundation for future relationships between projects. It is deliberately a readiness slice: there is no relationship management UI, programme or portfolio dashboard, cross-project reporting, automatic risk creation, or project health scoring change.

`project_relationships` stores a directed relationship from `source_project_id` to `target_project_id`. Both are internal project UUIDs and both must belong to the record's `organisation_id`. Composite foreign keys enforce that workspace boundary at database level. A project cannot relate to itself, and a partial unique index prevents more than one active relationship with the same source, target, and type. An inactive historical relationship does not prevent a later active record from being created.

Supported relationship types are:

- `relates_to`: a non-specific relationship whose meaning needs clarification;
- `dependent_on`: the source project depends on the target project;
- `required_for`: the source project is a prerequisite or enabler for the target project;
- `programme`: readiness for future programme grouping or visibility;
- `portfolio`: readiness for future portfolio grouping or visibility.

The `programme` and `portfolio` values do not create programme or portfolio entities in this slice. They reserve explicit semantics for later model evolution and visibility work without forcing project relationship data into an undifferentiated field.

All active Workspace members can read relationship records under Row Level Security. Owners, admins, and members can create, update, deactivate, or delete them; viewers are read-only. Feature flags do not replace these controls, and WT-US-0208 does not expose a user-facing route or tile.

A `relates_to` relationship is intentionally ambiguous. The helper `isAmbiguousProjectRelationshipType` makes it available to future project health/risk logic as a possible uncertainty signal, but it does not create a risk or alter health scoring in this slice.

Relationship records use UUIDs internally for referential integrity. Any future user-facing relationship view should identify projects with the human-readable `projects.project_ref` (and project name where useful), not expose or substitute raw UUIDs. Project references remain display identifiers and do not replace UUID foreign keys.

## WT-NARRATIVE-002 Project Narrative foundation

Project Narrative is the structured project assurance and history layer. `project_narrative_entries` links every event to both its workspace and project, assigns an immutable project-scoped entry number, and generates references such as `NAR-HHH-001` from the authoritative project reference. An internal atomic counter prevents concurrent collisions and prevents deleted references from being reused.

Entries may be manual or prepared for future Risk, Issue, Dependency, Assumption, and system sources. Optional source UUID/reference fields preserve traceability, but the source RAID module remains authoritative: Project Narrative does not become an editable substitute for a Risk or other delivery concern.

Owners, admins, and members can read and mutate Narrative entries for projects in an active workspace; viewers are read-only. Composite foreign keys and Row Level Security preserve workspace isolation. Audit timestamps use UTC-compatible `timestamptz`; optional context accepts validated IANA timezone names for later display/audit use.

WT-NARRATIVE-002 adds no Project Narrative page, form, table, modal, filters, RAID integration, notifications, export, or AI. See `docs/project-narrative.md` for the schema, reference, DTS, permission, and validation details.

## WT-NARRATIVE-003 manual Project Narrative entries

WT-NARRATIVE-003 makes Project Narrative usable for manual project context capture. Owners, admins, and members can create manual Narrative entries from the workspace/project Narrative route. Viewers can still read the table and detail modal, but the create action is visible and disabled with role-specific helper text.

Manual entries require Title, Details, and an Attention level. Attention defaults to Neutral and remains constrained to `neutral`, `green`, `amber`, and `red`. Manual entries are stored with `source_type = manual`, `source_record_id = null`, and `source_ref = null`, so they do not create or update Risk, Issue, Dependency, or Assumption records.

Structured links are stored in `project_narrative_entry_links`. Each link belongs to the same workspace and project as its parent Narrative entry, requires a label and safe `http://` or `https://` URL, and is protected by Row Level Security. Active workspace members can read links; owners, admins, and members can create links; viewers cannot create links. Link editing/deletion and RAID promotion/conversion are separate future stories.

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

## WT-US-0205 workspace-safe project routing

Project slugs are unique only within a workspace, so project destinations include both readable routing slugs:

- `/app/workspaces/{workspaceSlug}/projects/{projectSlug}`
- `/app/workspaces/{workspaceSlug}/projects/{projectSlug}/edit`
- `/app/workspaces/{workspaceSlug}/projects/{projectSlug}/risks`

Every scoped page first requires an active membership in the workspace identified by `organisations.slug`, then resolves the active project using both `projects.organisation_id` and `projects.slug`. Deleted and archived projects remain unavailable. This keeps copied links and bookmarks pinned to the intended workspace without exposing organisation or project UUIDs. RBAC remains unchanged: Viewers can open the dashboard and an available Risk Management preview, but cannot edit project details or create risks.

`/app/projects/{projectSlug}` and its former edit and Risks variants remain transitional compatibility routes. They search only projects visible through the signed-in user's active memberships. One accessible match redirects to the corresponding workspace-scoped URL, multiple accessible matches show a workspace choice instead of selecting silently, and no match returns the same not-found/no-access response without revealing inaccessible project existence. New app-generated project links do not use these transitional routes.

## Feature-gated project capabilities

WT-US-0107 applies the central `riskManagement` feature flag to the Risks dashboard tile and the direct `/app/workspaces/{workspaceSlug}/projects/{projectSlug}/risks` route. `hidden` removes the tile, `disabled` keeps it visible but inactive, `preview` allows only approved preview accounts, and `enabled` releases it generally. All states remain subject to active workspace membership and RBAC; Viewer access remains read-only when the capability is available. The route is a release-control placeholder and does not expand the risk UI scope described in `docs/risk-foundation.md`.

WT-US-0207 adds **Project Narrative** near the start of the dashboard capability tiles. Project Narrative is the user-facing project event, update, decision and history layer: it explains what happened, what changed and why it matters. It remains distinct from **Timeline**, which represents dates, milestones and key project stages.

Project Narrative uses the existing internal `projectDiary` feature key. The dashboard applies the same `hidden`, `disabled`, `preview` and `enabled` access model to all feature-gated tiles rather than treating Risk Management as a one-off. WT-NARRATIVE-001 adds the guarded canonical destination at `/app/workspaces/{workspaceSlug}/projects/{projectSlug}/narrative`; an accessible tile now links there. The page lists scoped entries newest first using Ref, Attention, Details, Created by, and Created columns. Internal entry numbers are not shown, and no Type column is added. Risk Management routing and RBAC behaviour are unchanged.
