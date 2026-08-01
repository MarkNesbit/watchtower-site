import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { transform } from '@astrojs/compiler';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { resolveActionerEditSelection } from '../src/lib/projectActions.ts';

const fixtureOptions = [
	{ id: 'membership-ella', membershipId: 'membership-ella', profileId: 'profile-ella', display_name: 'Ella Underwood', role: 'member' },
	{ id: 'membership-mark', membershipId: 'membership-mark', profileId: 'profile-mark', display_name: 'Mark Nesbit', role: 'admin' },
];

async function renderActionerSelect(selection, eligibleActioners = fixtureOptions) {
	const source = await readFile(new URL('../src/components/actions/ActionerAssignmentSelect.astro', import.meta.url), 'utf8');
	const { code } = await transform(source, { filename: 'ActionerAssignmentSelect.astro' });
	const runtimeUrl = new URL('./fixtures/astro-render-runtime.mjs', import.meta.url).href;
	const runnable = code.replace('from "astro/runtime/server/index.js"', `from ${JSON.stringify(runtimeUrl)}`);
	const component = await import(`data:text/javascript;base64,${Buffer.from(runnable).toString('base64')}`);
	const container = await AstroContainer.create();
	return container.renderToString(component.default, { props: { label: 'Assign or reassign', selection, eligibleActioners } });
}

test('rendered Actioner selector selects the split-ID current member rather than Unassigned', async () => {
	const html = await renderActionerSelect({ membershipId: 'membership-ella', error: null });
	assert.match(html, /<option value="">Unassigned<\/option>/);
	assert.match(html, /<option value="membership-ella" selected>\s*Ella Underwood \(member\)\s*<\/option>/);
	assert.doesNotMatch(html, /<option value="" selected>Unassigned<\/option>/);
});

test('production-shaped split identity renders the persisted Actioner option as selected', async () => {
	const ellaProfileId = 'profile-986b040b';
	const ellaMembershipId = 'membership-43488e1b';
	const ellaDirectoryOption = {
		id: ellaMembershipId,
		membershipId: ellaMembershipId,
		profileId: ellaProfileId,
		display_name: 'Ella Underwood',
		role: 'member',
	};
	const selection = resolveActionerEditSelection({
		actioner_id: ellaProfileId,
		actioner: { id: ellaProfileId, profileId: ellaProfileId, membershipId: ellaMembershipId },
	}, [ellaDirectoryOption]);

	const html = await renderActionerSelect(selection, [ellaDirectoryOption]);
	assert.match(html, new RegExp(`<option value="${ellaMembershipId}" selected>\\s*Ella Underwood`));
	assert.doesNotMatch(html, /<option value="" selected>Unassigned<\/option>/);
});

test('rendered Actioner selector selects equal-ID members and only selects Unassigned for null responsibility', async () => {
	const equalIdHtml = await renderActionerSelect(
		{ membershipId: 'equal-id', error: null },
		[{ id: 'equal-id', membershipId: 'equal-id', profileId: 'equal-id', display_name: 'Legacy member', role: 'member' }],
	);
	assert.match(equalIdHtml, /<option value="equal-id" selected>/);

	const unassignedHtml = await renderActionerSelect({ membershipId: null, error: null });
	assert.match(unassignedHtml, /<option value="" selected>Unassigned<\/option>/);
	assert.doesNotMatch(unassignedHtml, /<option value="membership-ella" selected>/);
});

test('rendered Actioner selector with unresolved current identity omits the destructive field entirely', async () => {
	const html = await renderActionerSelect({ membershipId: null, error: 'The current Actioner cannot be resolved to one active workspace membership.' });
	assert.match(html, /role="alert"/);
	assert.match(html, /cannot be resolved/);
	assert.doesNotMatch(html, /<select name="actioner_id">/);
});
