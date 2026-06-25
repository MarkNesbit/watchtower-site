# Watchtower UI Page Design Standard

**Status:** Foundation standard introduced by WT-US-0209

**Scope:** Authenticated project-level pages and future RAID module pages reached from a project.

## Purpose

Watchtower project pages should feel consistent as the product expands from project foundation into Project Narrative, Risks, Issues, Dependencies, Assumptions and related assurance areas. Users should always know which Workspace and project they are in, where the main action lives, how to scan records, and why an action is unavailable.

This standard defines the shared page structure and the reusable components introduced for new project-level pages.

## Universal Authenticated Project Page Structure

Authenticated project pages should normally use this order:

1. Authenticated global navigation from `AuthenticatedLayout`.
2. Project hero/context panel.
3. Optional control, filter, or status panel.
4. Main content panel.
5. Table, list, or card content.
6. Empty state when no records exist.
7. Restricted-action messaging when a visible capability is not available to the current role or feature state.

The pattern is deliberately lightweight. Pages can omit optional regions when they do not apply, but they should not invent unrelated header, action, or empty-state structures.

## Hero And Context Panel

Use `ProjectPageHero` for project-level pages that need the standard context panel.

The hero should show:

- Workspace context.
- Explicit project context.
- Page title.
- Short page description.
- A subtle Watchtower visual treatment.

The hero should not normally contain the page's primary create/edit action. Keeping the hero descriptive makes page actions predictable across modules.

## Optional Control Panel

Use `ProjectControlPanel` for page-level filters, controls, status summaries, or future controls that need to remain visible but inactive.

For future controls, prefer a compact visible disabled/control-coming-soon panel instead of rendering complex non-functional controls. When controls are present but disabled, explain why and ensure they cannot be submitted accidentally.

## Main Content Panel

Use `ProjectContentPanel` for the primary page content area.

The panel should provide:

- Section label.
- Section title.
- Helper text.
- A consistent top-right primary action slot on desktop.
- A clearly reachable action position on mobile before the main content.

The content panel should contain the main table, list, cards, or empty state for the page.

## Primary Action Placement

Primary page-level actions belong in the `ProjectContentPanel` action slot.

Examples include:

- New Entry.
- Create Risk.
- Add Issue.
- Add Dependency.
- Add Assumption.
- Edit Project Details.

Desktop placement should normally be top-right of the main content panel header. Mobile placement should remain above the records/content and stretch or stack cleanly when space is tight.

## Secondary Action Placement

Secondary actions should sit inside the card, row, modal, detail section, or local action group they affect.

Examples:

- Back to project.
- Open detail.
- Remove link.
- Cancel modal.

Secondary actions should not compete visually with the primary page-level action.

## Empty State Pattern

Use `EmptyState` for no-record states and recoverable content-load failures.

Empty states should:

- State what is currently missing.
- Explain what will appear there.
- Respect the user's permission level.
- Avoid implying that a read-only user can create or edit data.

## Restricted-Action Pattern

Users may be able to see a capability but not use it because of role, feature state, or delivery readiness.

When a capability is visible but unavailable:

- Keep the action visible when it helps users understand the capability exists.
- Disable the action using native `disabled` for buttons or `aria-disabled="true"` for non-button elements.
- Provide a concise explanation next to the action.
- Do not change permission checks or Row Level Security to satisfy a layout need.

`DisabledActionHint` provides the small helper text pattern for visible-but-disabled actions.

## Table, List And Card Pattern

Record lists should favour predictable columns, stable reference identifiers, and clear row-level actions.

Tables should:

- Use semantic table markup for tabular records.
- Keep reference/action cells visually distinct.
- Use horizontal scrolling rather than compressing columns past readability.
- Avoid exposing internal UUIDs or implementation-only sequence fields.

Cards should be reserved for individual repeated items, modals, and genuinely framed tools. Avoid placing UI cards inside other cards.

## RAG And Reference Pill Pattern

Use `RagReferencePill` or an equivalent local badge for project references, RAG states, attention states, and future compound record references where a small pill improves scanning.

Pills should:

- Preserve the human-readable reference or status text.
- Use colour as a supplement, not the only signal.
- Avoid replacing canonical labels or accessible text.

## Mobile Behaviour

Project pages must remain usable from narrow mobile widths:

- Hero content stacks before decorative visuals.
- Primary actions remain above the main content.
- Tables use horizontal scrolling when columns cannot fit.
- Buttons and form controls must not overflow their containers.
- Modal actions should stack when necessary.

## Accessibility Expectations

Project pages should:

- Use one clear `h1` for the page title.
- Give panels accessible labels through headings and `aria-labelledby`.
- Use native buttons for actions that open modals or submit forms.
- Use links only for navigation.
- Keep disabled actions non-interactive and explain the restriction.
- Avoid relying on colour alone for RAG or attention states.
- Preserve safe Astro templating for user-supplied database values.

## Reusable Components

WT-US-0209 introduced these lightweight components in `src/components/app/`:

- `ProjectPageHero.astro`
- `ProjectControlPanel.astro`
- `ProjectContentPanel.astro`
- `EmptyState.astro`
- `DisabledActionHint.astro`
- `RagReferencePill.astro`

Project Narrative now uses the shared hero, control panel, content panel, disabled-action helper, and empty state. The project dashboard and Risk placeholder retain their existing markup for this slice, but are clear candidates for later incremental adoption.

## Duplication Opportunities Identified

Existing duplication or near-duplication appears in:

- Project dashboard and Project Narrative hero/context markup.
- Project dashboard, Project Narrative, Risk placeholder, and project list primary action placement.
- Project Narrative and future RAID no-record/error states.
- Viewer/read-only disabled action messaging across edit, risk, and narrative routes.
- RAG/attention/reference badge treatments across project health, dashboard tiles, risks, and narrative entries.

Future work should adopt shared components page by page rather than refactoring every authenticated route at once.

## Future Codex Prompt Guidance

Future Codex prompts for authenticated project pages should reference this document and state which module is being built or changed. The expected instruction is:

> Follow `docs/ui-page-design-standard.md` for project page layout, primary action placement, empty states, restricted actions, and mobile behaviour.

Prompts should still name any module-specific rules, permissions, route guards, feature flags, and schema boundaries. This layout standard does not grant permissions, create database fields, or replace the module source-of-truth documents.
