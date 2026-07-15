# Timeline Foundation Architecture

**Status:** Foundation architecture plus fixture event rendering through `WT-TIMELINE-FOUNDATION-003`
**Date:** 15 July 2026

## Purpose

The Watchtower Timeline is a visualisation layer for significant delivery and assurance dates within a project. It is designed to show Project Dates, Risks, Issues, Dependencies, Assumptions, Decisions, Actions, future Project Events and future Delivery Periods in one consistent calendar model.

The first visible route is now available at `/app/workspaces/[workspaceSlug]/projects/[projectId]/timeline`. The page is read-only and currently uses bounded development fixtures to prove visual rendering. It does not create a Timeline database table, database migration, source modal or live source adapter.

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

## Monthly Page Route

`WT-TIMELINE-FOUNDATION-002` adds the workspace-scoped project route:

```text
/app/workspaces/[workspaceSlug]/projects/[projectId]/timeline
```

The route uses the existing authenticated Watchtower shell, resolves the workspace through active membership, binds the project slug to the matched workspace, and uses existing Viewer-safe project dashboard access. It queries only the selected project context needed to render the shell.

The route is reachable from the Project Dashboard Timeline tile through `buildProjectTimelinePath`.

## Month Grid Behaviour

The month grid utility is defined in `src/lib/timeline/timelineCalendarGrid.ts`.

Rules:

- Weeks run Monday to Sunday.
- Complete weeks are always returned.
- Previous-month dates are included before the first day of a month where needed.
- Following-month dates are included after the final day of a month where needed.
- Adjacent-month dates stay visible, keep normal cell dimensions and remain selectable.
- Leap years and year-boundary month navigation are handled through UTC month construction for date-only values.

The visible page defaults to the current month based on the current user-visible date calculation and selects today on first render.

## Page Structure

The Timeline page uses:

- `AuthenticatedLayout` for the app shell and Watchtower header.
- `ProjectPageHero` for workspace and project context.
- A laptop-first two-column layout with the monthly calendar on the left and a persistent selected-day panel on the right.
- A stacked layout below the laptop boundary to avoid horizontal overflow.

The calendar day cell has stable internal areas for range lanes, point-event icons and overflow indicators. Day cells are keyboard-operable grid cells rather than nested buttons so event controls can be independently focusable.

## Selected-Day Interaction

Each visible date is a semantic button. Pointer, Enter and Space activation use native button behaviour. Selecting a day updates:

- the selected-day visual state;
- `aria-pressed`;
- the selected date heading in the right-hand panel;
- the page-level selected date data attribute used by later enhancements.

Adjacent-month dates are selectable. Only one date is selected at a time.

Month navigation uses one explicit selected-date rule: previous and next month controls select the first day of the newly displayed month, while Today returns to the current month and selects today. The selected-day panel must always show the selected date that is visible in the rendered grid.

## Weekend Today And Selected States

Saturday and Sunday headings and cells use a distinct dashed/striped treatment plus visible Weekend labels in cells where space allows. The distinction is not colour-only.

Today and selected date are separate states:

- Today uses `aria-current="date"` and a visible Today marker.
- Selected date uses `aria-pressed="true"` and a stronger selected treatment.
- A day can be both today and selected.

## Loading Empty And Error States

The page includes a skeleton loading state that preserves the calendar and panel shape for future async loading.

An empty Timeline event collection is valid. The calendar still renders and the selected-day panel shows that no project activity is currently shown for the selected date.

Genuine route or context failures render a safe error state with a route back to the project area where possible. Internal errors, stack traces and raw identifiers are not exposed.

`WT-TIMELINE-FOUNDATION-003` calls the Timeline aggregation contract with one explicit fixture adapter. It does not query Project Dates, Risks, Issues, Decisions, Dependencies or Actions.

## Fixture Strategy

Fixture events live in `src/lib/timeline/timelineFixtures.ts`. They are created as `TimelineEvent` objects, scoped to the currently resolved workspace and project context, and passed through `aggregateTimelineEvents`.

The fixture set includes July 2026 UAT, integration, cutover, training and hypercare ranges, Risk, Issue, Dependency and Decision point events, adjacent-month events and a hidden-by-default Action. The fixtures are non-persistent and must not be described as live production records.

## Event Rendering Rules

Point events render as compact focusable icon controls inside the day cell point-event area. The source type is represented by an icon and accessible label. Attention or status is represented separately with a small dot, border and status text in the selected-day panel.

Range events render as horizontal bars over the week row. A same-day range is normalised to a point event before rendering. Ranges use their source/category presentation for shape and label while Red, Amber, Green and neutral status remains a separate tone treatment.

Completed fixtures remain visible with a subdued presentation. Neutral fixtures are not presented as Green unless their source state explicitly says Green.

## Range Segmentation And Lanes

Range segmentation is implemented in `src/lib/timeline/timelineEventLayout.ts`.

Rules:

