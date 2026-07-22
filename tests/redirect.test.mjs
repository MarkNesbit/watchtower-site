import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { getSafeRedirectPath } from '../src/lib/redirect.js';
import { buildLoginRedirectPath, isSupabaseAuthSessionError } from '../src/lib/supabaseServer.ts';

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

test('server auth helpers redirect safely and recognise expired Supabase JWT errors', () => {
	assert.equal(
		buildLoginRedirectPath('/app/workspaces/alpha/projects/delivery-hub/risks/new'),
		'/login?redirectTo=%2Fapp%2Fworkspaces%2Falpha%2Fprojects%2Fdelivery-hub%2Frisks%2Fnew',
	);
	assert.equal(
		isSupabaseAuthSessionError(new Error('invalid JWT: unable to parse or verify signature, token has invalid claims: token is expired')),
		true,
	);
	assert.equal(isSupabaseAuthSessionError(new Error('Select an active workspace member as risk owner.')), false);
});

test('middleware does not use the wt-session marker cookie as authentication', async () => {
	const middleware = await readFile(new URL('../src/middleware.ts', import.meta.url), 'utf8');
	assert.doesNotMatch(middleware, /AUTH_SESSION_COOKIE/);
	assert.doesNotMatch(middleware, /wt-session/);
	assert.doesNotMatch(middleware, /signed-in/);
});

test('middleware prevents authenticated app pages from being browser cached', async () => {
	const middleware = await readFile(new URL('../src/middleware.ts', import.meta.url), 'utf8');
	assert.match(middleware, /context\.url\.pathname\.startsWith\('\/app'\)/);
	assert.match(middleware, /Cache-Control', 'private, no-store, no-cache, must-revalidate'/);
	assert.match(middleware, /Pragma', 'no-cache'/);
	assert.match(middleware, /Expires', '0'/);
});

test('/app shell is hidden until the client confirms a real Supabase session', async () => {
	const layout = await readFile(new URL('../src/layouts/AuthenticatedLayout.astro', import.meta.url), 'utf8');
	const authStatus = await readFile(new URL('../src/components/auth/AuthStatus.astro', import.meta.url), 'utf8');

	assert.match(layout, /data-authenticated-shell hidden/);
	assert.match(layout, /<section class="app-shell" data-authenticated-shell hidden>/);
	assert.doesNotMatch(layout, /app-shell__bar|Workspace navigation|<SignOutButton/);
	assert.match(authStatus, /supabase\.auth\.getSession\(\)/);
	assert.match(authStatus, /removeAttribute\('hidden'\)/);
});

test('shared header swaps Login for the existing sign-out action when authenticated', async () => {
	const header = await readFile(new URL('../src/components/Header.astro', import.meta.url), 'utf8');
	const signOutButton = await readFile(new URL('../src/components/auth/SignOutButton.astro', import.meta.url), 'utf8');

	assert.match(header, /const accessToken = getServerAccessToken\(Astro\.cookies\)/);
	assert.match(header, /const hasAuthCookie = Boolean\(accessToken\)/);
	assert.match(header, /const publicNavItems = \[/);
	for (const label of ['Home', 'Products', 'Roadmap', 'About']) {
		assert.match(header, new RegExp(`label: '${label}'`));
	}
	assert.match(header, /const appNavItems = \[/);
	assert.match(header, /\{ href: '\/app', label: 'Dashboard', exact: true \}/);
	assert.match(header, /\{ href: '\/app\/projects', label: 'Projects' \}/);
	assert.match(header, /workspaceTeamHref \? \{ href: workspaceTeamHref, label: 'Workspace' \} : \{ label: 'Workspace' \}/);
	assert.match(header, /\{ href: '\/app\/account', label: 'Admin' \}/);
	assert.match(header, /\{ label: 'Settings' \}/);
	assert.match(header, /getCurrentWorkspace\(serverSupabase, accessToken\)/);
	assert.match(header, /buildWorkspaceTeamPath\(organisation\.slug\)/);
	assert.match(header, /data-public-nav hidden=\{hasAuthCookie \|\| undefined\}/);
	assert.match(header, /data-app-nav hidden=\{!hasAuthCookie \|\| undefined\}/);
	assert.match(header, /nav__item nav__item--disabled/);
	assert.match(header, /<a class="login-slot" href="\/login" data-header-login hidden=\{hasAuthCookie \|\| undefined\}>Login<\/a>/);
	assert.match(header, /data-header-sign-out hidden=\{!hasAuthCookie \|\| undefined\}/);
	assert.match(header, /<SignOutButton className="login-slot login-slot--button" label="Sign out" \/>/);
	assert.match(header, /supabase\.auth\.getSession\(\)/);
	assert.match(header, /loginLink\?\.toggleAttribute\('hidden', Boolean\(session\)\)/);
	assert.match(header, /signOutAction\?\.toggleAttribute\('hidden', !session\)/);
	assert.match(header, /publicNav\?\.toggleAttribute\('hidden', Boolean\(session\)\)/);
	assert.match(header, /appNav\?\.toggleAttribute\('hidden', !session\)/);
	assert.match(header, /supabase\.auth\.onAuthStateChange/);
	assert.match(signOutButton, /data-sign-out/);
	assert.match(signOutButton, /recordAuthAuditEvent\('user\.logged_out'\)/);
	assert.match(signOutButton, /supabase\.auth\.signOut\(\)/);
	assert.match(signOutButton, /__watchtowerSignOutBound/);
});
