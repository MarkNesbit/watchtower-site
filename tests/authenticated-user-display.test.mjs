import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { authenticatedUserDisplayName } from '../src/lib/authenticatedUserDisplay.ts';

const appLandingUrl = new URL('../src/components/app/AppLanding.astro', import.meta.url);

async function appLandingSource() {
	return readFile(appLandingUrl, 'utf8');
}

test('Authenticated user display prefers linked profile first and last names', () => {
	assert.equal(authenticatedUserDisplayName({
		first_name: '  James ',
		last_name: ' Brooks  ',
		display_name: 'Mark Nesbit Professional Wt James Brooks Fdd7f16c8161',
		login_name: 'james.brooks',
	}), 'James Brooks');
	assert.equal(authenticatedUserDisplayName({ first_name: 'Ruby', last_name: 'Atkinson' }), 'Ruby Atkinson');
	assert.equal(authenticatedUserDisplayName({ first_name: 'Mark', last_name: 'Nesbit' }), 'Mark Nesbit');
});

test('Authenticated user display falls back only to profile display name login name or neutral text', () => {
	assert.equal(authenticatedUserDisplayName({
		first_name: '',
		last_name: '   ',
		display_name: ' Delivery Lead ',
		login_name: 'delivery.lead',
	}), 'Delivery Lead');
	assert.equal(authenticatedUserDisplayName({
		first_name: null,
		last_name: null,
		display_name: null,
		login_name: 'viewer-01',
	}), 'viewer-01');
	assert.equal(authenticatedUserDisplayName(null), 'Signed-in user');
	assert.equal(authenticatedUserDisplayName({ first_name: null, last_name: null, display_name: null, login_name: null }), 'Signed-in user');
});

test('Authenticated landing resolves the current profile by Auth UUID linkage', async () => {
	const source = await appLandingSource();

	assert.match(source, /\.from\('profiles'\)/);
	assert.match(source, /\.select\('first_name, last_name, display_name, login_name'\)/);
	assert.match(source, /\.eq\('auth_user_id', data\.user\.id\)/);
	assert.doesNotMatch(source, /\.eq\('id', data\.user\.id\)/);
});

test('Authenticated landing does not use Auth email metadata or generated aliases for display', async () => {
	const source = await appLandingSource();

	assert.match(source, /authenticatedUserDisplayName\(profile\)/);
	assert.doesNotMatch(source, /data\.user\.email|user\.email|user_metadata|app_metadata|full_name/);
	assert.doesNotMatch(source, /split\('@'\)|replace\(\.\/\[\\\._\+\-\]/);
	assert.doesNotMatch(source, /Fdd7f16c8161|auth alias|alias/i);
});
