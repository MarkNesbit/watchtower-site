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

Authenticated pages should use the app navigation in the global header and should not add a second workspace/project navigation strip between the header and the project hero. The header-to-hero gap should follow the same compact rhythm used between the hero, control panel, and content panel.

The authenticated header currently links Dashboard, Projects and Account to implemented routes. Workspace remains visible as a disabled navigation entry until a dedicated route exists; do not point it at unrelated pages.

When WT-TEST-001 role simulation is active, `AuthenticatedLayout` shows a persistent testing-mode banner above page content. Project pages should not duplicate that banner. The reset action belongs in the banner and Account -> Test tools, and ordinary users must not see the Test tools entry.

## Hero And Context Panel

Use `ProjectPageHero` for project-level pages that need the standard context panel.

The hero should show:

- Workspace context.
- Explicit project context.
- Page title.
- Short page description.
- A subtle Watchtower visual treatment.

The hero should not normally contain the page's primary create/edit action. Keeping the hero descriptive makes page actions predictable across modules.

Authenticated project heroes should be compact product headers rather than public marketing heroes. Keep vertical padding restrained, keep the page title dominant but materially smaller than public-site hero type, and ensure the decorative brand mark stays subtle.

## Optional Control Panel

Use `ProjectControlPanel` for page-level filters, controls, status summaries, or future controls that need to remain visible but inactive.

For future controls, prefer a compact visible disabled/control-coming-soon panel instead of rendering complex non-functional controls. When controls are present but disabled, explain why and ensure they cannot be submitted accidentally.

## Main Content Panel

Use `ProjectContentPanel` for the primary page content area.

The panel should provide:

- Optional section label when it adds context not already present in the page title.
- Section title.
- Optional helper text, only when the content needs extra context.
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

## Authenticated Button Styling

Use the shared `.button` variants for authenticated page and modal actions:

- `.button--primary` for the main positive action such as Save, Add, Create, Update or Confirm.
- `.button--secondary` for Cancel, Close, Back and other supporting actions.
- `.button--destructive` for Remove, Delete, Archive or other destructive actions.

Button variants must carry their own readable background, text, hover, focus and disabled states. Do not create white-filled or pale-filled buttons with white or low-contrast text, and do not rely on the surrounding panel colour to make a button readable.

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

Use `RagReferencePill` for project references, RAG states, action states, risk exposure labels, and future compound record references where a small pill improves scanning. Shared RAG styling lives in `src/styles/rag.css` and supports `red`, `amber`, `green`, `neutral`, and `unknown` states for action-state/assurance use. Project health is not currently assessed and should display as Unknown; the older blue treatment is reserved for non-RAG reference accents and capability availability, not health or action-state meaning.

RAG colours are shared design tokens. Future Issues, Dependencies, Assumptions, Actions and Decisions screens should reuse the token classes rather than inventing page-local Red, Amber or Green values. The default active tokens are `#ff5f5f` for Red, `#f6c453` for Amber and `#6ee7a8` for Green, each with matching border and subdued background tokens. Neutral and Unknown use slate/blue-grey token sets.

Risk exposure is not a RAG/action-state value in the Watchtower Default MVP UX. Exposure labels are Critical, High, Medium and Low. Critical uses red styling, High uses orange, Medium uses amber and Low uses yellow through the dedicated `risk-critical`, `risk-high`, `risk-medium` and `risk-low` tone classes. Low exposure must not use green; Green remains reserved for action state or assurance meaning no current action due.

Pills should:

- Preserve the human-readable reference or status text.
- Use colour as a supplement, not the only signal.
- Avoid replacing canonical labels or accessible text.
- Use the shared state text, border and background tokens for the pill state.
- Use compact visible `R`, `A` and `G` labels only when a space-constrained risk reference pill is already carrying the full action state through accessible text and title. Do not use compact labels for standalone explanatory state pills.

RAG cards and panels should:

- Use the shared `rag-card` or `rag-panel` classes with a state class such as `rag-card--amber`.
- Keep the surface subdued rather than flooding the card with bright colour.
- Use the shared state token for a clear left accent border.
- Include or support an explicit RAG pill for the state label.

