# ADR-003 Project Domain Model

**Status:** Approved
**Date:** 11 June 2026
**Related:** ADR-000 Foundation Decisions, ADR-001 Authentication and Identity Model, ADR-002 Workspace and Membership Model

---

# Context

Watchtower is intended to support delivery visibility across:

* Projects
* Programmes
* Portfolios

The MVP will begin with project-level management and reporting.

The model must support future programme and portfolio aggregation without requiring structural redesign.

---

# Decision

Projects are the primary delivery entity within Watchtower.

Programmes and portfolios are grouping structures built on top of projects.

Projects must not be dependent on programmes or portfolios existing.

This allows:

* Individual project tracking
* Team project tracking
* Programme aggregation
* Portfolio reporting

without introducing unnecessary complexity into MVP.

---

# Hierarchy

The ownership hierarchy is:

Workspace
└── Portfolio (optional)
└── Programme (optional)
└── Project

````

However, a project may also exist without:

- A programme
- A portfolio

Example:

```text
Workspace
└── Project
````

This supports individual users and small teams.

---

# Project Definition

A Project represents a discrete piece of delivery work with:

* Defined purpose
* Defined ownership
* Defined reporting cadence
* Defined status

Examples:

* Email Platform Redevelopment
* SSO Implementation
* Watchtower MVP
* Mobile App Release
* Infrastructure Migration

---

# Project Ownership

Every project belongs to a workspace.

Projects never belong directly to users.

Ownership is represented through workspace membership and assigned project roles.

---

# Core Project Fields

Required fields:

* id
* organisation_id
* name
* description
* status
* owner_user_id
* created_at
* updated_at
* archived_at

---

# Project Status Model

Initial statuses:

* proposed
* active
* on_hold
* completed
* cancelled
* archived

---

# Status Definitions

## proposed

Work identified but not yet started.

## active

Work currently being delivered.

## on_hold

Work temporarily paused.

## completed

Delivery finished successfully.

## cancelled

Work stopped permanently.

## archived

Historical record retained but hidden from normal views.

---

# Project Ownership Role

Each project has a designated owner.

The owner is responsible for:

* Reporting
* Data quality
* Forecast updates
* Stakeholder updates

Project ownership does not grant additional workspace permissions.

Workspace permissions remain the primary security boundary.

---

# Project Metadata

Projects may contain:

* Delivery method
* Business area
* Sponsor
* Priority
* Tags
* Reporting cadence

These fields are optional for MVP.

---

# Delivery Method

Supported delivery methods:

* Scrum
* Kanban
* Hybrid
* Waterfall
* Other

The delivery method exists to support future reporting and forecasting.

---

# Reporting Cadence

Supported values:

* Weekly
* Fortnightly
* Monthly
* Quarterly

This supports future automated reporting.

---

# Project Health

Projects should support health indicators.

Initial health statuses:

* Green
* Amber
* Red

The purpose is visibility rather than governance.

---

# Project Relationships

Projects may later contain:

* Milestones
* Risks
* Issues
* Decisions
* Forecasts
* Status Updates

These are not required for MVP but should be anticipated.

---

# Programme Model

A Programme is a collection of related projects.

Example:

Customer Experience Programme

Projects:

* Website Redevelopment
* CRM Upgrade
* Mobile App

Programmes do not own data directly.

Projects remain the source of truth.

---

# Portfolio Model

A Portfolio is a collection of programmes and/or projects.

Example:

2026 Transformation Portfolio

Programmes:

* Customer Experience
* Digital Operations

Projects:

* Data Platform Upgrade

Portfolio reporting is derived from underlying projects.

---

# Reporting Principle

Project reporting is the source of truth.

Programme reporting is aggregated project reporting.

Portfolio reporting is aggregated programme and project reporting.

This avoids duplicate reporting structures.

---

# Future Forecasting

Forecasting should operate primarily at project level.

Future capabilities include:

* Throughput forecasting
* Monte Carlo forecasting
* Delivery confidence
* Scope volatility analysis

Programme and portfolio forecasts should aggregate project forecasts.

---

# Database Tables

Anticipated MVP tables:

* projects

Future tables:

* project_updates
* project_milestones
* project_risks
* project_issues
* project_decisions
* project_forecasts
* programmes
* programme_projects
* portfolios
* portfolio_programmes
* portfolio_projects

---

# Access Control

Projects inherit workspace security.

If a user can access the workspace, access to projects is controlled through role permissions.

Projects do not introduce a second independent security model.

---

# Consequences

Benefits:

* Project-first simplicity
* Natural progression to programme and portfolio management
* Supports individual and organisational use
* Supports future forecasting and reporting
* Avoids structural redesign

Trade-offs:

* Programmes and portfolios are initially lightweight
* Some future reporting complexity shifts into aggregation logic

These trade-offs are accepted because projects are the fundamental delivery unit within Watchtower.
