# ADR-005 Data Ownership and Entity Relationships

**Status:** Approved
**Date:** 11 June 2026
**Related:** ADR-000 through ADR-004

---

# Context

Watchtower is intended to evolve from project tracking into a delivery intelligence platform.

Future capabilities will include:

* Projects
* Programmes
* Portfolios
* Forecasting
* Reporting
* Risks
* Issues
* Milestones
* AI-generated insights

A consistent ownership model is required to avoid future redesign.

---

# Decision

All business entities belong to a workspace.

No business entity should belong directly to a user.

Users interact with entities through workspace membership and role permissions.

Workspace ownership is the root ownership model.

---

# Root Hierarchy

Workspace is the root entity.

```text
Workspace
├── Portfolio
├── Programme
├── Project
├── Report
├── Forecast
├── Upload
└── Settings
```

Every business object ultimately belongs to a workspace.

---

# Ownership Principle

Every business table must contain:

organisation_id

Example:

```text
projects
--------
id
organisation_id
name
```

This enables:

* Security boundaries
* RLS enforcement
* Reporting
* Future billing
* Data export

---

# Project Relationships

Projects are the primary delivery entity.

Projects may contain:

```text
Project
├── Updates
├── Risks
├── Issues
├── Decisions
├── Milestones
├── Forecasts
└── Attachments
```

---

# Programme Relationships

Programmes are collections of projects.

```text
Programme
└── Projects
```

Projects remain the source of truth.

Programmes aggregate project information.

---

# Portfolio Relationships

Portfolios are collections of:

* Programmes
* Projects

```text
Portfolio
├── Programmes
└── Projects
```

Portfolios do not duplicate project data.

---

# Forecast Ownership

Forecasts belong to projects.

Examples:

```text
Project
└── Forecast
```

Future programme and portfolio forecasts are derived from project forecasts.

---

# Report Ownership

Reports belong to workspaces.

Reports may reference:

* Projects
* Programmes
* Portfolios

but the report itself belongs to the workspace.

---

# Upload Ownership

Uploads belong to the workspace.

Examples:

* CSV imports
* XLSX imports
* Historical datasets

This allows data to be reused across multiple projects.

---

# Audit Ownership

Audit records belong to the workspace.

Audit records may reference:

* Users
* Projects
* Programmes
* Portfolios

but remain workspace-owned.

---

# User Ownership

Users own:

* Their identity
* Their profile

Users do not own:

* Projects
* Programmes
* Portfolios
* Forecasts
* Reports

Ownership remains with the workspace.

---

# Future AI Ownership

AI-generated outputs belong to the workspace.

Examples:

* Forecast commentary
* Sprint narratives
* Executive summaries
* Delivery insights

This ensures continuity when users leave a workspace.

---

# Entity Lifecycle

Entities should support:

```text
created_at
updated_at
archived_at
deleted_at
```

Soft deletion is preferred.

---

# Consequences

Benefits:

* Consistent ownership model
* Easier RLS implementation
* Easier reporting
* Easier billing
* Easier enterprise support
* Simpler future forecasting architecture

Trade-offs:

* Slightly more joins in database queries
* Additional organisation_id columns

These trade-offs are accepted because consistency and scalability are more important than marginal schema simplicity.
