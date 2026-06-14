# Watchtower Database Schema v1

**Document Version:** 1.0
**Status:** Draft for WT-001B Database Foundation
**Date:** 12 June 2026
**Related ADRs:** ADR-000, ADR-001, ADR-002, ADR-004, ADR-005

---

# Purpose

This document defines the initial Watchtower application database schema.

It exists to give Codex and future contributors an explicit implementation reference before database migrations are created.

Architecture Decision Records (ADRs) explain why decisions were made.

This schema document explains what should be implemented.

---

# Scope

This document covers the foundation database tables required for:

* Application profiles
* Workspaces
* Workspace membership
* Workspace settings
* Feature flags
* Audit logging

This document does not cover:

* Projects
* Programmes
* Portfolios
* Forecasts
* Reports
* Imports
* AI outputs

Those will be defined in later schema documents.

---

# Core Principles

## Supabase Auth owns authentication

The `auth.users` table is owned and managed by Supabase.

Watchtower must not manually create or modify `auth.users`.

Application tables should reference `auth.users.id` where a user relationship is required.

---

## Workspace ownership is the security boundary

The database uses the term:

`organisation`

The user interface uses the term:

`Workspace`

All future business data must belong to an organisation/workspace.

---

## Row Level Security is mandatory

All application-owned tables must have Row Level Security (RLS) enabled.

Users must not be able to access data belonging to an organisation unless they have an active membership for that organisation.

---

## Migrations only

This schema must be implemented through Supabase migration files.

Database tables must not be created manually in the Supabase UI.

---

# Naming Standards

## Table names

Use lowercase snake_case plural table names.

Examples:

* `profiles`
* `organisations`
* `organisation_members`

## Column names

Use lowercase snake_case.

Examples:

* `created_at`
* `organisation_id`
* `display_name`

## Primary keys

Use `uuid` primary keys unless otherwise stated.

## Timestamps

Use `timestamptz`.

Standard timestamp columns:

* `created_at`
* `updated_at`
* `archived_at`
* `deleted_at`

## Soft deletion

Use `deleted_at` for soft deletion where relevant.

Do not physically delete important records unless explicitly required.

---

# Table: `profiles`

## Purpose

Stores Watchtower-specific user profile information.

Authentication remains owned by Supabase Auth.

A profile record should be created for each authenticated user.

## Relationship

One profile maps to one Supabase Auth user.

`profiles.id` references `auth.users.id`.

## Fields

| Field           | Type          | Nullable | Default            | Foreign Key     | Description                                                                  |
| --------------- | ------------- | -------: | ------------------ | --------------- | ---------------------------------------------------------------------------- |
| `id`            | `uuid`        |       No | None               | `auth.users.id` | Primary key. Same identifier as the Supabase Auth user.                      |
| `email`         | `text`        |       No | None               | None            | User email address copied from Supabase Auth for display/search convenience. |
| `display_name`  | `text`        |       No | Derived from email | None            | User-facing name. Initially generated from the email address.                |
| `avatar_url`    | `text`        |      Yes | `null`             | None            | Optional profile image URL for future use.                                   |
| `last_login_at` | `timestamptz` |      Yes | `null`             | None            | Last known successful login time. May be populated later.                    |
| `created_at`    | `timestamptz` |       No | `now()`            | None            | Timestamp when the profile was created.                                      |
| `updated_at`    | `timestamptz` |       No | `now()`            | None            | Timestamp when the profile was last updated.                                 |
| `created_by`    | `uuid`        |      Yes | `null`             | `auth.users.id` | User or system actor that created the profile. Usually the same as `id`.     |
| `updated_by`    | `uuid`        |      Yes | `null`             | `auth.users.id` | User who last updated the profile. Useful where admins manage display names. |

## Constraints

* `id` is the primary key.
* `id` references `auth.users.id`.
* `email` must not be empty.
* `display_name` must not be empty.

## Notes

Display names are initially generated from the email address.

Example:

`mark.nesbit@example.com`

becomes:

`Mark Nesbit`

Display name editing is governed by workspace settings, not hardcoded user behaviour.

---

# Table: `organisations`

## Purpose

Stores workspaces.

The database term is `organisation`.

The user interface term is `Workspace`.

## Relationship

One organisation may have many members.

One organisation may own many future business records such as projects, reports, forecasts and imports.

## Fields

