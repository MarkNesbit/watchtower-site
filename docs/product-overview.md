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

## Risk Management MVP

WT-RISK-002A introduced the first usable Risk Management surface: a project-scoped Risk Register and risk detail page. WT-RISK-002C simplifies the register so it shows source-of-truth project risk records with their human-readable risk reference, title, lifecycle status, review date and latest update. WT-RISK-003 adds a nullable single actioner assignment on the risk record while keeping that assignment out of the register table. WT-RISK-004 turns detail assurance cards into focused edit entry points and adds top-level Comments, while WT-RISK-004A refines the detail page around a compact Current risk strip and Core Risk Detail content area. The reference pill remains the compact visual concern indicator.

WT-RISK-002B adds create and edit flows for owner, admin and member workspace roles. WT-RISK-003 lets those users assign, change or clear an actioner from active members of the relevant workspace. Viewer users can see the actioner, comments and assurance concern but cannot change them. The risk detail page uses simple block-level Green, Amber, Red and Unknown indicators for description, lifecycle status, exposure, ownership, action responsibility, review cadence, due date, plans and update freshness, with missing assurance data treated as unsafe by default. These indicators are MVP-derived quality signals, not the final Governance Profile or configurable scoring engine. Watchtower generates risk references using `Risk-{PROJECT_REF}-{NNN}` and users cannot edit them. Risk delete, comment replies/threading, Risk-to-Diary integration, attention items, notifications, digest behaviour, a full Actions module and health scoring remain future slices. The Project Narrative can reference risk context in a later workflow, but it is not the source of truth for risks.
