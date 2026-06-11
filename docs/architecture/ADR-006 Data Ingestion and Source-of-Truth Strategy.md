# ADR-006 Data Ingestion and Source-of-Truth Strategy

**Status:** Approved
**Date:** 11 June 2026
**Related:** ADR-000 through ADR-005

---

# Context

Watchtower is intended to become a delivery intelligence platform.

Delivery information may originate from:

* Manual entry
* CSV uploads
* XLSX uploads
* Jira
* Azure DevOps
* GitHub
* Future integrations

The platform requires a consistent approach to handling incoming data.

Without a defined strategy, each source risks creating incompatible structures and duplicate reporting logic.

---

# Decision

Watchtower will separate:

1. Source Data
2. Normalised Data
3. Generated Insights

Source systems remain the source of truth for operational delivery data.

Watchtower becomes the source of truth for:

* Forecasts
* Reports
* Trends
* Insights
* Historical analysis

---

# Data Layers

## Layer 1 – Source Data

Raw imported information.

Examples:

* Jira exports
* Azure DevOps exports
* GitHub exports
* CSV uploads
* XLSX uploads

Source data should be retained where practical.

The original import should not be modified.

---

## Layer 2 – Normalised Data

Watchtower converts imported data into a common internal model.

Example:

```text
Jira Issue
Azure DevOps Work Item
GitHub Issue

↓

Work Item
```

The normalised model becomes the platform reporting layer.

---

## Layer 3 – Generated Data

Generated information derived from the normalised model.

Examples:

* Forecasts
* Monte Carlo results
* Delivery trends
* Reliability scores
* AI narratives
* Risk indicators

Generated data should never overwrite source data.

---

# Source-of-Truth Principle

Watchtower does not replace delivery systems.

Examples:

```text
Jira remains the source of truth for Jira issues.
Azure DevOps remains the source of truth for work items.
GitHub remains the source of truth for repository issues.
```

Watchtower provides analysis and insight.

---

# MVP Upload Strategy

The first supported upload formats are:

* CSV
* XLSX

PDF is not supported for structured delivery imports.

---

# CSV First Principle

CSV provides:

* Simplicity
* Transparency
* Portability
* Low implementation cost

CSV will be the initial supported format for forecasting and reporting features.

---

# XLSX Support

XLSX is supported because:

* Multiple worksheets are possible
* Business users are familiar with Excel
* Additional context can be captured

Internally, XLSX imports should be converted into the same ingestion pipeline as CSV.

---

# Template Strategy

Watchtower provides downloadable templates.

Templates should:

* Encourage consistent data capture
* Support future feature expansion
* Remain backward compatible where practical

Required fields should be kept to the minimum necessary.

Optional fields may increase platform value.

---

# Import Processing

Imports should follow:

```text
Upload
↓
Validate
↓
Parse
↓
Normalise
↓
Store
↓
Generate Insights
```

Invalid imports should not partially load data.

---

# Validation Rules

Validation should include:

* Required fields
* Data types
* Date formats
* Duplicate identifiers
* Missing mandatory values

Validation errors should be returned to users before import.

---

# Historical Data

Historical data should be retained.

Future forecasting depends on historical delivery behaviour.

Historical imports should never be silently overwritten.

---

# Source System Model

Future integrations should support:

* Jira
* Azure DevOps
* GitHub

The architecture should assume additional connectors later.

---

# Workspace Ownership

All imports belong to a workspace.

Imports never belong directly to a user.

Example:

```text
Workspace
└── Import
    └── Imported Records
```

---

# Forecasting Inputs

The preferred long-term forecasting inputs are:

* Throughput
* Cycle Time
* Work Item Age
* Scope Volatility
* Capacity

Story points may be supported but are not the preferred forecasting model.

---

# Reliability Principle

Forecast confidence should consider:

* Sample size
* Throughput stability
* Scope volatility
* Capacity visibility
* Data quality

Forecast reliability is a first-class platform concern.

---

# Future AI Strategy

AI should operate on normalised data.

AI should not consume raw source data directly where a normalised representation exists.

This improves consistency and reduces source-specific behaviour.

---

# Consequences

Benefits:

* Consistent data model
* Easier forecasting
* Easier reporting
* Easier future integrations
* Reduced vendor lock-in

Trade-offs:

* Additional normalisation layer
* More initial architecture effort

These trade-offs are accepted because Watchtower's long-term value depends on consistent analysis across multiple delivery systems.
