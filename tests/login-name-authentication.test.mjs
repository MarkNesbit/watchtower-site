import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
	LOGIN_NAME_AUTH_ERROR_MESSAGE,
	normaliseLoginNameInput,
	resolveLoginNameAuthIdentity,
} from '../src/lib/loginNameAuth.ts';
import {
	ACCESS_SESSION_COOKIE,
	LOGIN_SWITCH_CSRF_COOKIE,
	REFRESH_SESSION_COOKIE,
	buildCleanLoginPath,
	clearedAuthenticationCookieHeaders,
	isSameOriginPost,
	isValidLoginSwitchCsrf,
	loginSwitchCsrfCookie,
} from '../src/lib/sessionSwitch.ts';

function queryResult(data, error = null) {
	return {
		select() {
			return this;
		},
		eq() {
			return this;
		},
		or() {
			return this;
		},
		async limit() {
			return { data, error };
		},
	};
}

function adminClient({ profiles = [], memberships = [], authUser = null, authError = null } = {}) {
	const calls = [];
	return {
		calls,
		from(table) {
			calls.push(['from', table]);
			if (table === 'profiles') return queryResult(profiles);
			if (table === 'organisation_members') return queryResult(memberships);
			throw new Error(`Unexpected table ${table}`);
		},
		auth: {
			admin: {
				async getUserById(userId) {
					calls.push(['getUserById', userId]);
					return { data: { user: authUser }, error: authError };
				},
			},
		},
	};
}

test('login-name input normalisation matches the profile login_name contract', () => {
	assert.equal(normaliseLoginNameInput(' Ruby.Atkinson '), 'ruby.atkinson');
	assert.equal(normaliseLoginNameInput('mark.nesbit.professional'), 'mark.nesbit.professional');
	assert.equal(normaliseLoginNameInput('james.brookes@example.com'), null);
	assert.equal(normaliseLoginNameInput('ab'), null);
	assert.equal(normaliseLoginNameInput('ruby atkinson'), null);
});

test('login-name resolver returns the Auth email only inside the server-side result', async () => {
	const client = adminClient({
		profiles: [{ id: 'profile-id', auth_user_id: 'auth-user-id' }],
		memberships: [{ id: 'membership-id' }],
		authUser: { id: 'auth-user-id', email: 'mark.nesbit.professional+wt.ruby.atkinson.44444444@gmail.com' },
	});

	const result = await resolveLoginNameAuthIdentity(client, 'ruby.atkinson');

	assert.equal(result.status, 'resolved');
	assert.equal(result.authUserId, 'auth-user-id');
	assert.equal(result.authEmail, 'mark.nesbit.professional+wt.ruby.atkinson.44444444@gmail.com');
	assert.equal(result.activeMembershipCount, 1);
	assert.deepEqual(client.calls.filter((call) => call[0] === 'getUserById'), [['getUserById', 'auth-user-id']]);
});

test('login-name resolver fails closed for duplicate, missing and inactive identities', async () => {
	assert.equal(
		(await resolveLoginNameAuthIdentity(adminClient({ profiles: [] }), 'ruby.atkinson')).status,
		'profile_not_found',
	);
	assert.equal(
		(await resolveLoginNameAuthIdentity(adminClient({
			profiles: [
				{ id: 'profile-a', auth_user_id: 'auth-a' },
				{ id: 'profile-b', auth_user_id: 'auth-b' },
			],
		}), 'ruby.atkinson')).status,
		'ambiguous_login_name',
	);
	assert.equal(
		(await resolveLoginNameAuthIdentity(adminClient({
			profiles: [{ id: 'profile-id', auth_user_id: null }],
		}), 'ruby.atkinson')).status,
		'auth_identity_missing',
	);
	assert.equal(
		(await resolveLoginNameAuthIdentity(adminClient({
			profiles: [{ id: 'profile-id', auth_user_id: 'auth-user-id' }],
			memberships: [],
		}), 'ruby.atkinson')).status,
		'no_active_membership',
	);
});

