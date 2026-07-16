# Watchtower Semantic Icon System

Watchtower semantic product icons are owned by the central registry in `src/lib/watchtowerIcons.ts` and rendered through `src/components/app/WatchtowerIcon.astro`.

## Registry rules

- Add new semantic product icons only to `WATCHTOWER_ICON_REGISTRY`.
- Use Font Awesome Free Solid icon definitions imported explicitly from `@fortawesome/free-solid-svg-icons`.
- Keep the semantic colour fixed in the registry.
- Do not colour semantic icons from RAG, overdue, urgency, lifecycle, completion, draft or closed state.
- Keep state visible through the existing RAG pills, state pills, text, borders and attention indicators.
- Unknown or unmapped semantic values resolve to `system-event`.

## Supported sizes

`WatchtowerIcon` supports exactly three sizes:

- `full`: dashboard tiles, empty states and feature headings.
- `medium`: registers, modals, side panels and buttons.
- `small`: Timeline, Project Narrative, compact pills and dense rows.

The same glyph is used for all three sizes.

## Accessibility

Use decorative mode when visible adjacent text already names the concept:

```astro
<WatchtowerIcon icon="risk" size="small" decorative />
```

Use a meaningful icon with a label only when the icon stands alone:

```astro
<WatchtowerIcon icon="milestone" size="medium" label="Milestone" />
```

Decorative icons are hidden from assistive technology. Meaningful standalone icons render an accessible SVG title.

## Semantic vs utility icons

This registry is for Watchtower product concepts such as risks, actions, milestones, cutover and system events.

Generic interface controls remain outside this registry for now, including search, filter, sort, add, edit, delete, close, previous, next, expand, more actions, external links, attachments, comments, refresh, save and copy.

Utility icon standardisation should be handled as a separate slice.

## Fallback behavior

Use `resolveWatchtowerIconKey` or `getWatchtowerIconSvgData` when raw source values need mapping. Unknown values resolve to:

- semantic key: `system-event`
- icon: `gear`
- colour: `#6B7280`

Development rendering can warn once per unknown value so new unmapped concepts are visible without noisy repeated logs.