| Field         | Type          | Nullable | Default                  | Foreign Key     | Description                                                                 |
| ------------- | ------------- | -------: | ------------------------ | --------------- | --------------------------------------------------------------------------- |
| `id`          | `uuid`        |       No | `gen_random_uuid()`      | None            | Primary key for the workspace/organisation.                                 |
| `name`        | `text`        |       No | None                     | None            | User-facing workspace name. Example: `Mark Nesbit Workspace`.               |
| `slug`        | `text`        |       No | Generated by application | None            | URL-safe unique workspace identifier. Example: `mark-nesbit-workspace`.     |
| `type`        | `text`        |       No | `personal`               | None            | Workspace type. Supported values: `personal`, `team`, `business`, `client`. |
| `created_by`  | `uuid`        |       No | None                     | `auth.users.id` | User who created the workspace.                                             |
| `created_at`  | `timestamptz` |       No | `now()`                  | None            | Timestamp when the workspace was created.                                   |
| `updated_at`  | `timestamptz` |       No | `now()`                  | None            | Timestamp when the workspace was last updated.                              |
| `archived_at` | `timestamptz` |      Yes | `null`                   | None            | Timestamp when the workspace was archived. Null means not archived.         |
| `deleted_at`  | `timestamptz` |      Yes | `null`                   | None            | Soft deletion timestamp. Null means not deleted.                            |

## Constraints

* `id` is the primary key.
* `slug` must be unique.
* `type` must be one of: `personal`, `team`, `business`, `client`.
* `name` must not be empty.
* `created_by` references `auth.users.id`.

## Notes

Every new user receives a default personal workspace.

Example:

Display name:

`Mark Nesbit`

Workspace:

`Mark Nesbit Workspace`

Type:

`personal`

---

# Table: `organisation_members`

## Purpose

Connects users to workspaces and defines their role.

This table is the basis of workspace access control.

## Relationship

Many users may belong to many organisations.

A user may belong to multiple workspaces.

A workspace may have multiple users.

## Fields

| Field             | Type          | Nullable | Default             | Foreign Key        | Description                                                                             |
| ----------------- | ------------- | -------: | ------------------- | ------------------ | --------------------------------------------------------------------------------------- |
| `id`              | `uuid`        |       No | `gen_random_uuid()` | None               | Primary key for the membership record.                                                  |
| `organisation_id` | `uuid`        |       No | None                | `organisations.id` | Workspace the membership belongs to.                                                    |
| `user_id`         | `uuid`        |       No | None                | `auth.users.id`    | User who is a member of the workspace.                                                  |
| `role`            | `text`        |       No | `member`            | None               | User role within the workspace. Supported values: `owner`, `admin`, `member`, `viewer`. |
| `status`          | `text`        |       No | `active`            | None               | Membership status. Supported values: `active`, `invited`, `suspended`, `removed`.       |
| `invited_by`      | `uuid`        |      Yes | `null`              | `auth.users.id`    | User who invited this member. Null for automatically created owner membership.          |
| `invited_at`      | `timestamptz` |      Yes | `null`              | None               | Timestamp when the invitation was created.                                              |
| `joined_at`       | `timestamptz` |      Yes | `now()`             | None               | Timestamp when the user joined. For the original owner this may equal creation time.    |
| `created_at`      | `timestamptz` |       No | `now()`             | None               | Timestamp when the membership record was created.                                       |
| `updated_at`      | `timestamptz` |       No | `now()`             | None               | Timestamp when the membership record was last updated.                                  |

## Constraints

* `id` is the primary key.
* `organisation_id` references `organisations.id`.
* `user_id` references `auth.users.id`.
* `role` must be one of: `owner`, `admin`, `member`, `viewer`.
* `status` must be one of: `active`, `invited`, `suspended`, `removed`.
* A user should not have duplicate membership records for the same organisation.
* Each organisation should have at least one owner.

## Notes

Only `active` memberships grant access to workspace data.

Admins must not be able to demote or remove the owner.

That rule may be enforced through application logic and/or database policies.

---

# Table: `organisation_settings`

## Purpose

Stores workspace-level configuration and policy settings.

Keeping settings separate from `organisations` avoids bloating the core workspace table.

## Relationship

One organisation has one settings record.

`organisation_settings.organisation_id` is both primary key and foreign key.

## Fields