test('login form is login-name based and no longer performs browser-side email auth', async () => {
	const form = await readFile(new URL('../src/components/auth/LoginForm.astro', import.meta.url), 'utf8');

	assert.match(form, /<form class="auth-card" data-login-form method="post" action="\/login" novalidate>/);
	assert.match(form, /Login name<input name="loginName" type="text" autocomplete="username" autocapitalize="none" spellcheck="false" required/);
	assert.match(form, /Password<input name="password" type="password" autocomplete="current-password"/);
	assert.doesNotMatch(form, /name="email"|type="email"|autocomplete="email"|signInWithPassword|supabaseClient|document\.cookie/);
});

test('login page authenticates through the server without exposing the internal Auth email to form state', async () => {
	const page = await readFile(new URL('../src/pages/login.astro', import.meta.url), 'utf8');

	assert.match(page, /Astro\.request\.method === 'POST'/);
	assert.match(page, /createSupabaseAdminClient\(env as RuntimeEnv\)/);
	assert.match(page, /resolveLoginNameAuthIdentity\(adminSupabase, loginName\)/);
	assert.match(page, /signInWithPassword\(\{[\s\S]*email: resolution\.authEmail,[\s\S]*password,[\s\S]*\}\)/);
	assert.match(page, /record_auth_audit_event/);
	assert.equal(LOGIN_NAME_AUTH_ERROR_MESSAGE, 'Login name or password is incorrect.');
	assert.match(page, /message = LOGIN_NAME_AUTH_ERROR_MESSAGE/);
	assert.doesNotMatch(page, /authEmail=\{|resolution\.authEmail\}|\?authEmail/);
	for (const line of page.split('\n')) {
		assert.doesNotMatch(line, /console\.(?:warn|error|info).*authEmail/);
	}
});

