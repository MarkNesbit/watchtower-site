import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
	buildRiskPromptSeedSql,
	parseCsv,
	RISK_PROMPT_CSV_HEADERS,
	validateRiskPromptCsv,
} from '../scripts/seed-risk-prompts.mjs';
import {
	getDefaultRiskPromptLibraryForSelection,
	getDefaultRiskPromptLibrarySummary,
} from '../src/lib/riskPrompts.ts';
import {
	clearRiskPromptSelections,
	createRiskPromptSelectionState,
	deselectRiskPrompt,
	getSelectedPromptCount,
	getSelectedPromptCountByArea,
	getSelectedPromptCountsByArea,
	getSelectedPromptTotalLabel,
	getSelectedRiskPromptGroups,
	isRiskPromptSelected,
	removeUnknownRiskPromptSelections,
	selectRiskPrompt,
	toggleRiskPrompt,
} from '../src/lib/riskPromptSelection.ts';

const csvUrl = new URL('../data/risk-prompts/watchtower_default_risk_prompt_library_v1_0.csv', import.meta.url);
const migrationUrl = new URL('../supabase/migrations/20260708000100_risk_prompt_library_foundation.sql', import.meta.url);
const seedSqlUrl = new URL('../supabase/seed-risk-prompts.sql', import.meta.url);
const accountPageUrl = new URL('../src/pages/app/account/index.astro', import.meta.url);
const riskRegisterPageUrl = new URL('../src/pages/app/workspaces/[workspaceSlug]/projects/[projectId]/risks.astro', import.meta.url);

async function loadCsv() {
	return readFile(csvUrl, 'utf8');
}

