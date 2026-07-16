import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
	WATCHTOWER_ICON_KEYS,
	WATCHTOWER_ICON_REGISTRY,
	WATCHTOWER_ICON_SIZES,
	getWatchtowerIconSvgData,
	resolveWatchtowerIconKey,
} from '../src/lib/watchtowerIcons.ts';

const expectedRegistry = {
	'project-start': ['play', '#059669'],
	'project-end': ['flag-checkered', '#16A34A'],
	milestone: ['diamond', '#2563EB'],
	gateway: ['archway', '#7C3AED'],
	'governance-review': ['shield', '#6D28D9'],
	meeting: ['people-group', '#EA580C'],
	workshop: ['chalkboard-user', '#F97316'],
	risk: ['triangle-exclamation', '#DC2626'],
	issue: ['circle-exclamation', '#DC2626'],
	dependency: ['link', '#A8B3C7'],
	assumption: ['circle-question', '#A8B3C7'],
	action: ['square-check', '#F6C344'],
	decision: ['signs-post', '#A8B3C7'],
	uat: ['person-circle-check', '#0899B2'],
	testing: ['microscope', '#06B6D4'],
	'load-testing': ['chart-line', '#0E7490'],
	integration: ['puzzle-piece', '#4F46E5'],
	deployment: ['cloud-arrow-up', '#2563EB'],
	cutover: ['right-left', '#C026D3'],
	training: ['graduation-cap', '#CA8A04'],
	'go-live': ['rocket', '#16A34A'],
	hypercare: ['heart-pulse', '#10B981'],
	'manual-diary-entry': ['pen-to-square', '#475569'],
	'system-event': ['gear', '#6B7280'],
};

test('Watchtower semantic icon registry contains the agreed 24 fixed icons', () => {
	assert.equal(WATCHTOWER_ICON_KEYS.length, 24);
	assert.equal(new Set(WATCHTOWER_ICON_KEYS).size, 24);
	assert.deepEqual(WATCHTOWER_ICON_KEYS, Object.keys(expectedRegistry));

	for (const [key, [iconName, colour]] of Object.entries(expectedRegistry)) {
		assert.equal(WATCHTOWER_ICON_REGISTRY[key].key, key);
		assert.equal(WATCHTOWER_ICON_REGISTRY[key].icon.iconName, iconName);
		assert.equal(WATCHTOWER_ICON_REGISTRY[key].colour, colour);
		assert.equal(typeof WATCHTOWER_ICON_REGISTRY[key].label, 'string');
		assert.ok(WATCHTOWER_ICON_REGISTRY[key].label.length > 0);
	}
});

test('Watchtower icon fallback and aliases resolve to safe semantic keys', () => {
	assert.equal(resolveWatchtowerIconKey('risk'), 'risk');
	assert.equal(resolveWatchtowerIconKey('target-end'), 'project-end');
	assert.equal(resolveWatchtowerIconKey('review'), 'governance-review');
	assert.equal(resolveWatchtowerIconKey('manual'), 'manual-diary-entry');
	assert.equal(resolveWatchtowerIconKey('not-agreed-yet'), 'system-event');

	const fallbackSvg = getWatchtowerIconSvgData('not-agreed-yet');
	assert.equal(fallbackSvg.key, 'system-event');
	assert.equal(fallbackSvg.iconName, 'gear');
	assert.equal(fallbackSvg.colour, '#6B7280');
});

test('WatchtowerIcon component exposes the three semantic sizes and accessibility modes', async () => {
	const componentSource = await readFile(new URL('../src/components/app/WatchtowerIcon.astro', import.meta.url), 'utf8');
	assert.deepEqual(Object.keys(WATCHTOWER_ICON_SIZES), ['full', 'medium', 'small']);
	assert.equal(WATCHTOWER_ICON_SIZES.full, '2rem');
	assert.equal(WATCHTOWER_ICON_SIZES.medium, '1.4rem');
	assert.equal(WATCHTOWER_ICON_SIZES.small, '0.95rem');
	assert.match(componentSource, /type WatchtowerIconSize/);
	assert.match(componentSource, /aria-hidden=\{decorative \? 'true' : undefined\}/);
	assert.match(componentSource, /role=\{decorative \? undefined : 'img'\}/);
	assert.match(componentSource, /aria-labelledby=\{decorative \? undefined : titleId\}/);
	assert.match(componentSource, /<title id=\{titleId\}>\{accessibleLabel\}<\/title>/);
	assert.match(componentSource, /data-watchtower-icon-colour=\{definition\.colour\}/);
	assert.doesNotMatch(componentSource, /colour\?:|color\?:|tone\?:/);
});