test('authenticated login page presents explicit account switching instead of a second login form', async () => {
	const page = await readFile(new URL('../src/pages/login.astro', import.meta.url), 'utf8');
	const choice = await readFile(new URL('../src/components/auth/AuthenticatedLoginChoice.astro', import.meta.url), 'utf8');

	assert.match(page, /getServerAccessToken\(Astro\.cookies\)/);
	assert.match(page, /loadAuthenticatedDashboardContext\(sessionSupabase, accessToken\)/);
	assert.match(page, /existingSessionContext \? \(/);
	assert.match(page, /<AuthenticatedLoginChoice/);
	assert.match(page, /<LoginForm message=\{message\} redirectTo=\{redirectTo\} \/>/);
	assert.match(choice, /data-account-switch-prompt/);
	assert.match(choice, /Signed in as/);
	assert.match(choice, /Workspace/);
	assert.match(choice, /Continue as \{personName\}/);
	assert.match(choice, /Sign out and use another account/);
	assert.match(choice, /name="action" type="hidden" value="switch-account"/);
	assert.doesNotMatch(choice, /authEmail|contactEmail|login_name|auth_user_id|uuid|access_token|refresh_token|password/i);
});

test('direct login POST with an existing session is blocked until account switch is confirmed', async () => {
	const page = await readFile(new URL('../src/pages/login.astro', import.meta.url), 'utf8');

	assert.match(page, /if \(existingSessionContext\) \{/);
	assert.match(page, /login_blocked_existing_session/);
	assert.match(page, /You are already signed in\. Sign out before using another account\./);
	assert.doesNotMatch(page, /existingSessionContext[\s\S]{0,240}signInWithPassword/);
});

test('account switch action clears server cookies and uses CSRF protected POST', async () => {
	const page = await readFile(new URL('../src/pages/login.astro', import.meta.url), 'utf8');

	assert.match(page, /action === 'switch-account'/);
	assert.match(page, /isSameOriginPost\(Astro\.request, Astro\.url\)/);
	assert.match(page, /isValidLoginSwitchCsrf\(formData\.get\('switchCsrfToken'\), Astro\.cookies\.get\(LOGIN_SWITCH_CSRF_COOKIE\)\?\.value\)/);
	assert.match(page, /account_switch_completed/);
	assert.match(page, /redirectClearingSession\(buildCleanLoginPath\(requestedRedirectTo, true\)\)/);

	const clearCookies = clearedAuthenticationCookieHeaders();
	assert.ok(clearCookies.some((cookie) => cookie.startsWith(`${ACCESS_SESSION_COOKIE}=; Path=/;`) && cookie.includes('Max-Age=0')));
	assert.ok(clearCookies.some((cookie) => cookie.startsWith(`${REFRESH_SESSION_COOKIE}=; Path=/;`) && cookie.includes('Max-Age=0')));
	assert.ok(clearCookies.some((cookie) => cookie.startsWith(`${LOGIN_SWITCH_CSRF_COOKIE}=; Path=/login;`) && cookie.includes('Max-Age=0')));
	assert.match(loginSwitchCsrfCookie('x'.repeat(24)), /wt-login-switch-csrf=x{24}; Path=\/login; SameSite=Lax; Max-Age=300/);
	assert.equal(isValidLoginSwitchCsrf('x'.repeat(24), 'x'.repeat(24)), true);
	assert.equal(isValidLoginSwitchCsrf('x'.repeat(24), 'y'.repeat(24)), false);
});

test('account switch cleanup clears browser Supabase session state before clean login', async () => {
	const authStatus = await readFile(new URL('../src/components/auth/AuthStatus.astro', import.meta.url), 'utf8');

	assert.match(authStatus, /accountSwitchCompleted/);
	assert.match(authStatus, /await supabase\.auth\.signOut\(\)/);
	assert.match(authStatus, /wt-access-token=; path=\/; max-age=0/);
	assert.match(authStatus, /wt-refresh-token=; path=\/; max-age=0/);
	assert.match(authStatus, /wt-login-switch-csrf=; path=\/login; max-age=0/);
	assert.match(authStatus, /watchtower:dashboard-context-refresh:/);
	assert.match(authStatus, /window\.history\.replaceState/);
	assert.match(authStatus, /session && publicAuthPaths\.includes\(path\) && !accountSwitchPrompt/);
});

test('account switch preserves safe redirects and blocks open redirects', () => {
	assert.equal(buildCleanLoginPath('/app/workspaces/alpha/projects'), '/login?redirectTo=%2Fapp%2Fworkspaces%2Falpha%2Fprojects');
	assert.equal(buildCleanLoginPath('/app?tab=home#top', true), '/login?redirectTo=%2Fapp%3Ftab%3Dhome%23top&accountSwitched=1');
	assert.equal(buildCleanLoginPath('https://attacker.example/app', true), '/login?accountSwitched=1');
	assert.equal(buildCleanLoginPath('//attacker.example/app', true), '/login?accountSwitched=1');
});

test('account switch same-origin check rejects cross-origin state changes', () => {
	assert.equal(isSameOriginPost(new Request('https://watch-tower.co.uk/login', {
		method: 'POST',
		headers: { origin: 'https://watch-tower.co.uk' },
	}), new URL('https://watch-tower.co.uk/login')), true);
	assert.equal(isSameOriginPost(new Request('https://watch-tower.co.uk/login', {
		method: 'POST',
		headers: { origin: 'https://attacker.example' },
	}), new URL('https://watch-tower.co.uk/login')), false);
	assert.equal(isSameOriginPost(new Request('https://watch-tower.co.uk/login', {
		method: 'POST',
		headers: { referer: 'https://watch-tower.co.uk/app' },
	}), new URL('https://watch-tower.co.uk/login')), true);
	assert.equal(isSameOriginPost(new Request('https://watch-tower.co.uk/login', {
		method: 'POST',
		headers: { referer: 'https://attacker.example/app' },
	}), new URL('https://watch-tower.co.uk/login')), false);
});
