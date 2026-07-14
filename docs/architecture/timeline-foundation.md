# Timeline Foundation Architecture

**Status:** Foundation slice for `WT-TIMELINE-FOUNDATION-001`
**Date:** 14 July 2026

## Purpose

The Watchtower Timeline is a visualisation layer for significant delivery and assurance dates within a project. It is designed to show Project Dates, Risks, Issues, Dependencies, Assumptions, Decisions, Actions, future Project Events and future Delivery Periods in one consistent calendar model.

This slice does not create a Timeline page, route, database table, database migration, source modal or live source adapter.

## Source Of Truth

Source modules remain authoritative. The Timeline must not own editable copies of Risk, Issue, Decision, Dependency, Action or Project Date records.

Changing a Timeline-displayed date must eventually update the originating source module. Deleting, archiving or hiding a source record must remove it from Timeline responses through that source adapter. The Timeline must not persist duplicated projection rows to represent source records.

Routine audit timestamps such as `created_at` and `updated_at` do not qualify as Timeline dates.

## Event Contract

The common event contract is defined in `src/lib/timeline/timelineTypes.ts`.

Initial source types are:

- `project-date`
- `risk`
- `issue`
- `dependency`
- `assumption`
- `decision`
- `action`
- `project-event`
- `delivery-period`

Each `TimelineEvent` carries workspace and project ownership, source type, source record ID, display text, start date, optional end date, all-day state, presentation type, layer, icon, optional modal key, optional route and source-derived permission fields.

The contract also reserves optional recurrence and movement fields:

- `seriesId`
- `occurrenceId`
- `originalOccurrenceDate`
- `canMove`
- `lockedReason`

These fields are readiness only. This slice does not calculate recurrence, create occurrences, move dates or update source records.

## Date Rules

Timeline project dates use date-only strings in `YYYY-MM-DD` format. The current helpers avoid timezone conversion for comparisons and compare date-only strings directly after validation.

Ranges are inclusive. A range is active on both its start date and end date.

Normalisation is fail-fast for visible adapter output:

- `startDate` is required.
- Missing `endDate` is treated as a single-day point event.
- `endDate` equal to `startDate` is normalised to the same single-day point event shape.
- `endDate` before `startDate` is invalid.
- A multi-day event is normalised to `presentationType: "range"`.

The `allDay` flag is required so future timed project events and external calendar integrations are not blocked by a date-only foundation.

## Overlap Logic

`timelineEventOverlapsRange` checks whether an event overlaps a visible date range using inclusive boundaries:

```text
event.startDate <= visibleEndDate
and
eventEndDate >= visibleStartDate
```

This includes events that start before the visible period and end inside it, start inside the visible period and end after it, span the whole visible period, occur exactly on either visible boundary, or are single-day events on either boundary.

## Adapter Pattern

Each source module should expose a `TimelineSourceAdapter` when it is ready to contribute events. The adapter receives:

- workspace ID
- project ID
- visible start date
- visible end date
- viewer ID
- optional permission context

The adapter must query or accept source records using the module's own ownership and permission rules, convert qualifying records to `TimelineEvent`, preserve source record IDs, preserve source-derived permissions, and avoid duplicate source records.

Adapters must not broaden permissions. If a viewer cannot see a source record in its originating module, that record must not be returned as a visible Timeline event.

## Aggregation Pattern

`aggregateTimelineEvents` is the central in-memory aggregation pattern. It receives enabled source adapters, calls each adapter with the same workspace, project and visible date context, then:

- excludes events with `canView: false`
- excludes events whose workspace or project does not match the requested context
- normalises visible events
- removes exact duplicate source/date/layer events
- sorts by start date, range before point, configured layer order and display label

The aggregator does not store Timeline data in the database.

## Layer Model

Layer defaults are defined in `src/lib/timeline/timelineLayers.ts`.

Initial layers:

- Project delivery
- Risks
- Issues
- Dependencies
- Assumptions
- Decisions
- Actions
- Project events
- Delivery periods

Layer configuration supports label, source types, default visibility, enabled state, order and icon metadata. Actions are supported by the architecture but default to hidden. Assumptions, Dependencies, Project Events and Delivery Periods are configured for future use without requiring live adapters now.

No user preference persistence is implemented in this slice.

## Modal Readiness

The modal registry contract is defined in `src/lib/timeline/timelineModalRegistry.ts`.

Future Timeline UI should resolve source modals through a registry using:

- modal key
- source type
- source ID
- permission context

The Timeline page should not contain source-specific modal branching. Source modules remain responsible for modal content, permission behaviour and save logic. A modal close that changes the source record should trigger a source refresh rather than mutating duplicated Timeline state.

## Movement Readiness

Future movement should distinguish between:

- movable project events
- source-controlled dates
- locked dates

`canMove` and `lockedReason` are source-derived fields. Future drag-and-drop should pass a proposed date-change object to a source update handler and support movement scope where recurrence exists: occurrence, following occurrences or series.

This slice does not implement drag-and-drop, date-edit confirmation or source updates from the Timeline.

## Recurrence Readiness

Future recurring project events can use `seriesId`, `occurrenceId` and `originalOccurrenceDate` to distinguish series and generated occurrences. Recurrence rules and exception handling are intentionally outside this slice.

## Adding A Future Source

To subscribe a module to the Timeline:

1. Confirm the source module owns the authoritative records and permissions.
2. Add or reuse source fields that represent significant delivery or assurance dates.
3. Implement a `TimelineSourceAdapter` for that module.
4. Query records by workspace, project and visible date range.
5. Convert each qualifying record to `TimelineEvent`.
6. Set `canView`, `canEdit` and `canMove` from source permissions.
7. Set a layer and icon key from the layer configuration.
8. Set `modalKey` or `route` only when a reusable source interaction exists.
9. Add adapter-level tests for qualification, permissions and duplicate prevention.
10. Register the adapter with the Timeline aggregation path for the visible page slice.

Future Timeline UI must provide accessible event labels and must not rely on colour or icons alone.
