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

Projects are the core objects users navigate, review and progressively enrich. Future project intelligence should help users understand project risk, dependencies, delivery confidence and governance clarity. Project health is not designed or implemented yet and currently remains Unknown. Future project health may use both explicit data and missing or uncertain data as signals; optional project fields should therefore not be treated as unimportant.

The project model includes a workspace-isolated relationship foundation for future dependency, prerequisite, programme and portfolio visibility. This readiness layer is not a relationship management interface or a programme/portfolio reporting feature. Non-specific `relates_to` links are reserved as possible future ambiguity signals and do not automatically create risks or change project health.

WT-TEST-001 adds an internal-only Account -> Test tools utility for production smoke-testing role journeys in the Mark.Nesbit.Professional workspace. It lets the authorised internal tester simulate Viewer, Member, Admin and Owner effective permissions without changing real workspace membership data. Simulation expires after 4 hours, shows a persistent testing-mode banner, and is not a customer-facing permission-management feature or impersonation capability.

WT-TEST-002 adds demo people/personas to that internal utility. The Mark internal tester can import CSV test personas for the scoped workspace, review validation before replacing existing demo rows, and simulate a persona's effective access profile. Demo people support team-modelling metadata such as project role, default risk owner/actioner flags and future notification routing email. They are not real authenticated users and do not create invitations or alter real profile/membership data.

## Risk Management MVP

WT-RISK-002A introduced the first usable Risk Management surface: a project-scoped Risk Register and risk detail page. WT-RISK-REG-UX-002 turns the Risk Register foundation into a compact table-led register, so source-of-truth project risk records can be scanned in one place with their human-readable risk reference, title, exposure, action state, lifecycle/status, owner, review due date and latest update. WT-RISK-003 adds a nullable single actioner assignment on the risk record while keeping that assignment out of the register table. WT-RISK-004 turns detail assurance cards into focused edit entry points and adds top-level Comments, while WT-RISK-004A and WT-RISK-004B refine the detail page around a compact Current risk strip and Current Risk Detail content area. WT-RISK-005 changes the reference pill into a derived risk action-state indicator, and WT-RISK-REG-UX-001 makes the terminology contract explicit: probability and impact derive exposure as Critical, High, Medium or Low through the Watchtower Default MVP assessment, governance/control quality derives assurance, and action state uses Red, Amber and Green to show whether action is needed or recommended now. Low exposure uses yellow rather than green. The Risk detail page shows exposure as current risk detail and explains action state in a separate rationale block rather than duplicating the same Red/Amber/Green pill. Future Risk Register UX slices will add tabs, filters, sorting, summary cards, a Needs action panel, pagination and an exposure distribution chart.

WT-RISK-002B adds create and edit flows for owner, admin and member workspace roles. WT-RISK-003 lets those users assign, change or clear an actioner from active members of the relevant workspace. Viewer users can see the actioner, comments and action-state rationale but cannot change them. The risk detail page uses simple block-level Green, Amber, Red and Unknown indicators for description, lifecycle status, exposure, ownership, action responsibility, review cadence, due date, plans and update freshness, with missing assurance data treated as unsafe by default. The stored `rag_status` column is legacy/transitional compatibility storage; user-facing create, edit and focused modal flows no longer treat it as the source of truth. These indicators are MVP-derived quality signals, not the final Governance Profile / Assessment Profile or configurable scoring engine. Owner/actioner inactivity assurance is future-ready because `profiles.last_login_at` exists as metadata but is not maintained by the current login audit flow. Temporary actioner handover is also future scope and will need temporary actioner, handover reason, start date, end date, assigned by and original actioner fields. Watchtower generates risk references using `Risk-{PROJECT_REF}-{NNN}` and users cannot edit them.

Current Risk Detail keeps overview cards scannable by showing previews for long free-text fields such as summary, mitigation plan and contingency plan. Full populated text remains available in a read-only modal from the card area, while missing text still shows the existing action prompt in the overview. This is only a presentation behaviour; it does not change exposure, action state, project health, edit permissions or stored risk content.

WT-RISK-NARRATIVE-001 allows Project Narrative to reference risk context only for significant events: an active risk being raised, a draft risk being opened/published, an active risk being closed, a closed risk being reopened, or an existing active risk changing from non-Red to Red using derived risk action state. Draft saves, routine edits and risk comments do not populate the Narrative, and the Narrative is not an audit log or the source of truth for risks. Risk-generated Narrative entries are source-linked and can show a read-only current Risk detail modal with separate exposure, assurance and action-state signals plus an Open full risk in new tab action. Editing remains in Risk Management. Risk delete, comment replies/threading, attention items, notifications, digest behaviour, a full Actions module, health scoring and AI behaviour remain future slices.

WT-DASH-RISK-001 makes the project dashboard Risk tile a light assurance surface. Only the Risk tile icon changes colour, based on the highest active project risk assurance state. Draft and Closed risks are excluded. Risk exposure remains separate inside Risk Management and does not colour the dashboard icon. Red/Amber count dots, badges, notifications, attention items and health scoring remain out of scope.

WT-DASH-TILE-SIGNALS-001 expands dashboard tile signalling beyond Risks without turning tiles into data cards. Tiles still show only icon and title, with accessible status labels and shared RAG styling. Project Details reflects setup completeness, important responsibility assignment and project-date readiness. Project Narrative is a user-specific awareness signal: Green means no unseen entries, Amber means 1-3 unseen entries, Red means 4 or more unseen entries, and Unknown means the read-state cannot be calculated safely. Opening the Project Narrative page updates that user's read-state; rendering the dashboard does not. Risks reflects attention/assurance needs rather than raw exposure, so a high-exposure risk may still produce a Green Risks tile when it is actively managed and no current action trigger exists.

WT-SIGNAL-CONSISTENCY-001 extends that assurance scanning into a consistent project-area action-state model. The Projects page reference pill now aggregates non-user-specific Project Details and Risk area signals as project action state, while Health remains Unknown until a future health assessment exists. Parent Red or Amber action states must be explainable on the destination page: the Project Details tile and Project Details page action-state panel share the same setup, date and responsibility reasons. The current Project Details field criticality is MVP-light and hardcoded; a future governance or assessment profile model can replace those static rules. Project Narrative read-state remains user-specific and is deferred from Projects page aggregation in this slice. Future action-state sources may include Issues, Dependencies, Assumptions, Actions and Decisions.

WT-PROJ-DETAILS-SIGNALS-001 extends Project Details from a single page-level rationale into section-level action states. Project Identity, Description, Context, Dates, Governance/Escalation and Roles/Responsibilities each show their own Red/Amber/Green/Unknown/Neutral state as a compact section marker with subtle section accenting, while System Metadata remains informational unless a real integrity concern exists. Green sections are visible but do not show explanatory banners. The top Project Details action-state panel is the visible summary of section-owned Red/Amber reasons, preserving the rule that parent action state must be explainable on the destination page. Project Dates avoids duplicate section rationale because the individual date cards already show date-level states; the Dates section aggregates from those visible child cards, not from separate RAID records or project health.
