# WatchTower Platform

WatchTower is an emerging SaaS delivery intelligence platform for teams and leaders who need clearer evidence-based forecasts.

The public website establishes the foundation for the WatchTower product presence. It explains the platform vision, introduces the emerging product suite and provides a professional home for future product marketing at `https://watch-tower.co.uk`.

## Platform vision

WatchTower exists to help delivery organisations move away from delivery theatre and towards clearer delivery intelligence. The platform direction is centred on three ideas:

- Monte Carlo forecasting using delivery-period throughput;
- confidence and risk communication that leaders can explain;
- early-warning signals for volatility, reliability and portfolio risk.

The first product focus is WatchTower Forecast. Future products extend the platform into narrative, signal and portfolio intelligence.

## Intended audience

The platform is intended for professional delivery and technology audiences, including:

- Delivery Managers and Agile Delivery Managers;
- Scrum Masters and Project Managers;
- Programme Managers and PMO teams;
- Heads of Delivery;
- Technology Leaders;
- Transformation Leaders;
- Product teams, portfolio managers and delivery consultants.


## User profile and access foundation

Supabase Auth owns authenticated accounts. Watchtower mirrors each verified account into a lightweight profile for identity, display and audit metadata. Profiles are not workspace permission stores and must not contain global customer roles, recovery email addresses, delivery personas or platform superuser roles. The platform-level product controls are narrow eligibility flags: `can_access_preview_features` for preview feature availability and `is_internal_tester` for the WT-TEST-001 internal testing utility. They cannot grant workspace membership, ordinary RBAC permissions or general RLS access.

Workspace access is derived from active organisation membership and the fixed MVP roles `owner`, `admin`, `member` and `viewer`. The database stores these roles on `organisation_members`, allowing a user to hold different roles in different workspaces. See `docs/access-foundation.md` for the full account/profile/membership/role model and future permission-readiness notes.

WT-TEST-001 adds Account -> Test tools for the authorised Mark.Nesbit.Professional internal tester only. The tool can simulate Viewer, Member, Admin or Owner in the `mark-nesbit-professional` production test workspace for smoke-testing and permission validation. It stores short-lived simulation state, expires after 4 hours, changes effective permissions only, preserves the real `organisation_members.role`, and shows a persistent testing-mode banner while active. It is not impersonation, not customer-facing permission management, and not a global admin tool.

## Feature availability and preview access

Global product features move through `hidden`, `disabled`, `preview` and `enabled` states. Missing or malformed configuration fails closed as hidden. Approved preview accounts can enter `preview` features, but remain subject to authentication, active workspace membership, fixed-role permissions and Row Level Security. See `docs/feature-flags.md` for keys, integration rules, release transitions and UAT validation.

## Design direction

The website should feel credible, calm, data-led and professional for a senior delivery audience. The visual direction blends a dark navy / charcoal command-centre feel with clean light content sections, subtle beacon and early-warning motifs, rounded dashboard cards and the light blue from the WatchTower logo as the site accent colour (`#00A0FF`).

Authenticated project pages follow the universal project-page layout standard in `docs/ui-page-design-standard.md`. Project-level pages should use a shared hero/context panel, optional control panel, main content panel, consistent primary action placement, permission-aware disabled actions, and reusable empty states rather than each route inventing its own structure.

## Workspace foundation

WatchTower is built around workspaces. The database and internal implementation use the term `organisation`, while user-facing language should normally use `Workspace`. Every user starts with a default personal workspace, and projects belong to workspaces rather than directly to users.

This workspace foundation supports future project intelligence across risk, dependencies, delivery confidence and governance clarity. Future project health should use both explicit data and missing or uncertain data as signals, with expectations that vary by lifecycle stage and commitment level.

## Project references and routing slugs

Project slugs are URL-safe routing identifiers only and are unique within a workspace rather than globally. Canonical project URLs therefore use `/app/workspaces/{workspaceSlug}/projects/{projectSlug}`, with `/edit` and `/risks` suffixes for those destinations. Scoped lookups require the signed-in user's active workspace membership and match both workspace and project slug; visible URLs do not contain raw UUIDs. The older `/app/projects/{projectSlug}` family is transitional and redirects only for one accessible match, presenting a workspace choice when the same slug is accessible in more than one workspace.

User-facing delivery records should use `projects.project_ref`, a short 3-4 character uppercase code generated and collision-resolved by Watchtower within the workspace/organisation. The create flow displays the expected reference as fixed and read-only; users cannot supply or override it, and it remains immutable after creation for MVP. A future admin-only override is outside the current scope. Future risk references will combine this code with a project-specific sequence, for example `Risk-HHH-003`.