| Field                             | Type          | Nullable | Default  | Foreign Key        | Description                                                                               |
| --------------------------------- | ------------- | -------: | -------- | ------------------ | ----------------------------------------------------------------------------------------- |
| `organisation_id`                 | `uuid`        |       No | None     | `organisations.id` | Primary key. References the workspace these settings belong to.                           |
| `allow_user_display_name_editing` | `boolean`     |       No | `false`  | None               | Controls whether users can edit their own display name.                                   |
| `require_mfa`                     | `boolean`     |       No | `false`  | None               | Future policy controlling whether workspace members must use Multi-Factor Authentication. |
| `default_member_role`             | `text`        |       No | `member` | None               | Default role assigned to invited users unless specified otherwise.                        |
| `allow_member_project_creation`   | `boolean`     |       No | `true`   | None               | Controls whether members can create projects.                                             |
| `allow_member_data_upload`        | `boolean`     |       No | `true`   | None               | Controls whether members can upload data files.                                           |
| `created_at`                      | `timestamptz` |       No | `now()`  | None               | Timestamp when the settings record was created.                                           |
| `updated_at`                      | `timestamptz` |       No | `now()`  | None               | Timestamp when the settings record was last updated.                                      |

## Constraints

* `organisation_id` is the primary key.
* `organisation_id` references `organisations.id`.
* `default_member_role` must be one of: `admin`, `member`, `viewer`.

## Notes

Owner should not be a default invited role.

Owner assignment should be explicit.

---

# Table: `feature_flags`

## Purpose

Controls whether platform features are visible or enabled.

Feature flags allow incomplete features to be deployed safely but hidden from users.

Feature flags are product controls, not security controls.

## Relationship

Feature flags may be global or workspace-specific.

If `organisation_id` is null, the flag is global.

If `organisation_id` is populated, the flag applies to that workspace.

## Fields

| Field             | Type          | Nullable | Default             | Foreign Key        | Description                                                        |
| ----------------- | ------------- | -------: | ------------------- | ------------------ | ------------------------------------------------------------------ |
| `id`              | `uuid`        |       No | `gen_random_uuid()` | None               | Primary key for the feature flag.                                  |
| `key`             | `text`        |       No | None                | None               | Machine-readable feature key. Example: `project_tracking_enabled`. |
| `name`            | `text`        |       No | None                | None               | Human-readable feature name. Example: `Project Tracking`.          |
| `description`     | `text`        |      Yes | `null`              | None               | Explanation of what the feature flag controls.                     |
| `enabled`         | `boolean`     |       No | `false`             | None               | Whether the feature is enabled.                                    |
| `organisation_id` | `uuid`        |      Yes | `null`              | `organisations.id` | Optional workspace-specific override. Null means global.           |
| `created_at`      | `timestamptz` |       No | `now()`             | None               | Timestamp when the flag was created.                               |
| `updated_at`      | `timestamptz` |       No | `now()`             | None               | Timestamp when the flag was last updated.                          |

## Constraints

* `id` is the primary key.
* `key` must not be empty.
* Global flags should be unique by `key` where `organisation_id` is null.
* Workspace-specific flags should be unique by `key` and `organisation_id`.

## Initial Feature Flags

Suggested initial global flags:

| Key                          | Default | Description                                                          |
| ---------------------------- | ------: | -------------------------------------------------------------------- |
| `auth_enabled`               |  `true` | Enables authentication foundation behaviour once auth screens exist. |
| `project_tracking_enabled`   | `false` | Controls project tracking features.                                  |
| `programme_tracking_enabled` | `false` | Controls programme tracking features.                                |
| `portfolio_tracking_enabled` | `false` | Controls portfolio tracking features.                                |
| `monte_carlo_enabled`        | `false` | Controls Monte Carlo forecasting features.                           |
| `ai_reports_enabled`         | `false` | Controls AI-generated reporting features.                            |

---

# Table: `audit_log`

## Purpose

Records security-relevant and administration-relevant events.

Audit logging is required from the beginning to support traceability, troubleshooting and future compliance needs.

## Relationship

Audit records may relate to a workspace, user or entity.

`organisation_id` may be null for account-level events that occur before a workspace exists.

## Fields

