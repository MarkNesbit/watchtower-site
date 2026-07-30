import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
	LOGIN_NAME_AUTH_ERROR_MESSAGE,
	normaliseLoginNameInput,
	resolveLoginNameAuthIdentity,
} from '../src/lib/loginNameAuth.ts';

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