## Project dashboard capabilities

The project dashboard presents the main operating areas without exposing the underlying data model. **Project Narrative** is the user-facing event and history layer for understanding what happened, what changed and why it matters. **Timeline** remains a separate date, milestone and key-stage view.

Project Narrative uses the internal `projectDiary` feature flag. WT-US-0207 added the dashboard tile and shared feature-gated tile handling, WT-NARRATIVE-002 added structured, workspace-isolated storage and data access, and WT-NARRATIVE-001 linked accessible tiles to the guarded workspace/project Narrative route with a reverse-chronological assurance table.

WT-NARRATIVE-003 adds manual Project Narrative entry creation for owners, admins, and members. Viewers retain read-only access and see the create action disabled with helper text. Manual entries can include structured links with required labels and safe `http://` or `https://` URLs. WT-RISK-NARRATIVE-001 adds deliberately limited risk-generated entries only when a risk is raised or when an existing risk changes from non-Red to Red. Clicking a Narrative Ref opens a read-only detail modal on the same page; risk-generated entries can show a concise source-risk preview and an Open full risk action without enabling risk editing from Narrative.

WT-US-0209 introduced the authenticated project page design standard and lightweight reusable layout components for future project pages. Project Narrative is the reference implementation for the shared hero, filter/status panel, main content panel, primary action slot, disabled action hint, and empty state components. The project dashboard now follows the same shell for its project context, status summary, capability hub, and read-only detail panels while retaining its existing feature-gated tile behaviour.

WT-DASH-RISK-001 removes rollover-only helper text from dashboard capability buttons and makes the Risk tile icon reflect the highest current active risk assurance state for the selected project. Draft and Closed risks are excluded from that icon calculation. This is an icon-only dashboard signal, not a badge/count system, notification surface, attention item feed, health score, or exposure indicator.

WT-RISK-002A added the Risk Register and risk detail foundation behind the `riskManagement` feature flag, WT-RISK-002B adds create/edit flows for owner, admin and member roles, WT-RISK-002C simplifies the register while turning detail into an assurance view, WT-RISK-003 adds a single primary actioner assignment from active workspace members, WT-RISK-004 makes the detail cards actionable with focused edit modals plus top-level Comments backed by `project_risk_notes`, WT-RISK-004A/004B refine the detail information architecture around a compact Current risk strip and Core Risk Detail content area, and WT-RISK-005 makes overall concern derived rather than manually declared. WT-RISK-NARRATIVE-001 uses that derived concern for the "risk became Red" trigger and does not use a manually selected RAG field. The project dashboard Risk tile routes to the register when available, but dashboard risk roll-ups remain deferred. Risk references are generated by Watchtower using the project reference pattern and remain read-only. Lifecycle status, exposure, assurance and overall concern are separate concepts: probability and impact drive exposure, missing or weak governance/control data drives assurance, and overall concern is derived from exposure plus assurance overrides. The stored `rag_status` field remains legacy/transitional compatibility storage. Block-level detail indicators are simple derived quality signals rather than a configurable Governance Profile / Assessment Profile engine. Owner/actioner inactivity rules are future-ready only; `profiles.last_login_at` is present but not reliably maintained by the current auth audit flow. Temporary actioner handover/delegation is future scope and will need temporary actioner, handover reason, start date, end date, assigned by and original actioner fields. Routine risk edits, risk comments, risk delete, comment replies/threading, attention items, notification or digest behaviour, a separate Actions module, health scoring and AI behaviour are not implemented in this slice.

Risk, Issue, Dependency, and Assumption records remain authoritative. Source-generated Narrative entries may reference them for assurance history, but must not become an alternative editing surface or a noisy audit feed. The full schema and permission boundary are documented in `docs/project-narrative.md`.

## Project relationship readiness

WT-US-0208 introduces a workspace-isolated `project_relationships` foundation for future cross-project visibility. It supports directed `relates_to`, `dependent_on`, `required_for`, `programme`, and `portfolio` relationship types while rejecting self-links, duplicate active links of the same type, and links whose projects do not belong to the relationship's workspace.

This is model readiness only. No project relationship UI, programme/portfolio dashboard, cross-project report, automatic risk, health score change, or dashboard tile is exposed. A non-specific `relates_to` link is marked in helper code as a possible future ambiguity/risk signal, not as an automatically created risk. Database relationships use project UUIDs; future user-facing views should continue to show human-readable project references and names.
