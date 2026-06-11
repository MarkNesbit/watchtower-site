# Watchtower Foundation Decisions Log

**Document Version:** 1.0
**Status:** Approved Foundation Decisions
**Date:** 11 June 2026

---

# Purpose

This document records the initial architectural decisions for Watchtower. Its purpose is to ensure consistency throughout development and prevent future redesign caused by forgotten assumptions or undocumented decisions.

These decisions should be considered the current baseline unless superseded by a later Architecture Decision Record (ADR).

---

# Product Vision

Watchtower is being designed as a delivery intelligence platform capable of supporting:

* Individual project management
* Programme management
* Portfolio management
* Delivery forecasting
* Delivery reporting
* Delivery health monitoring
* Team and organisational collaboration

The architecture should support both individual users and organisational/team usage without requiring future redesign of core structures.

---

# Core Architectural Principles

## Principle 1: Workspace-Centric Design

All business data belongs to a workspace.

No future object should belong directly to a user.

Examples:

* Projects
* Programmes
* Portfolios
* Reports
* Forecasts
* Uploads
* Configuration

must all belong to a workspace.

This supports:

* Multi-user collaboration
* Team ownership
* Organisational reporting
* Future billing models

---

## Principle 2: Authentication Is Not Custom Built

Authentication is delegated to Supabase Auth.

Watchtower manages:

* Profiles
* Workspaces
* Memberships
* Roles
* Permissions
* Audit logging

Supabase manages:

* User accounts
* Password hashing
* Password reset
* Email verification
* Sessions
* MFA support

---

## Principle 3: Database Changes Are Migration Driven

Database schema changes must be managed through migrations.

Manual production database edits should be avoided.

Benefits:

* Repeatability
* Traceability
* Rollback capability
* Environment consistency

---

## Principle 4: Deploy Early, Hide Incomplete Features

Feature Flags will be implemented from the start.

Incomplete functionality may be deployed but hidden.

This enables continuous deployment while maintaining platform stability.

---

# Technology Decisions

## Front End

* Astro
* TypeScript
* Tailwind CSS

## Hosting

* Cloudflare Pages

## Source Control

* GitHub

## Database

* PostgreSQL via Supabase

## Authentication

* Supabase Auth

---

# Environment Strategy

## Environments

### Local

Developer environment.

Purpose:

* Development
* Testing
* Migration validation

### Preview

Automatically generated from Git branches.

Purpose:

* Feature review
* QA testing
* Codex output validation

### Production

Live environment.

Purpose:

* Real users
* Real data
* Controlled rollout

---

## Database Environments

### watchtower-dev

Used by:

* Local development
* Preview environments

### watchtower-prod

Used by:

* Production environment

---

# Workspace Model

## Database Terminology

Database uses:

Organisation

## User Interface Terminology

User interface uses:

Workspace

---

## Workspace Types

Supported workspace types:

* personal
* team
* business
* client

---

## New User Onboarding

When a user registers:

1. Supabase account created
2. Email verification required
3. Profile created
4. Personal workspace created
5. User assigned Owner role

Example:

Display Name:
Mark Nesbit

Workspace:
Mark Nesbit Workspace

---

# Role-Based Access Control (RBAC)

## Supported Roles

### Owner

Responsibilities:

* Full control
* Workspace administration
* User management
* Billing management (future)
* Workspace deletion

### Admin

Responsibilities:

* Manage users
* Manage projects
* Manage settings

Restrictions:

* Cannot remove owner
* Cannot transfer ownership

### Member

Responsibilities:

* Create projects
* Edit projects
* Upload data
* Generate reports

Restrictions:

* Cannot manage users

### Viewer

Responsibilities:

* Read-only access

Restrictions:

* No create/edit/delete permissions

---

## Membership Statuses

Supported statuses:

* active
* invited
* suspended
* removed

---

# User Profile Model

## Display Name

Display names are automatically generated from the user’s email address.

Example:

[mark.nesbit@example.com](mailto:mark.nesbit@example.com)

becomes

Mark Nesbit

---

## Display Name Governance

Display name editing is controlled through workspace settings.

The capability exists in the data model but policy may evolve as the product matures.

This avoids future schema redesign.

---

# Password Policy

## Requirements

Minimum length:

15 characters

Maximum length:

128 characters

Supported:

* Password managers
* Browser-generated passwords
* Paste
* Long random passwords

Not required:

* Mandatory symbols
* Mandatory uppercase
* Mandatory periodic password changes

---

# Security Baseline

## Included in MVP

* Email verification
* Password reset
* Secure password storage via Supabase
* Role Based Access Control
* Row Level Security
* Audit logging
* Environment variable secrets

---

## Future Security Enhancements

* MFA
* Passkeys
* Risk-Based Authentication
* Enterprise SSO

These are anticipated but not required for MVP.

---

# Feature Flag Strategy

Feature flags exist from day one.

Example flags:

* auth_enabled
* project_tracking_enabled
* programme_tracking_enabled
* portfolio_tracking_enabled
* monte_carlo_enabled
* ai_reports_enabled

Feature flags allow deployment before public release.

---

# Foundation Database Schema

## Core Tables

Application-owned tables:

* profiles
* organisations
* organisation_members
* organisation_settings
* feature_flags
* audit_log

Authentication-owned tables:

* auth.users (Supabase)

---

# Audit Logging

Audit logging is required from the beginning.

Examples:

* User registration
* Email verification
* Login
* Password reset request
* Workspace creation
* Workspace rename
* User invitation
* Role change
* Feature flag change

The objective is to provide security visibility and support future compliance requirements.

---

# Decisions Locked In

The following decisions are approved:

✓ Workspace-centric architecture

✓ Supabase Auth

✓ PostgreSQL database

✓ GitHub as source of truth

✓ Cloudflare Pages hosting

✓ Local → Preview → Production deployment flow

✓ Separate Dev and Production databases

✓ Migration-driven schema management

✓ Feature flags from day one

✓ Role Based Access Control

✓ Personal workspace automatically created at registration

✓ Organisation database terminology / Workspace UI terminology

✓ Owner / Admin / Member / Viewer roles

✓ Audit logging from MVP

---

# Next Architecture Decision

The next major design decision is:

Project Model Design

Specifically:

* What constitutes a Project
* Project hierarchy
* Relationship between Projects, Programmes and Portfolios
* Ownership model
* Reporting model
* Forecasting model
