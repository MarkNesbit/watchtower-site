import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { getSafeRedirectPath } from '../src/lib/redirect.js';

test('getSafeRedirectPath accepts same-origin relative paths', () => {
	assert.equal(getSafeRedirectPath('/app'), '/app');
	assert.equal(getSafeRedirectPath('/app?tab=home#top'), '/app?tab=home#top');
	assert.equal(getSafeRedirectPath('/login'), '/login');
});

test('getSafeRedirectPath rejects external and protocol-relative URLs', () => {
	assert.equal(getSafeRedirectPath('https://attacker.example'), '/app');
	assert.equal(getSafeRedirectPath('http://attacker.example'), '/app');
	assert.equal(getSafeRedirectPath('//attacker.example'), '/app');
});

test('getSafeRedirectPath falls back for missing or malformed values', () => {
	assert.equal(getSafeRedirectPath(null), '/app');
	assert.equal(getSafeRedirectPath(''), '/app');
	assert.equal(getSafeRedirectPath('dashboard'), '/app');
	assert.equal(getSafeRedirectPath('/\\attacker.example'), '/app');
});

test('middleware does not use the wt-session marker cookie as authentication', async () => {
	const middleware = await readFile(new URL('../src/middleware.ts', import.meta.url), 'utf8');
	assert.doesNotMatch(middleware, /AUTH_SESSION_COOKIE/);
	assert.doesNotMatch(middleware, /wt-session/);
	assert.doesNotMatch(middleware, /signed-in/);
});

test('/app shell is hidden until the client confirms a real Supabase session', async () => {
	const layout = await readFile(new URL('../src/layouts/AuthenticatedLayout.astro', import.meta.url), 'utf8');
	const authStatus = await readFile(new URL('../src/components/auth/AuthStatus.astro', import.meta.url), 'utf8');

	assert.match(layout, /data-authenticated-shell hidden/);
	assert.match(authStatus, /supabase\.auth\.getSession\(\)/);
	assert.match(authStatus, /removeAttribute\('hidden'\)/);
});
