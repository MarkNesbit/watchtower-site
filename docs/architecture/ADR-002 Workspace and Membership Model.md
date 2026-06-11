# ADR-002 Workspace and Membership Model

**Status:** Approved
**Date:** 11 June 2026
**Supersedes:** None
**Related:** ADR-000 Foundation Decisions, ADR-001 Authentication and Identity Model

---

# Context

Watchtower needs to support both individual users and future team, business and client-based usage.

The platform should not be designed as a single-user-only product and then rebuilt later for collaboration.

The model must support:

* Personal use
* Team use
* Client workspaces
* Business workspaces
* Role-based access
* Future billing
* Future enterprise account management
* Future portfolio and programme structures

The system must remain simple enough for MVP while avoiding future structural rework.

---

# Decision

Watchtower will use a hybrid workspace model.

The database will use the term:

Organisation

The user interface will use the term:

Workspace

Every user will receive a default personal workspace during onboarding.

That workspace may later behave as:

* A personal workspace
* A team workspace
* A business workspace
* A client workspace

without requiring a database redesign.

---

# Terminology

## Organisation

The database entity that owns platform data.

Used in:

* Database schema
* Migrations
* Row Level Security policies
* Backend logic

## Workspace

The user-facing term shown in the interface.

Used in:

* Navigation
* Settings
* Onboarding
* User documentation

---

# Workspace Types

Supported workspace types:

* personal
* team
* business
* client

## personal

A workspace created automatically for an individual user.

## team

A collaborative workspace for a delivery team or internal group.

## business

A workspace representing a company or commercial entity.

## client

A workspace representing client-specific delivery or reporting activity.

---

# New User Workspace Creation

When a new user registers:

1. A profile is created.
2. A default personal workspace is created.
3. The workspace name is generated from the user display name.
4. The user is assigned the Owner role.

Example:

Display name:

Mark Nesbit

Default workspace:

Mark Nesbit Workspace

Workspace type:

personal

Membership role:

owner

---

# Data Ownership Rule

All future business data must belong to a workspace.

Future examples include:

* Projects
* Programmes
* Portfolios
* Milestones
* Risks
* Issues
* Decisions
* Reports
* Forecasts
* Uploads
* Feature usage
* Billing records

Objects should not be owned directly by users.

Users access data through workspace membership.

---

# Membership Model

Users belong to workspaces through membership records.

A user may belong to multiple workspaces.

A workspace may have multiple users.

This relationship is managed through:

organisation_members

---

# Membership Roles

The initial supported roles are:

* owner
* admin
* member
* viewer

## owner

Full control of the workspace.

Can:

* Manage workspace settings
* Manage users
* Manage roles
* Delete or archive workspace
* Manage billing in future
* Access all workspace data

## admin

Administrative control without ownership.

Can:

* Manage users
* Manage workspace settings
* Create and manage projects
* Upload data
* Access reports

Cannot:

* Remove the owner
* Demote the owner
* Delete the workspace
* Manage billing unless later enabled

## member

Standard contributor.

Can:

* Create projects
* Edit project data
* Upload data
* Generate reports

Cannot:

* Manage users
* Manage workspace settings
* Delete the workspace

## viewer

Read-only access.

Can:

* View workspace data
* View reports

Cannot:

* Create
* Edit
* Upload
* Delete
* Manage users

---

# Membership Statuses

Supported membership statuses are:

* active
* invited
* suspended
* removed

## active

User currently has access.

## invited

User has been invited but has not yet accepted or completed onboarding.

## suspended

User temporarily cannot access the workspace.

## removed

User no longer has access but the historical membership record is retained.

---

# Workspace Settings

Workspace-level policies will be stored separately from the organisation record.

This supports future configuration without bloating the core workspace table.

Initial settings include:

* allow_user_display_name_editing
* require_mfa
* default_member_role
* allow_member_project_creation
* allow_member_data_upload

---

# Default Workspace Settings

Initial defaults:

allow_user_display_name_editing:

false

require_mfa:

false

default_member_role:

member

allow_member_project_creation:

true

allow_member_data_upload:

true

---

# Workspace Naming

Default workspace names are generated from the display name.

Example:

Display name:

Mark Nesbit

Generated workspace:

Mark Nesbit Workspace

Workspace names may later be changed by users with sufficient permissions.

---

# Slugs

Each workspace will have a URL-safe slug.

Example:

Workspace name:

Mark Nesbit Workspace

Slug:

mark-nesbit-workspace

Slugs must be unique.

If a generated slug already exists, a suffix may be added.

Example:

mark-nesbit-workspace-2

---

# Workspace Lifecycle

Workspaces should support soft deletion or archiving.

The core organisation table should include:

* archived_at
* deleted_at

This avoids immediate destructive deletion and supports future recovery, audit and billing requirements.

---

# Database Tables

The workspace model requires the following tables:

* organisations
* organisation_members
* organisation_settings

The profile table is defined separately in ADR-001.

---

# Required Fields

## organisations

Required fields:

* id
* name
* slug
* type
* created_by
* created_at
* updated_at
* archived_at
* deleted_at

## organisation_members

Required fields:

* id
* organisation_id
* user_id
* role
* status
* invited_by
* invited_at
* joined_at
* created_at
* updated_at

## organisation_settings

Required fields:

* organisation_id
* allow_user_display_name_editing
* require_mfa
* default_member_role
* allow_member_project_creation
* allow_member_data_upload
* created_at
* updated_at

---

# Access Control Principle

Workspace access must be determined by membership.

A user can access workspace data only if:

1. They are authenticated.
2. They have an active membership for that workspace.
3. Their role permits the requested action.

This principle must be enforced consistently through:

* Application logic
* Row Level Security
* Future API routes

---

# Row Level Security

Row Level Security must be enabled for workspace-owned tables.

A user must not be able to access data belonging to another workspace unless they are an active member of that workspace.

Future tables should include an organisation_id field so Row Level Security can enforce workspace boundaries.

---

# Future Billing

Billing is not part of MVP.

The workspace model must support future billing by linking billing records to a workspace rather than to an individual user.

The Owner role is expected to manage billing in future.

---

# Future Enterprise Support

The model should support future enterprise features including:

* SSO-enforced workspaces
* MFA-required workspaces
* Domain-restricted invitations
* Centralised user management
* Workspace transfer of ownership
* Workspace-level audit exports

These are anticipated but not required for MVP.

---

# Consequences

Benefits:

* Supports solo and team usage from the start
* Avoids future migration from user-owned data to workspace-owned data
* Supports future billing and enterprise models
* Gives clean access control boundaries
* Keeps the user-facing language simple

Trade-offs:

* Slightly more complex than a single-user model
* Requires careful Row Level Security policies
* Requires onboarding logic to create a default workspace

These trade-offs are accepted because the long-term product direction requires collaboration, programme management and portfolio management.