| Field             | Type          | Nullable | Default             | Foreign Key        | Description                                                            |
| ----------------- | ------------- | -------: | ------------------- | ------------------ | ---------------------------------------------------------------------- |
| `id`              | `uuid`        |       No | `gen_random_uuid()` | None               | Primary key for the audit event.                                       |
| `organisation_id` | `uuid`        |      Yes | `null`              | `organisations.id` | Workspace affected by the event. Null for account-level events.        |
| `actor_user_id`   | `uuid`        |      Yes | `null`              | `auth.users.id`    | User who performed the action. Null for system-generated events.       |
| `action`          | `text`        |       No | None                | None               | Machine-readable event name. Example: `workspace.created`.             |
| `entity_type`     | `text`        |      Yes | `null`              | None               | Type of entity affected. Example: `profile`, `organisation`, `member`. |
| `entity_id`       | `uuid`        |      Yes | `null`              | None               | Identifier of the affected entity where applicable.                    |
| `old_values`      | `jsonb`       |      Yes | `null`              | None               | Previous values for changed fields.                                    |
| `new_values`      | `jsonb`       |      Yes | `null`              | None               | New values for changed fields.                                         |
| `ip_address`      | `text`        |      Yes | `null`              | None               | Optional IP address for security investigation.                        |
| `user_agent`      | `text`        |      Yes | `null`              | None               | Optional browser/device information.                                   |
| `created_at`      | `timestamptz` |       No | `now()`             | None               | Timestamp when the audit event was recorded.                           |

## Constraints

* `id` is the primary key.
* `organisation_id` references `organisations.id`.
* `actor_user_id` references `auth.users.id`.
* `action` must not be empty.

## Initial Audit Actions

Suggested initial audit action names:

* `user.registered`
* `user.email_verified`
* `user.logged_in`
* `user.logged_out`
* `user.password_reset_requested`
* `user.password_reset_completed`
* `workspace.created`
* `workspace.renamed`
* `workspace.archived`
* `member.invited`
* `member.joined`
* `member.role_changed`
* `member.suspended`
* `member.removed`
* `profile.display_name_changed`
* `feature_flag.updated`

---

# Required Database Functions

## Function: derive display name from email

Purpose:

Generate an initial display name from the email address.

Example:

`mark.nesbit@example.com`

becomes:

`Mark Nesbit`

This may be implemented as a database function or application helper.

For onboarding consistency, Codex should choose the simplest reliable implementation.

---

## Function: update `updated_at`

Purpose:

Automatically refresh `updated_at` timestamps when records are updated.

This should preferably be implemented as a reusable database trigger function.

---

# Required Onboarding Behaviour

When a new Supabase Auth user is created, the application must eventually create:

1. `profiles` record
2. `organisations` record
3. `organisation_members` owner record
4. `organisation_settings` record
5. `audit_log` records

However, the exact implementation point is to be decided in WT-001B or WT-001D.

Options include:

* Database trigger on `auth.users`
* Application-level onboarding transaction

Codex must not invent this behaviour without making the implementation choice explicit.

---

# Row Level Security Requirements

RLS must be enabled on all application-owned tables.

Initial policy intent:

## `profiles`

Users may read their own profile.

Workspace owners/admins may later read or manage member profiles where required.

## `organisations`

Users may read organisations where they have an active membership.

Owners/admins may update workspace settings according to role permissions.

## `organisation_members`

Users may read membership records for organisations where they have active membership.

Owners/admins may manage members, subject to owner-protection rules.

## `organisation_settings`

Users may read settings for organisations where they have active membership.

Owners/admins may update settings.

## `feature_flags`

Users may read enabled global flags and applicable workspace flags.

Only administrative/system flows may update feature flags.

## `audit_log`

Users should not generally update audit records.

Owners/admins may later view audit records for their workspace.

Audit logs should be append-only in normal application usage.

---

# WT-001B Migration Expectations

WT-001B should create migrations for:

1. Core enum/check constraints or equivalent validation
2. `profiles`
3. `organisations`
4. `organisation_members`
5. `organisation_settings`
6. `feature_flags`
7. `audit_log`
8. Updated timestamp trigger helper
9. Basic RLS enablement
10. Initial read policies where safe
11. Seed data for initial global feature flags if appropriate

WT-001B must not create:

* Login pages
* Registration pages
* Dashboard UI
* Project tables
* Programme tables
* Portfolio tables
* Forecast tables
* Import tables

---

# Open Implementation Questions

The following decisions should be confirmed during WT-001B or before WT-001D:

1. Should profile/workspace creation happen via database trigger or application onboarding logic?
2. Should audit log writes happen via database triggers, application service functions, or both?
3. Should `profiles.email` be kept in sync automatically with `auth.users.email`?
4. How should owner-protection rules be enforced initially?
5. Should initial RLS policies be read-only until application flows exist?

---

# Current Decision

For WT-001B, create the foundation schema and safe RLS baseline.

Do not yet implement full onboarding behaviour unless explicitly instructed.

The priority is to establish the database foundation safely and repeatably through migrations.
