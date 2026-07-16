# Watchtower Icon Audit

Audit performed for WT-ICON-SYSTEM-001 across `src`, `tests` and existing docs. Generated assets, package files, binary documents and environment-specific files were excluded.

| Location | Current icon use | Represented concept | Action taken | Registry key | Reason or exception |
| --- | --- | --- | --- | --- | --- |
| `src/lib/watchtowerIcons.ts` | New Font Awesome Free Solid imports | Central semantic product icons | Created central registry | All 24 agreed keys | Single source of truth for glyph, colour, label and fallback behavior. |
| `src/components/app/WatchtowerIcon.astro` | New shared SVG renderer | Semantic product icon display | Created shared component | All 24 agreed keys | Supports `full`, `medium`, `small`, decorative mode and labelled standalone mode. |
| `src/pages/app/workspaces/[workspaceSlug]/projects/[projectId].astro` | Unicode tile glyphs for Risks, Issues, Dependencies, Assumptions, Decisions and Actions | Dashboard module tiles | Migrated to semantic registry | `risk`, `issue`, `dependency`, `assumption`, `decision`, `action` | Tile RAG classes remain for status chrome; icon colour now comes from the registry. |
| `src/pages/app/workspaces/[workspaceSlug]/projects/[projectId].astro` | `i`, `≡`, `▦` dashboard glyphs | Project Details, Project Narrative and Timeline navigation | Retained temporarily | Not mapped | These are navigation/module symbols rather than agreed semantic product concepts. Future utility/module icon standardisation should cover them. |
| `src/lib/timeline/projectDateTimelineAdapter.ts` | Local project date icon keys including `target-end`, `review`, `project-date` | Project date Timeline events | Migrated and normalised | `project-end`, `governance-review`, `system-event` | Preserves existing date categories while aligning aliases to agreed semantic keys. |
| `src/lib/timeline/timelineFixtures.ts` | Fixture `review` icon key | Governance review fixture event | Migrated | `governance-review` | Fixture now exercises the registry key used by live project dates. |
| `src/pages/app/workspaces/[workspaceSlug]/projects/[projectId]/timeline.astro` | Unicode source and event icon maps | Timeline legend, point events and selected-day panel | Migrated to semantic registry | Project date keys, RAID keys, delivery keys, fallback `system-event` | Event RAG still controls borders/dots; icon colour no longer changes with RAG. |
| `src/lib/timeline/timelineLayers.ts` | Layer icon keys `calendar` and `period` | Disabled future project event/delivery period layers | Retained as fallback | `system-event` | No agreed semantic icon exists for those future layer concepts in this slice. |
| `src/lib/projectNarrative.ts` | No previous central source icon map | Project Narrative source types | Added registry-backed source mapping | `manual-diary-entry`, `risk`, `issue`, `dependency`, `assumption`, `system-event` | Unknown source types safely fall back to `system-event`. |
| `src/pages/app/workspaces/[workspaceSlug]/projects/[projectId]/narrative.astro` | Reference pill only | Project Narrative entry source | Migrated/prepared with small source icon | Narrative source mapping | Manual entries use pen-to-square; system/unknown entries use gear; RAG reference pill behavior remains unchanged. |
| `src/pages/app/workspaces/[workspaceSlug]/projects/[projectId]/risks.astro` | `!` summary card glyphs | Risk Register risk summary metrics | Migrated where semantic | `risk` | Open risks and need-action cards now use the agreed risk glyph. |
| `src/pages/app/workspaces/[workspaceSlug]/projects/[projectId]/risks.astro` | `^` summary card glyph and SVG exposure donut | Exposure metric and chart | Retained as generic/metric UI | Not mapped | Exposure is a metric visualization, not one of the agreed semantic product icons. |
| `src/pages/app/workspaces/[workspaceSlug]/projects/[projectId]/risks.astro` | `?`, `+`, `!` prompt modal and confirmation symbols | Risk prompt workflow UI | Retained as generic workflow markers | Not mapped | These are prompt/help/status controls and should be handled in a future utility-icon standardisation slice. |
| `src/pages/app/account/index.astro` | Inline SVG | Account/profile interface illustration | Retained as generic interface icon | Not mapped | Outside the agreed semantic product concepts. |
| CSS pseudo-elements in layout and page styles | Empty content, counters, separators such as `·` | Layout decoration and text separators | Retained as generic UI | Not mapped | Not product semantic icons. |
| Risk and Action detail/register headings | No existing semantic heading icon found | Module headings | No change | Not applicable | The slice avoids adding decorative heading icons where none currently exist. |

## Utility icons retained for future standardisation

Search, filter, sort, add, edit, delete, archive, close, calendar picker, clear date, previous, next, Today, expand, collapse, more actions, external link, attachment, comment, refresh, save and copy remain outside the semantic registry.

## Manual validation checklist

- Open the Project Dashboard and confirm Risks, Issues, Dependencies, Assumptions, Decisions and Actions use the agreed solid glyphs and fixed colours.
- Confirm Dashboard RAG status still displays independently from icon colour.
- Open the Timeline and verify project start, project end, milestone, gateway, governance review, testing, integration, deployment, cutover, training, go-live and hypercare markers.
- Verify Risk and Issue share red but have distinct silhouettes.
- Verify Dependency, Assumption and Decision share slate blue but remain visually distinct.
- Verify Timeline icon colour does not change when event RAG changes.
- Open Project Narrative and verify manual entries use pen-to-square and system or unknown entries use gear.
- Verify Risk, Issue, Dependency and Assumption narrative sources use the correct shared icons where present.
- Open Risk Register and verify risk summary cards use the agreed risk icon.
- Check keyboard focus and accessible names for icon-only controls remain intact.
- Check narrow-width rendering for Dashboard, Timeline and Project Narrative.
