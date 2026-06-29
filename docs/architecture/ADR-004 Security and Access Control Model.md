# ADR-004 Security and Access Control Model

**Status:** Approved
**Date:** 11 June 2026
**Related:** ADR-000 Foundation Decisions, ADR-001 Authentication and Identity Model, ADR-002 Workspace and Membership Model

---

# Context

Watchtower is intended to support:

* Individual users
* Teams
* Businesses
* Clients
* Future enterprise customers

The platform will store delivery, project, programme and portfolio information that may be commercially sensitive.

Security must be considered from the beginning without introducing unnecessary complexity into MVP.

The architecture should prioritise:

* Simplicity
* Auditability
* Least privilege
* Future scalability

---

# Decision

Watchtower will implement a layered security model consisting of:

1. Authentication
2. Workspace membership
3. Role Based Access Control (RBAC)
4. Row Level Security (RLS)
5. Audit Logging
6. Feature Access Controls

Each layer contributes to overall platform security.

No single layer should be relied upon exclusively.

---

# Security Principles

## Principle 1 - Least Privilege

Users receive only the permissions necessary to perform their role.

Access should be granted intentionally.

Access should not be granted by default.

---

## Principle 2 - Workspace Isolation

Workspaces represent security boundaries.

Users should only access data belonging to workspaces where they have active membership.

Workspace isolation must be enforced at both:

* Application level
* Database level

---

## Principle 3 - Defence in Depth

Security controls should exist at multiple layers.

Examples:

* Authentication
* RBAC
* RLS
* Audit Logging

Failure of one control should not expose all data.

---

## Principle 4 - Auditability

Security-relevant actions should be recorded.

The system should support investigation and troubleshooting.

---

# Authentication Layer

Authentication is managed by Supabase Auth.

Watchtower will not implement custom authentication.

Authentication responsibilities include:

* Registration
* Login
* Logout
* Password reset
* Email verification
* Session management

Future responsibilities include:

* MFA
* Passkeys
* SSO

---

# Workspace Membership Layer

Workspace membership determines whether a user belongs to a workspace.

A user must have:

* Valid authentication
* Active workspace membership

before any workspace data may be accessed.

Supported statuses:

* active
* invited
* suspended
* removed

Only active memberships grant access.

---

# Role Based Access Control (RBAC)

Supported roles:

* owner
* admin
* member
* viewer

---

## Owner

Full workspace control.

Can:

* Manage users
* Manage roles
* Manage workspace settings
* Archive workspace
* Delete workspace
* Manage billing in future

---

## Admin

Administrative access.

Can:

* Manage users
* Manage projects
* Manage settings

Cannot:

* Remove owner
* Transfer ownership
* Delete workspace

---

## Member

Standard contributor.

Can:

* Create projects
* Edit projects
* Upload data
* Generate reports

Cannot:

* Manage users
* Change workspace settings

---

## Viewer

Read-only access.

Can:

* View data
* View reports

Cannot:

* Create
* Edit
* Upload
* Delete

---

# Internal Test Role Simulation

WT-TEST-001 introduces a controlled internal testing utility for the authorised Mark.Nesbit.Professional production test workspace/profile only.

The utility may simulate the fixed MVP roles:

* viewer
* member
* admin
* owner

The simulation changes the effective role used by application permission helpers and RLS role checks, but it must not change `organisation_members.role`.

Simulation state is stored in `internal_role_simulations`, is scoped to the `mark-nesbit-professional` workspace, is available only when the profile has `is_internal_tester = true`, and expires automatically after 4 hours.

This is not impersonation, not a global administrator capability, not customer-facing permission management, and not an expansion of the MVP permission model.

---

# Row Level Security (RLS)

Row Level Security is mandatory.

All workspace-owned tables must use RLS.

Future examples:

* projects
* programmes
* portfolios
* reports
* uploads
* forecasts

Users must not be able to access records belonging to another workspace.

---

# Database Security Rule

Every business object should contain:

organisation_id

This allows RLS policies to determine access based on workspace membership.

Example:

## projects

id
organisation_id
name
status

The organisation_id field becomes the security boundary.

---

# Audit Logging

Audit logging is mandatory.

Security-relevant actions must be recorded.

Examples:

* User registration
* Login
* Logout
* Password reset request
* Password reset completion
* Email verification
* Workspace creation
* Workspace rename
* User invitation
* User removal
* Role changes
* Workspace setting changes
* Feature flag changes

---

# Audit Log Requirements

Audit events should capture:

* Timestamp
* User identifier
* Workspace identifier
* Event type
* Entity type
* Entity identifier

Where appropriate:

* Previous values
* New values

---

# Feature Access Control

Features may be hidden or enabled using feature flags.

Feature flags are not security controls.

Feature flags are product controls.

Security decisions must still be enforced through:

* RBAC
* RLS
* Authentication

---

# MFA Strategy

Multi-Factor Authentication is not required for MVP.

The architecture must support future MFA adoption.

Supported future methods:

* Authenticator applications
* TOTP
* Recovery codes

Workspace-level policies may require MFA.

---

# Passkey Strategy

Passkeys are not required for MVP.

Authentication architecture must support future passkey adoption.

Passkeys may become a preferred authentication method in future releases.

---

# Single Sign-On (SSO)

SSO is not required for MVP.

Future enterprise support should include:

* Microsoft Entra ID
* Google Workspace
* OpenID Connect
* SAML providers

Workspace-level SSO enforcement may be supported later.

---

# Secrets Management

Secrets must never be committed to Git.

Examples:

* API keys
* Service role keys
* Database credentials
* Third-party integration credentials

Secrets must be stored using environment variables.

---

# Production Database Access

Production database changes should occur through migrations.

Direct production changes should be avoided unless:

* Emergency recovery is required
* A documented exception is approved

---

# Data Deletion Strategy

Soft deletion is preferred.

Examples:

* archived_at
* deleted_at

Historical records should be retained where practical.

This supports:

* Auditability
* Recovery
* Compliance
* Future reporting

---

# Security Events for Future Consideration

Potential future enhancements:

* New device detection
* Suspicious login detection
* Impossible travel detection
* Risk-Based Authentication
* Security notifications
* Workspace security dashboard

These capabilities are not required for MVP.

---

# Security Ownership

Security controls should be enforced through:

1. Database policies
2. Backend logic
3. Frontend visibility controls

The frontend alone must never be trusted to enforce security.

---

# Consequences

Benefits:

* Strong security baseline
* Clean workspace isolation
* Future enterprise readiness
* Simplified compliance discussions
* Reduced likelihood of accidental data exposure

Trade-offs:

* Additional implementation effort
* More complex database policies
* More planning during MVP

These trade-offs are accepted because security and workspace isolation are foundational platform requirements.
