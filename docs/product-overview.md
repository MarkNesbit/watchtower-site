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

WT-RISK-002A introduced the first usable Risk Management surface: a project-scoped Risk Register and risk detail page. The register displays source-of-truth project risk records with their human-readable risk reference, title, RAG/exposure signal, status, owner, actioner fallback, review date and latest update where those fields exist.

WT-RISK-002B adds create and edit flows for owner, admin and member workspace roles. Watchtower generates risk references using `Risk-{PROJECT_REF}-{NNN}` and users cannot edit them. Viewer users retain read-only access. Risk delete, risk notes/replies, Risk-to-Diary integration, attention items, notifications, digest behaviour and health scoring remain future slices. The Project Narrative can reference risk context in a later workflow, but it is not the source of truth for risks.
