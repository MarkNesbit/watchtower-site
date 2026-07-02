# WatchTower Product Overview

WatchTower is an emerging delivery intelligence suite, starting with forecasting and expanding into narrative, signal and portfolio intelligence.

## WatchTower Forecast

**Positioning:** Monte Carlo forecasting based on delivery-period throughput.

WatchTower Forecast is the first product focus. It is intended to help delivery leaders forecast delivery windows using real throughput data, assess confidence and explain delivery risk without relying on guesswork.

**Current status:** Forecasting MVP focus.

## WatchTower Narrative

**Positioning:** Evidence-based delivery narrative for clearer stakeholder communication.

WatchTower Narrative is a future product direction focused on helping teams explain progress, risk and confidence in plain language grounded in delivery evidence.

**Current status:** Future direction.

## WatchTower Signals

**Positioning:** Early-warning indicators for delivery risk and reliability.

WatchTower Signals is a future product direction focused on surfacing changes in volatility, reliability and delivery risk before they become delivery surprises.

**Current status:** Future direction.

## WatchTower Portfolio

**Positioning:** Portfolio-level delivery intelligence for senior leaders.

WatchTower Portfolio is a future product direction focused on helping senior delivery leaders compare confidence, risk and reliability across teams and initiatives.

**Current status:** Future direction.

## Product suite principles

- Forecasting starts with real delivery-period throughput data.
- Confidence, risk and uncertainty should be visible and explainable.
- Delivery intelligence should reduce theatre rather than create new reporting overhead.
- The roadmap is directional and does not represent committed delivery dates.

## Workspace and project model

WatchTower is built around workspaces. Projects belong to workspaces, and every user starts with a default personal workspace created during onboarding.

Projects are the core objects users navigate, review and progressively enrich. Future project intelligence should help users understand project risk, dependencies, delivery confidence and governance clarity. Project health will eventually use both explicit data and missing or uncertain data as signals; optional project fields should therefore not be treated as unimportant.

The project model includes a workspace-isolated relationship foundation for future dependency, prerequisite, programme and portfolio visibility. This readiness layer is not a relationship management interface or a programme/portfolio reporting feature. Non-specific `relates_to` links are reserved as possible future ambiguity signals and do not automatically create risks or change project health.

WT-TEST-001 adds an internal-only Account -> Test tools utility for production smoke-testing role journeys in the Mark.Nesbit.Professional workspace. It lets the authorised internal tester simulate Viewer, Member, Admin and Owner effective permissions without changing real workspace membership data. Simulation expires after 4 hours, shows a persistent testing-mode banner, and is not a customer-facing permission-management feature or impersonation capability.

WT-TEST-002 adds demo people/personas to that internal utility. The Mark internal tester can import CSV test personas for the scoped workspace, review validation before replacing existing demo rows, and simulate a persona's effective access profile. Demo people support team-modelling metadata such as project role, default risk owner/actioner flags and future notification routing email. They are not real authenticated users and do not create invitations or alter real profile/membership data.

## Risk Management MVP

WT-RISK-002A introduced the first usable Risk Management surface: a project-scoped Risk Register and risk detail page. WT-RISK-002C simplifies the register so it shows source-of-truth project risk records with their human-readable risk reference, title, lifecycle status, review date and latest update. WT-RISK-003 adds a nullable single actioner assignment on the risk record while keeping that assignment out of the register table. WT-RISK-004 turns detail assurance cards into focused edit entry points and adds top-level Comments, while WT-RISK-004A and WT-RISK-004B refine the detail page around a compact Current risk strip and Core Risk Detail content area. WT-RISK-005 changes the reference pill into a derived concern indicator: probability and impact derive exposure, governance/control quality derives assurance, and overall concern is calculated from exposure plus assurance overrides rather than manually declared.

WT-RISK-002B adds create and edit flows for owner, admin and member workspace roles. WT-RISK-003 lets those users assign, change or clear an actioner from active members of the relevant workspace. Viewer users can see the actioner, comments and assurance concern but cannot change them. The risk detail page uses simple block-level Green, Amber, Red and Unknown indicators for description, lifecycle status, exposure, ownership, action responsibility, review cadence, due date, plans and update freshness, with missing assurance data treated as unsafe by default. The stored `rag_status` column is legacy/transitional compatibility storage; user-facing create, edit and focused modal flows no longer treat it as the source of truth. These indicators are MVP-derived quality signals, not the final Governance Profile / Assessment Profile or configurable scoring engine. Owner/actioner inactivity assurance is future-ready because `profiles.last_login_at` exists as metadata but is not maintained by the current login audit flow. Temporary actioner handover is also future scope and will need temporary actioner, handover reason, start date, end date, assigned by and original actioner fields. Watchtower generates risk references using `Risk-{PROJECT_REF}-{NNN}` and users cannot edit them.

WT-RISK-NARRATIVE-001 allows Project Narrative to reference risk context only for significant events: a risk being raised, or an existing risk changing from non-Red to Red using derived overall concern. Routine edits and risk comments do not populate the Narrative, and the Narrative is not an audit log or the source of truth for risks. Risk-generated Narrative entries are source-linked and can show a read-only preview/open-full-risk action, but editing remains in Risk Management. Risk delete, comment replies/threading, attention items, notifications, digest behaviour, a full Actions module, health scoring and AI behaviour remain future slices.

WT-DASH-RISK-001 makes the project dashboard Risk tile a light assurance surface. Only the Risk tile icon changes colour, based on the highest active project risk assurance state. Draft and Closed risks are excluded. Risk exposure remains separate inside Risk Management and does not colour the dashboard icon. Red/Amber count dots, badges, notifications, attention items and health scoring remain out of scope.

WT-PROJ-LIST-ATTN-001 extends that assurance scanning to the Projects page. The project reference pill now carries project attention state, initially from active unresolved risk concern signals, while the Health column remains a separate health assessment. The project name is the primary dashboard link and the Action column is removed. Future attention sources may include project dates, Project Details completeness, unseen Project Narrative entries, Issues, Dependencies, Assumptions, Actions and Decisions.