function mutateCsvRows(content, mutator) {
	const rows = parseCsv(content);
	const headers = rows[0];
	const row = rows[1];
	mutator(headers, row, rows);
	const serialiseField = (value) => /[",\r\n]/.test(value)
		? `"${value.replaceAll('"', '""')}"`
		: value;
	return `${rows.map((cells) => cells.map(serialiseField).join(',')).join('\n')}\n`;
}

function createRiskPromptSummaryClient() {
	const calls = [];
	const client = {
		calls,
		from(table) {
			calls.push(['from', table]);
			const query = {
				table,
				selectValue: '',
				filters: [],
				select(value) {
					this.selectValue = value;
					calls.push(['select', table, value]);
					return this;
				},
				eq(column, value) {
					this.filters.push([column, value]);
					calls.push(['eq', table, column, value]);
					return this;
				},
				order(column, options) {
					calls.push(['order', table, column, options]);
					return this;
				},
				limit(value) {
					calls.push(['limit', table, value]);
					return this;
				},
				maybeSingle() {
					calls.push(['maybeSingle', table]);
					return {
						data: {
							id: 'library-1',
							risk_library_key: 'watchtower-default',
							risk_library_version: '1.0',
							name: 'Watchtower Default Risk Prompt Library V1.0',
							description: 'Default prompts.',
							is_default: true,
							is_active: true,
						},
						error: null,
					};
				},
				then(resolve) {
					if (table === 'risk_prompt_areas') {
						resolve({ data: Array.from({ length: 12 }, (_, index) => ({ id: `area-${index + 1}` })), error: null });
						return;
					}
					if (table === 'risk_prompts') {
						resolve({ data: Array.from({ length: 96 }, (_, index) => ({ id: `prompt-${index + 1}` })), error: null });
						return;
					}
					resolve({ data: [], error: null });
				},
			};
			return query;
		},
	};
	return client;
}

function createRiskPromptSelectionClient({
	library = {
		id: 'library-1',
		risk_library_key: 'watchtower-default',
		risk_library_version: '1.0',
		name: 'Watchtower Default Risk Prompt Library V1.0',
	},
	areas = [
		{ id: 'area-schedule', risk_area_key: 'schedule', risk_area_title: 'Schedule', risk_area_order: 1 },
		{ id: 'area-scope', risk_area_key: 'scope', risk_area_title: 'Scope', risk_area_order: 2 },
	],
	prompts = [
		{
			id: 'prompt-1',
			risk_prompt_area_id: 'area-schedule',
			risk_prompt_id: 'WT-RP-001',
			risk_prompt_title: 'First schedule prompt',
			risk_prompt_guidance: 'First guidance.',
			risk_prompt_order: 1,
		},
		{
			id: 'prompt-2',
			risk_prompt_area_id: 'area-schedule',
			risk_prompt_id: 'WT-RP-002',
			risk_prompt_title: 'Second schedule prompt',
			risk_prompt_guidance: 'Second guidance.',
			risk_prompt_order: 2,
		},
		{
			id: 'prompt-3',
			risk_prompt_area_id: 'area-scope',
			risk_prompt_id: 'WT-RP-003',
			risk_prompt_title: 'Scope prompt',
			risk_prompt_guidance: 'Scope guidance.',
			risk_prompt_order: 1,
		},
	],
	libraryError = null,
	areaError = null,
	promptError = null,
} = {}) {
	const calls = [];
	const client = {
		calls,
		from(table) {
			calls.push(['from', table]);
			const query = {
				table,
				selectValue: '',
				select(value) {
					this.selectValue = value;
					calls.push(['select', table, value]);
					return this;
				},
				eq(column, value) {
					calls.push(['eq', table, column, value]);
					return this;
				},
				order(column, options) {
					calls.push(['order', table, column, options]);
					return this;
				},
				limit(value) {
					calls.push(['limit', table, value]);
					return this;
				},
				maybeSingle() {
					calls.push(['maybeSingle', table]);
					return { data: library, error: libraryError };
				},
				then(resolve) {
					if (table === 'risk_prompt_areas') {
						resolve({ data: areas, error: areaError });
						return;
					}
					if (table === 'risk_prompts') {
						resolve({ data: prompts, error: promptError });
						return;
					}
					resolve({ data: [], error: null });
				},
			};
			return query;
		},
	};
	return client;
}

test('Watchtower Default Risk Prompt Library CSV validates with expected MVP counts', async () => {
	const seed = validateRiskPromptCsv(await loadCsv());
	assert.deepEqual(RISK_PROMPT_CSV_HEADERS, [
		'risk_prompt_id',
		'risk_library_key',
		'risk_library_version',
		'risk_area_key',
		'risk_area_title',
		'risk_area_order',
		'risk_prompt_title',
		'risk_prompt_guidance',
		'risk_prompt_order',
		'risk_prompt_is_active',
		'risk_default_status',
		'risk_source_reference',
		'risk_tags',
	]);
	assert.equal(seed.library.risk_library_key, 'watchtower-default');
	assert.equal(seed.library.risk_library_version, '1.0');
	assert.equal(seed.areas.length, 12);
	assert.equal(seed.areas.filter((area) => area.is_active).length, 12);
	assert.equal(seed.prompts.length, 96);
	assert.equal(seed.prompts.filter((prompt) => prompt.risk_prompt_is_active).length, 96);
	assert.equal(new Set(seed.prompts.map((prompt) => prompt.risk_prompt_id)).size, 96);
	assert.equal(seed.prompts.every((prompt) => prompt.risk_default_status === 'draft'), true);
});

test('Risk prompt CSV validation rejects duplicate IDs and required-value failures clearly', async () => {
	const content = await loadCsv();
	const duplicateIdCsv = mutateCsvRows(content, (_headers, row, lines) => {
		const second = lines[2];
		second[0] = row[0];
	});
	assert.throws(() => validateRiskPromptCsv(duplicateIdCsv), /duplicate risk_prompt_id WT-RP-001/);

	const missingTitleCsv = mutateCsvRows(content, (headers, row) => {
		row[headers.indexOf('risk_prompt_title')] = '';
	});
	assert.throws(() => validateRiskPromptCsv(missingTitleCsv), /risk_prompt_title is required/);

	const invalidStatusCsv = mutateCsvRows(content, (headers, row) => {
		row[headers.indexOf('risk_default_status')] = 'open';
	});
	assert.throws(() => validateRiskPromptCsv(invalidStatusCsv), /risk_default_status must be draft/);
});

test('Risk prompt seed SQL is idempotent and updates existing records without deleting removed rows', async () => {
	const seed = validateRiskPromptCsv(await loadCsv());
	const sql = buildRiskPromptSeedSql(seed);

	assert.match(sql, /begin;/);
	assert.match(sql, /commit;/);
	assert.match(sql, /on conflict \(risk_library_key, risk_library_version\) do update/);
	assert.match(sql, /on conflict \(risk_prompt_library_id, risk_area_key\) do update/);
	assert.match(sql, /on conflict \(risk_prompt_id\) do update/);
	assert.match(sql, /risk_prompt_is_active = excluded\.risk_prompt_is_active/);
	assert.match(sql, /risk_prompt_guidance = excluded\.risk_prompt_guidance/);
	assert.match(sql, /risk_prompt_order = excluded\.risk_prompt_order/);
	assert.match(sql, /already belongs to a different library version/);
	assert.doesNotMatch(sql, /\bdelete\s+from\s+public\.risk_prompts\b/i);
	assert.doesNotMatch(sql, /\btruncate\b/i);

	const generated = await readFile(seedSqlUrl, 'utf8');
	assert.equal(generated, sql);
});

test('Risk prompt seed reflects wording and active-state changes for existing prompt IDs', async () => {
	const content = await loadCsv();
	const changedCsv = mutateCsvRows(content, (headers, row) => {
		row[headers.indexOf('risk_prompt_guidance')] = 'Updated guidance for regression coverage.';
		row[headers.indexOf('risk_prompt_is_active')] = 'false';
	});
	const sql = buildRiskPromptSeedSql(validateRiskPromptCsv(changedCsv));
	assert.match(sql, /Updated guidance for regression coverage/);
	assert.match(sql, /\('WT-RP-001'[\s\S]*false, 'draft'/);
});

test('Risk prompt migration creates normalized reference tables with constraints and read-only authenticated access', async () => {
	const sql = await readFile(migrationUrl, 'utf8');
	assert.match(sql, /create table public\.risk_prompt_libraries/);
	assert.match(sql, /create table public\.risk_prompt_areas/);
	assert.match(sql, /create table public\.risk_prompts/);
	assert.match(sql, /risk_prompt_libraries_key_version_key unique \(risk_library_key, risk_library_version\)/);
	assert.match(sql, /risk_prompt_areas_library_area_key unique \(risk_prompt_library_id, risk_area_key\)/);
	assert.match(sql, /risk_prompt_areas_library_order_key unique \(risk_prompt_library_id, risk_area_order\)/);
	assert.match(sql, /risk_prompts_prompt_id_key unique \(risk_prompt_id\)/);
	assert.match(sql, /risk_prompts_area_order_key unique \(risk_prompt_area_id, risk_prompt_order\)/);
	assert.match(sql, /risk_prompts_default_status_check check \(risk_default_status = 'draft'\)/);
	assert.match(sql, /alter table public\.risk_prompts enable row level security/);
	assert.match(sql, /Authenticated users can read risk prompts/);
	assert.match(sql, /grant select on table public\.risk_prompt_libraries, public\.risk_prompt_areas, public\.risk_prompts to authenticated/);
	assert.doesNotMatch(sql, /grant (insert|update|delete)/i);
});

test('Default risk prompt library summary loads counts from database records', async () => {
	const client = createRiskPromptSummaryClient();
	const summary = await getDefaultRiskPromptLibrarySummary(client);
	assert.equal(summary.name, 'Watchtower Default Risk Prompt Library V1.0');
	assert.equal(summary.activeAreaCount, 12);
	assert.equal(summary.activePromptCount, 96);
	assert.ok(client.calls.some((call) => call[0] === 'from' && call[1] === 'risk_prompt_libraries'));
	assert.ok(client.calls.some((call) => call[0] === 'from' && call[1] === 'risk_prompt_areas'));
	assert.ok(client.calls.some((call) => call[0] === 'from' && call[1] === 'risk_prompts'));
});

test('Default risk prompt library selection reader loads ordered active areas and prompts', async () => {
	const client = createRiskPromptSelectionClient();
	const library = await getDefaultRiskPromptLibraryForSelection(client);

	assert.equal(library.name, 'Watchtower Default Risk Prompt Library V1.0');
	assert.deepEqual(library.areas.map((area) => area.risk_area_key), ['schedule', 'scope']);
	assert.deepEqual(library.areas[0].prompts.map((prompt) => prompt.risk_prompt_id), ['WT-RP-001', 'WT-RP-002']);
	assert.deepEqual(library.areas[1].prompts.map((prompt) => prompt.risk_prompt_id), ['WT-RP-003']);
	assert.ok(client.calls.some((call) => call[0] === 'eq' && call[1] === 'risk_prompt_libraries' && call[2] === 'is_default' && call[3] === true));
	assert.ok(client.calls.some((call) => call[0] === 'eq' && call[1] === 'risk_prompt_libraries' && call[2] === 'is_active' && call[3] === true));
	assert.ok(client.calls.some((call) => call[0] === 'eq' && call[1] === 'risk_prompt_areas' && call[2] === 'is_active' && call[3] === true));
	assert.ok(client.calls.some((call) => call[0] === 'eq' && call[1] === 'risk_prompts' && call[2] === 'risk_prompt_is_active' && call[3] === true));
	assert.ok(client.calls.some((call) => call[0] === 'order' && call[1] === 'risk_prompt_areas' && call[2] === 'risk_area_order'));
	assert.ok(client.calls.some((call) => call[0] === 'order' && call[1] === 'risk_prompts' && call[2] === 'risk_prompt_order'));
});

test('Default risk prompt library selection reader handles missing empty and failed states', async () => {
	const missingClient = createRiskPromptSelectionClient({ library: null });
	assert.equal(await getDefaultRiskPromptLibraryForSelection(missingClient), null);

	const emptyAreasClient = createRiskPromptSelectionClient({ areas: [] });
	assert.deepEqual((await getDefaultRiskPromptLibraryForSelection(emptyAreasClient)).areas, []);

	const areaErrorClient = createRiskPromptSelectionClient({ areaError: new Error('area failure') });
	await assert.rejects(() => getDefaultRiskPromptLibraryForSelection(areaErrorClient), /area failure/);

	const promptErrorClient = createRiskPromptSelectionClient({ promptError: new Error('prompt failure') });
	await assert.rejects(() => getDefaultRiskPromptLibraryForSelection(promptErrorClient), /prompt failure/);
});

test('Risk prompt selection state uses stable prompt IDs across areas without duplicates', () => {
	const knownPromptIds = new Set(['WT-RP-001', 'WT-RP-002', 'WT-RP-003', 'WT-RP-041']);
	const areaByPromptId = new Map([
		['WT-RP-001', 'area-governance'],
		['WT-RP-002', 'area-governance'],
		['WT-RP-003', 'area-scope'],
		['WT-RP-041', 'area-technology'],
	]);

	let selectedPromptIds = createRiskPromptSelectionState([], knownPromptIds);
	assert.equal(getSelectedPromptCount(selectedPromptIds), 0);
	assert.equal(getSelectedPromptTotalLabel(getSelectedPromptCount(selectedPromptIds)), '0 prompts selected');

	selectedPromptIds = selectRiskPrompt(selectedPromptIds, 'WT-RP-001', knownPromptIds);
	selectedPromptIds = selectRiskPrompt(selectedPromptIds, 'WT-RP-001', knownPromptIds);
	assert.equal(getSelectedPromptCount(selectedPromptIds), 1);
	assert.equal(isRiskPromptSelected(selectedPromptIds, 'WT-RP-001'), true);
	assert.equal(getSelectedPromptTotalLabel(getSelectedPromptCount(selectedPromptIds)), '1 prompt selected');
	assert.equal(getSelectedPromptCountByArea(selectedPromptIds, areaByPromptId, 'area-governance'), 1);

	selectedPromptIds = toggleRiskPrompt(selectedPromptIds, 'WT-RP-002', true, knownPromptIds);
	selectedPromptIds = toggleRiskPrompt(selectedPromptIds, 'WT-RP-003', true, knownPromptIds);
	selectedPromptIds = toggleRiskPrompt(selectedPromptIds, 'WT-RP-041', true, knownPromptIds);
	selectedPromptIds = toggleRiskPrompt(selectedPromptIds, 'WT-RP-999', true, knownPromptIds);
	assert.equal(getSelectedPromptCount(selectedPromptIds), 4);
	assert.equal(getSelectedPromptTotalLabel(getSelectedPromptCount(selectedPromptIds)), '4 prompts selected');
	assert.deepEqual([...getSelectedPromptCountsByArea(selectedPromptIds, areaByPromptId)], [
		['area-governance', 2],
		['area-scope', 1],
		['area-technology', 1],
	]);

	selectedPromptIds = deselectRiskPrompt(selectedPromptIds, 'WT-RP-001');
	assert.equal(getSelectedPromptCountByArea(selectedPromptIds, areaByPromptId, 'area-governance'), 1);
	selectedPromptIds = toggleRiskPrompt(selectedPromptIds, 'WT-RP-002', false, knownPromptIds);
	assert.equal(getSelectedPromptCountByArea(selectedPromptIds, areaByPromptId, 'area-governance'), 0);
	assert.equal(isRiskPromptSelected(selectedPromptIds, 'WT-RP-002'), false);

	selectedPromptIds = removeUnknownRiskPromptSelections(selectedPromptIds, new Set(['WT-RP-003']));
	assert.deepEqual([...selectedPromptIds], ['WT-RP-003']);
	assert.equal(getSelectedPromptCount(clearRiskPromptSelections()), 0);
});

test('Risk prompt selected-only review groups selected prompts by configured area and prompt order', () => {
	const selectedPromptIds = createRiskPromptSelectionState(['WT-RP-004', 'WT-RP-010', 'WT-RP-001', 'WT-RP-050', 'WT-RP-010']);
	const areas = [
		{
			id: 'area-scope',
			risk_area_key: 'scope-requirements',
			risk_area_title: 'Scope and requirements',
			risk_area_order: 2,
			prompts: [
				{ risk_prompt_id: 'WT-RP-010', risk_prompt_order: 2, risk_prompt_title: 'Requirements are incomplete' },
				{ risk_prompt_id: 'WT-RP-009', risk_prompt_order: 1, risk_prompt_title: 'Project scope is unclear' },
			],
		},
		{
			id: 'area-governance',
			risk_area_key: 'governance-decision-making',
			risk_area_title: 'Governance and decision-making',
			risk_area_order: 1,
			prompts: [
				{ risk_prompt_id: 'WT-RP-004', risk_prompt_order: 4, risk_prompt_title: 'Escalation routes are unclear or unused' },
				{ risk_prompt_id: 'WT-RP-001', risk_prompt_order: 1, risk_prompt_title: 'Decision-making authority is unclear' },
			],
		},
		{
			id: 'area-technology',
			risk_area_key: 'technology-architecture',
			risk_area_title: 'Technology and architecture',
			risk_area_order: 7,
			prompts: [
				{ risk_prompt_id: 'WT-RP-050', risk_prompt_order: 2, risk_prompt_title: 'Integration complexity is underestimated' },
			],
		},
		{
			id: 'area-quality',
			risk_area_key: 'quality-testing-acceptance',
			risk_area_title: 'Quality, testing and acceptance',
			risk_area_order: 10,
			prompts: [
				{ risk_prompt_id: 'WT-RP-075', risk_prompt_order: 1, risk_prompt_title: 'Testing coverage is incomplete' },
			],
		},
	];
	const groups = getSelectedRiskPromptGroups(selectedPromptIds, areas);

	assert.deepEqual(groups.map((group) => group.riskAreaKey), [
		'governance-decision-making',
		'scope-requirements',
		'technology-architecture',
	]);
	assert.deepEqual(groups[0].prompts.map((prompt) => prompt.risk_prompt_id), ['WT-RP-001', 'WT-RP-004']);
	assert.deepEqual(groups[1].prompts.map((prompt) => prompt.risk_prompt_id), ['WT-RP-010']);
	assert.equal(groups.flatMap((group) => group.prompts).filter((prompt) => prompt.risk_prompt_id === 'WT-RP-010').length, 1);
	assert.equal(groups.some((group) => group.riskAreaKey === 'quality-testing-acceptance'), false);
	assert.deepEqual(getSelectedRiskPromptGroups(clearRiskPromptSelections(), areas), []);
});

test('Account page exposes read-only Risk Management modal without upload or download controls', async () => {
	const accountPage = await readFile(accountPageUrl, 'utf8');
	assert.match(accountPage, /data-risk-management-open/);
	assert.match(accountPage, /data-risk-management-modal/);
	assert.match(accountPage, /id="risk-management-title"/);
	assert.match(accountPage, /getDefaultRiskPromptLibrarySummary/);
	assert.match(accountPage, /data-risk-management-area-count/);
	assert.match(accountPage, /data-risk-management-prompt-count/);
	assert.match(accountPage, /Watchtower Default Risk Prompt Library/);
	assert.match(accountPage, /Coming soon/);
	assert.match(accountPage, /aria-disabled="true"/);
	assert.match(accountPage, /showModal\(\)/);
	assert.match(accountPage, /setRiskManagementScrollLock\(true\)/);
	assert.match(accountPage, /setRiskManagementScrollLock\(false\)/);
	assert.match(accountPage, /\.risk-management-modal\[open\]/);
	assert.match(accountPage, /height: min\(50rem, calc\(100dvh - 2rem\)\)/);
	assert.match(accountPage, /grid-template-rows: auto minmax\(0, 1fr\) auto/);
	assert.match(accountPage, /modal-scroll-locked/);
	assert.match(accountPage, /overscroll-behavior: contain/);
	assert.match(accountPage, /activeRiskManagementTrigger\.focus\(\)/);
	assert.doesNotMatch(accountPage, /<button[^>]*>\s*(Upload|Download)/i);
	assert.doesNotMatch(accountPage, /<a[^>]*>\s*(Upload|Download)/i);
	assert.doesNotMatch(accountPage, /type="file"/i);
});

test('Risk Register prompt modal loads database prompts with tabbed temporary selection state', async () => {
	const route = await readFile(riskRegisterPageUrl, 'utf8');
	assert.match(route, /getDefaultRiskPromptLibraryForSelection\(serverSupabase\)/);
	assert.match(route, /data-risk-prompts-open/);
	assert.match(route, /data-risk-prompt-modal/);
	assert.match(route, /id="risk-prompt-modal-title"/);
	assert.match(route, /role="tablist"/);
	assert.match(route, /role="tab"/);
	assert.match(route, /role="tabpanel"/);
	assert.match(route, /aria-selected=\{selected \? 'true' : 'false'\}/);
	assert.match(route, /aria-label=\{`\$\{area\.risk_area_title\}, 0 prompts selected`\}/);
	assert.match(route, /riskPromptAreaTabLabels/);
	assert.match(route, /'governance-decision-making': 'Governance'/);
	assert.match(route, /'scope-requirements': 'Requirements'/);
	assert.match(route, /'operational-readiness-transition': 'Readiness'/);
	assert.match(route, /\{riskPromptAreaTabLabel\(area\)\}/);
	assert.match(route, /data-risk-prompt-tab-title=\{area\.risk_area_title\}/);
	assert.match(route, /data-risk-prompt-tab-count/);
	assert.match(route, /aria-hidden="true" data-risk-prompt-tab-count/);
	assert.match(route, /data-risk-prompt-panel=\{area\.id\}/);
	assert.match(route, /data-risk-prompt-id=\{prompt\.risk_prompt_id\}/);
	assert.match(route, /data-risk-prompt-area-id=\{area\.id\}/);
	assert.match(route, /aria-label=\{`Select risk prompt: \$\{prompt\.risk_prompt_title\}`\}/);
	assert.match(route, /risk_prompt_title/);
	assert.match(route, /risk_prompt_guidance/);
	assert.match(route, /createRiskPromptSelectionState/);
	assert.match(route, /let selectedPromptIds = createRiskPromptSelectionState\(\)/);
	assert.match(route, /knownRiskPromptIds = new Set<string>\(\)/);
	assert.match(route, /riskPromptAreaByPromptId = new Map<string, string>\(\)/);
	assert.match(route, /rebuildRiskPromptSelectionIndex/);
	assert.match(route, /removeUnknownRiskPromptSelections/);
	assert.match(route, /toggleRiskPrompt\(selectedPromptIds, promptId, checkbox\.checked, knownRiskPromptIds\)/);
	assert.match(route, /syncRiskPromptControls\(\)/);
	assert.match(route, /getSelectedPromptCountsByArea/);
	assert.match(route, /getSelectedPromptTotalLabel/);
	assert.match(route, /type RiskPromptConfirmationView = 'areas' \| 'selected' \| 'confirm'/);
	assert.match(route, /setRiskPromptModalView/);
	assert.match(route, /data-risk-prompt-selected-view/);
	assert.match(route, /data-risk-prompt-confirmation-view/);
	assert.match(route, /aria-labelledby="risk-prompt-confirmation-title"/);
	assert.match(route, /tabindex="-1"/);
	assert.match(route, /Create Draft risks/);
	assert.match(route, /Watchtower will create \$\{createableCount\} new risks in Draft for this project\. \$\{duplicateCount\} selected prompts already exist and will not be created again\./);
	assert.match(route, /Already in this project/);
	assert.match(route, /New Draft risks/);
	assert.match(route, /data-risk-prompt-duplicate-list/);
	assert.match(route, /data-risk-prompt-new-list/);
	assert.match(route, /data-risk-prompt-confirm-create/);
	assert.match(route, /Create \$\{createableCount\} Draft \$\{createableCount === 1 \? 'risk' : 'risks'\}/);
	assert.match(route, /No new Draft risks to create/);
	assert.match(route, /data-risk-prompt-confirm-back/);
	assert.match(route, /Back to selection/);
	assert.match(route, /data-risk-prompt-view-existing/);
	assert.match(route, /renderRiskPromptPreflight/);
	assert.match(route, /mode: 'preflight'/);
	assert.match(route, /mode: 'create'/);
	assert.match(route, /Checking selected prompts/);
	assert.match(route, /promptConfirmationView\.focus\(\)/);
	assert.doesNotMatch(route, /window\.confirm/);
	assert.match(route, /Selected risk prompts/);
	assert.match(route, /data-risk-prompt-review-group=\{area\.id\}/);
	assert.match(route, /data-risk-prompt-review-group-count=\{area\.id\}/);
	assert.match(route, /data-risk-prompt-review-row=\{prompt\.risk_prompt_id\}/);
	assert.match(route, /data-risk-prompt-selected-empty/);
	assert.match(route, /No risk prompts are selected/);
	assert.match(route, /data-risk-prompt-browse-areas/);
	assert.match(route, /0 prompts selected/);
	assert.match(route, /resetRiskPromptSelection\(\)/);
	assert.match(route, /setActiveRiskPromptTab/);
	assert.match(route, /ArrowRight/);
	assert.match(route, /activePromptAreas\[0\]/);
	assert.match(route, /data-risk-prompt-selected-total/);
	assert.match(route, /data-risk-prompt-create-action=\{riskPromptDraftCreatePath\}/);
	assert.match(route, /data-risk-prompt-can-create=\{canCreateRisk \? 'true' : 'false'\}/);
	assert.match(route, /updateRiskPromptCreateButton/);
	assert.match(route, /Create \$\{total\} draft \$\{total === 1 \? 'risk' : 'risks'\}/);
	assert.match(route, /<button[\s\S]*class="button button--primary"[\s\S]*type="button"[\s\S]*disabled/);
	assert.match(route, /data-risk-prompt-review-toggle/);
	assert.match(route, /Show selected only/);
	assert.match(route, /Show all risk areas/);
	assert.match(route, /Review selected prompts when one or more prompts are selected/);
	assert.match(route, /promptReviewToggle\.hidden = promptModalView === 'confirm'/);
	assert.match(route, /promptReviewToggle\.disabled = promptModalView === 'confirm' \|\| \(!isReviewMode && total === 0\)/);
	assert.match(route, /flex-wrap: wrap/);
	assert.match(route, /data-risk-prompt-no-library/);
	assert.match(route, /data-risk-prompt-no-areas/);
	assert.match(route, /data-risk-prompt-empty-area/);
	assert.match(route, /data-risk-prompt-error/);
	assert.match(route, /showModal\(\)/);
	assert.match(route, /setPromptModalScrollLock\(true\)/);
	assert.match(route, /setPromptModalScrollLock\(false\)/);
	assert.match(route, /\.risk-prompt-modal\[open\]/);
	assert.match(route, /height: min\(52rem, calc\(100dvh - 2rem\)\)/);
	assert.match(route, /grid-template-rows: auto minmax\(0, 1fr\)/);
	assert.match(route, /modal-scroll-locked/);
	assert.match(route, /overscroll-behavior: contain/);
	assert.match(route, /scroll-padding-bottom: 1rem/);
	assert.doesNotMatch(route, /max-height: calc\(min\(52rem, 100vh - 2rem\) - 7\.5rem\)/);
	assert.doesNotMatch(route, /scroll-padding-bottom: 6rem/);
	assert.match(route, /promptModalTrigger\.focus\(\)/);
	assert.doesNotMatch(route, /Decision-making authority is unclear/);
	assert.doesNotMatch(route, /localStorage/);
	assert.doesNotMatch(route, /\.insert\(/);
	assert.doesNotMatch(route, /project_risks[\s\S]*insert/);
});