- Ranges are inclusive of start and end date.
- A range crossing a week boundary is split into one segment per visible week row.
- A segment records its logical event ID, week index, start column, end column, visible segment dates, true start, true end, continuation from a previous row and continuation into a following row.
- A range that starts before or ends after the visible month still renders on adjacent-month dates where it overlaps the grid and uses continuation state rather than implying a false month-boundary start or end.

Lane allocation is deterministic. Segments in the same week row that overlap dates cannot share a lane. The allocator tries to keep the same logical event in the same lane across adjacent rows where practical, then uses the first non-overlapping lane. Visible range lanes are limited to three per week row. Hidden range segments contribute to per-day overflow indicators while remaining available in selected-day panel data when their layer is visible.

## Overflow Limits

Initial visual limits:

- Range lanes: three visible lanes per week row.
- Point icons: four visible point icons per day.

Point overflow renders as `+N`. Range overflow renders as `+N ranges`. Overflow controls are focusable, accessible and select the affected day so the full visible event set can be reviewed in the selected-day panel.

## Selected-Day And Selected-Event Behaviour

Selecting a day updates the selected date, the calendar selected state and the right-hand panel. The panel heading shows the full selected date plus the visible event count.

The selected-day panel includes every visible event active on the date:

- point events whose start date equals the selected date;
- range events whose inclusive range contains the selected date.

At laptop and desktop widths, the rendered calendar card is the height authority. The calendar keeps its natural content height, including the month grid, guidance and legend. The selected-day panel is synchronised to that measured calendar height after render and resize, then its event groups scroll internally. Busy selected days must not make the calendar card or the desktop row grow. In the stacked narrower layout, height synchronisation is removed and the event body keeps a capped scroll height rather than forcing the whole page to grow excessively.

Events are grouped by configured Timeline layer order. Empty groups are hidden. Rows show source icon, reference or category code, title, optional distinct status, summary, date or range context and a future-open affordance. For ranges, the panel shows the full range plus day number within the range.

Reference and status presentation follows this rule:

- the reference pill carries the current attention or action-state treatment;
- a separate source-type pill is hidden when the reference already identifies the source type, such as `RISK-WAT-012`, `ISSUE-WAT-006`, `DEP-WAT-007`, `DEC-WAT-009` or future `ACT-WAT` records;
- a secondary status pill is shown only when it adds different lifecycle or delivery meaning, such as Scheduled, Pending, On track, Watch or Upcoming;
- duplicate Red, Amber, Green or neutral status pills are hidden where the reference pill already carries that same tone;
- project-delivery rows may keep their short category/reference code plus a distinct delivery status.

Selecting a point icon, range segment or panel row sets one selected event, keeps the selected-day context and highlights the matching row/control. If a layer toggle hides the selected event, selected-event state is cleared while selected-day state remains.

## Layer Controls

The Layers control is sourced from `DEFAULT_TIMELINE_LAYERS`.

Default visibility:

- Project delivery: on
- Risks: on
- Issues: on
- Dependencies: on for fixture validation
- Decisions: on
- Actions: off
- Assumptions: off and disabled until connected
- Project events: off and disabled until connected
- Delivery periods: off and disabled until connected

Layer state is client-side only in this slice. It filters calendar icons, range bars, overflow counts, selected-day totals and selected-day groups. It is not persisted as a user preference.

## Ordering

Calendar and panel ordering is deterministic:

1. Range events before point events.
2. Red, then Amber, then Green, then neutral.
3. Start date.
4. Configured layer order.
5. Source reference or title.
6. Event ID as final tie-breaker.

This ordering is also used for visible point icons and range lane allocation.

## Legend And Accessibility

The legend shows only source types represented by fixture events and uses icon plus text. It does not imply that colour alone communicates status.

Event controls expose title, source type, point/range shape, date or range, status and summary through accessible labels. Hover and focus show one shared compact summary overlay. The summary is rendered as a fixed-position overlay outside day-cell content, is associated with the active trigger through `aria-describedby`, and does not use native `title` attributes for event triggers. Escape closes the active summary and the layer details panel.

Manual validation checklist for event summaries:

- point event in a central weekday cell;
- point event near the right-hand calendar edge;
- point event on the bottom visible calendar row;
- event in a weekend cell;
- range event spanning multiple cells;
- keyboard focus summary;
- pointer hover summary;
- Escape close;
- no duplicate native browser tooltip;
- no clipping behind bars, cells, neighbouring rows or overflow controls.

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

Layer configuration supports label, source types, default visibility, enabled state, order and icon metadata. Actions are supported by the architecture but default to hidden. Assumptions, Project Events and Delivery Periods are configured for future use without requiring live adapters now.

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

## Current Page Exclusions

The monthly page shell still excludes:

- live Project Date integration;
- live Risk, Issue, Decision, Dependency or Action adapters;
- reusable source modals;
- event creation;
- recurrence;
- drag-and-drop;
- source date editing;
- external calendar synchronisation;
- saved user preferences;
- clash detection;
- Timeline database persistence.