Dashboard capability tiles should:

- Use the shared `rag-tile` treatment and a state class such as `rag-tile--attention-red` when a capability has an action or assurance state.
- Keep Watchtower blue as the default capability availability style for neutral, unknown or not-assessed tiles, while treating explicit Red, Amber or Green tile states as action state rather than health.
- Keep icon and title visible without permanent helper copy inside the tile.
- Provide accessible labels for the state.
- Avoid count badges, red/amber dots, notification markers or health-score decoration unless a later slice explicitly introduces that pattern.

Project-scoped RAID-style registers should prefer compact table-led layouts once the module moves beyond a small proof-of-concept list. The Risk Register foundation uses this pattern first: compact graphical project-level summary cards sit above one paginated register table that separates Ref, Risk, Exposure, Lifecycle/Status, Owner, Review due and Updated. The Ref pill carries action-state colour and opens the detail page, so a separate Action state column or final Open action column should not be duplicated. Its control layer uses compact tabs, search, filters, active filter chips, reset and sort controls above the table, with page-size and pagination controls below the table. Need action views and summary cards must be based on action state, not raw seriousness/exposure. Draft backlog belongs in the Draft tab count, using Amber for one to five drafts and Red for more than five drafts. Highest exposure summaries and compact distribution charts must use exposure labels and colours, with Critical red, High orange, Medium amber and Low yellow rather than green, and must not imply project health. A side-panel action queue may sit beside the table on wider screens when it shows specific derived work rather than duplicating the register: for Risk Register this is the Needs Action panel, which lists a small number of active-risk actions, remains stable while table filters or pagination change, links to risk detail, and excludes Draft/Closed/terminal records. The Risk Register exposure distribution panel is also project-level and stable while table controls change; it uses a visible legend and accessible summary, excludes Draft risks, includes Closed risks as their own segment, and calls out unassessed active risks separately from charted exposure/closed percentages. Future Issues, Dependencies, Assumptions, Decisions and Actions modules should follow the same separation of record seriousness, action state, lifecycle/status, paginated table state and compact visual summaries where those concepts exist, without implementing those modules through the Risk Register slice.

The Risk Register default tab is Active risks. Draft and Closed rows must be reachable through their own tabs without being mixed into live-risk operations. Draft and Closed reference pills use neutral grey reference-only styling with lifecycle context in accessible labels rather than visible `NOT ACTIVE` text. Draft exposure may be displayed as provisional Estimated exposure, compatibility-default Drafts display as Unassessed, and Closed rows show no current exposure value in the register. The Draft tab may add compact Draft-only columns for activation readiness and Draft age. Readiness must come from the shared activation helper and expose missing requirements through keyboard-accessible text, such as native expandable row detail. Draft age is a neutral backlog hygiene signal calculated from `created_at`; the 14-day review challenge must not use active Red/Amber/Green action-state styling and must not feed Needs Action, dashboard signals, project attention, Narrative or health.

Project Narrative risk-linked row pills reuse the same risk reference presentation contract. Active linked risks show the current linked-risk action state as compact visible `R`, `A` or `G` labels while preserving full Red, Amber or Green wording in accessible labels and titles. Draft and Closed linked risks are neutral reference-only pills, and missing or inaccessible linked risks stay neutral with unavailable accessible text. Stored Narrative attention remains historical content and should not be used as the visible action-state pill for risk-linked rows.

Detail pages that display substantial free-text fields should keep overview cards bounded and scannable. Core Risk detail applies this to risk description, mitigation plan and contingency plan: the overview shows a 2-3 line preview, missing-field prompts remain visible on the card, and a clear View full action opens a read-only dialog with the complete escaped text, preserved line breaks and keyboard focus return. This pattern is presentation-only and must not change edit permissions, stored content, action state, exposure, lifecycle or project health. Later Issues, Dependencies and Assumptions detail pages may reuse the same bounded-preview/read-only-dialog pattern for their own long text fields.

