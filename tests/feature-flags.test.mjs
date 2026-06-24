import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
	FEATURE_KEYS,
	createFeatureStateMap,
	getFeatureAccess,
	getFeatureState,
	getFeatureUnavailableReason,
	isFeatureEnabled,
} from '../src/lib/featureFlags.ts';
import { can } from '../src/lib/permissions.ts';

const migrationUrl = new URL('../supabase/migrations/20260624000200_feature_flags_preview_access.sql', import.meta.url);

test('Central feature configuration includes the initial capability keys and all four states', () => {
	assert.deepEqual([...FEATURE_KEYS], [
		'projectDiary',
		'riskManagement',
		'riskToDiary',
		'attentionItems',
		'healthDashboard',
		'manualHealthAdjustment',
		'issues',
		'dependencies',
		'assumptions',
		'forecasting',
	]);

	const states = createFeatureStateMap([
		{ key: 'projectDiary', state: 'hidden' },
		{ key: 'riskManagement', state: 'disabled' },
		{ key: 'issues', state: 'preview' },
		{ key: 'forecasting', state: 'enabled' },
	]);
	assert.equal(getFeatureState('projectDiary', states), 'hidden');
	assert.equal(getFeatureState('riskManagement', states), 'disabled');
	assert.equal(getFeatureState('issues', states), 'preview');
	assert.equal(getFeatureState('forecasting', states), 'enabled');
});

test('Missing and malformed flag configuration fails closed', () => {
	assert.equal(getFeatureState('riskManagement'), 'hidden');
	assert.equal(getFeatureState('riskManagement', createFeatureStateMap([{ key: 'riskManagement', state: 'unexpected' }])), 'hidden');
	assert.equal(isFeatureEnabled('riskManagement'), false);
	assert.equal(getFeatureAccess('riskManagement').isVisible, false);
});

test('Hidden, disabled, preview and enabled states expose the intended UI access', () => {
	const hidden = getFeatureAccess('riskManagement', {}, { riskManagement: 'hidden' });
	assert.equal(hidden.isVisible, false);
	assert.equal(hidden.isAccessible, false);

	const disabled = getFeatureAccess('riskManagement', {}, { riskManagement: 'disabled' });
	assert.equal(disabled.isVisible, true);
	assert.equal(disabled.isAccessible, false);
	assert.equal(disabled.unavailableReason, 'This capability is not available yet.');

	const normalPreview = getFeatureAccess('riskManagement', {}, { riskManagement: 'preview' });
	assert.equal(normalPreview.isVisible, true);
	assert.equal(normalPreview.isAccessible, false);
	assert.equal(
		getFeatureUnavailableReason('riskManagement', {}, { riskManagement: 'preview' }),
		'This feature is not currently available to your account.',
	);

	const approvedPreview = getFeatureAccess(
		'riskManagement',
		{ canAccessPreviewFeatures: true },
		{ riskManagement: 'preview' },
	);
	assert.equal(approvedPreview.isAccessible, true);
	assert.equal(approvedPreview.unavailableReason, null);

	assert.equal(isFeatureEnabled('riskManagement', {}, { riskManagement: 'enabled' }), true);
});

test('Preview eligibility and enabled feature state do not bypass workspace RBAC', () => {
	assert.equal(
		isFeatureEnabled('riskManagement', { canAccessPreviewFeatures: true }, { riskManagement: 'preview' }),
		true,
	);
	assert.equal(can('viewer', 'risk.view'), true);
	assert.equal(can('viewer', 'risk.create'), false);
	assert.equal(can('viewer', 'risk.edit'), false);
	assert.equal(can('member', 'risk.create'), true);
	assert.equal(can('unknown', 'risk.view'), false);
});

test('Migration adds account preview access and stateful fail-closed flags', async () => {
	const sql = await readFile(migrationUrl, 'utf8');
	assert.match(sql, /add column if not exists can_access_preview_features boolean not null default false/);
	assert.match(sql, /check \(state in \('hidden', 'disabled', 'preview', 'enabled'\)\)/);
	assert.match(sql, /'riskManagement'.*'preview'/s);
	assert.match(sql, /'forecasting'.*'hidden'/s);
	assert.match(sql, /using \(organisation_id is null\)/);
	assert.doesNotMatch(sql, /PREVIEW_FEATURE_USER_EMAILS|is_platform_admin|service_role key/i);
});

test('Risk tile and direct route both use central feature access', async () => {
	const dashboard = await readFile(new URL('../src/pages/app/workspaces/[workspaceSlug]/projects/[projectId].astro', import.meta.url), 'utf8');
	const route = await readFile(new URL('../src/pages/app/workspaces/[workspaceSlug]/projects/[projectId]/risks.astro', import.meta.url), 'utf8');

	assert.match(dashboard, /loadFeatureAccess\(serverSupabase, 'riskManagement', accessToken\)/);
	assert.match(dashboard, /riskManagementAccess\.isVisible/);
	assert.match(dashboard, /data-feature-unavailable/);
	assert.match(dashboard, /buildProjectRisksPath\(workspaceSlug \?\? '', project\.slug\)/);

	assert.match(route, /getWorkspaceBySlug\(serverSupabase, workspaceSlug \?\? '', accessToken\)/);
	assert.match(route, /can\(workspace\.role, 'risk\.view'\)/);
	assert.match(route, /loadFeatureAccess\(serverSupabase, 'riskManagement', accessToken\)/);
	assert.match(route, /if \(!featureAccess\.isAccessible\)/);
	assert.match(route, /Astro\.response\.status = featureAccess\.state === 'hidden' \? 404 : 403/);
	assert.match(route, /Viewer access is read-only\./);
});