Parent surfaces such as the Projects list and Project Dashboard must not show Red or Amber action state without a destination page explaining why. WT-SIGNAL-CONSISTENCY-001 applies this first to Project Details: the dashboard tile, Project Details action-state panel and Projects list reference pill share the same setup/date/responsibility reasons. WT-PROJ-DETAILS-SIGNALS-001 makes those reasons section-owned: the Project Details action-state panel appears below the hero/access area and before the detail sections, summarizes only section-level Red and Amber reasons, and links back to the relevant section. Each Project Details section shows an accessible compact RAG marker and subtle state accent rather than a full internal rationale banner. Green sections should be visible but calm, confirming state without adding explanatory blocks. Project Dates section state must aggregate from visible child date cards and those dates must remain timeline/setup records, not RAID records. Editable Red/Amber reasons must either have a working permission-safe edit path for permitted users or be explained as not yet resolvable in the current MVP.

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
- Avoid relying on colour alone for RAG or action states.
- Preserve safe Astro templating for user-supplied database values.

## Reusable Components

WT-US-0209 introduced these lightweight components in `src/components/app/`:

- `ProjectPageHero.astro`
- `ProjectControlPanel.astro`
- `ProjectContentPanel.astro`
- `EmptyState.astro`
- `DisabledActionHint.astro`
- `RagReferencePill.astro`

Project Narrative uses the shared hero, control panel, content panel, disabled-action helper, and empty state. The project dashboard now also uses the shared hero, status/control panel, and content panel shell while preserving its existing feature-gated tile behaviour. The project list page uses the shared content panel, empty state, disabled-action hint, and reference pill treatment without adding a single-project hero. WT-RISK-002A applies the same project-page pattern to the Risk Register and risk detail foundation, WT-RISK-002B extends it with project-scoped New Risk and Edit Risk form pages, WT-RISK-002C adds a compact register plus block-level assurance cards on risk detail, WT-RISK-003 keeps those patterns while adding actioner assignment to the risk form and action responsibility block, WT-RISK-004 makes risk detail cards focused modal entry points with comments below the detail content, WT-RISK-004A/004B consolidate and polish the detail page into a Current risk metadata strip plus Current Risk Detail section, WT-RISK-005 keeps the top reference pill as the risk action-state indicator while exposure is shown in current detail and action-state rationale is explained separately, and WT-RISK-REG-UX-005 adds the derived Needs Action panel beside the table on wide layouts. WT-RISK-NARRATIVE-001 extends the Project Narrative detail modal for source-risk entries with read-only current Risk detail, separate exposure/assurance/action-state RAG signals, and an Open full risk in new tab action; it does not add risk editing controls or turn Narrative into an audit table.

Dashboard capability tiles stay understandable from visible title text and accessible labels rather than rollover-only helper text. The Risk tile may use the shared RAG tile treatment to reflect the highest active risk assurance action state; Draft and Closed risks are excluded, exposure does not drive the state, capability availability remains separate from action state, and tiles must not gain count badges, dots, notification markers or health-scoring decorations.

## Duplication Opportunities Identified

Existing duplication or near-duplication appears in:

- Risk Register/detail/create/edit and project list primary action placement.
- Risk detail assurance block treatments and future RAID quality prompts.
- Project Narrative and future RAID no-record/error states.
- Viewer/read-only disabled action messaging across edit, risk, and narrative routes.
- RAG/action-state/reference badge treatments across dashboard tiles, risks, and narrative entries.

Future work should adopt shared components page by page rather than refactoring every authenticated route at once.

## Future Codex Prompt Guidance

Future Codex prompts for authenticated project pages should reference this document and state which module is being built or changed. The expected instruction is:

> Follow `docs/ui-page-design-standard.md` for project page layout, primary action placement, empty states, restricted actions, and mobile behaviour.

Prompts should still name any module-specific rules, permissions, route guards, feature flags, and schema boundaries. This layout standard does not grant permissions, create database fields, or replace the module source-of-truth documents.
