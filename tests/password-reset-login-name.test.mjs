import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
	PASSWORD_RESET_PUBLIC_CONFIRMATION,
	buildPasswordResetCompletionUrl,
	renderPasswordResetEmail,
	resolvePasswordResetProviderConfig,
	resolveTrustedSupabaseActionOrigins,
	sendPasswordResetEmail,
	validateSupabaseRecoveryActionLink,
} from '../src/lib/passwordResetDelivery.ts';
import {
	clearPasswordResetRateLimitState,
	isPasswordResetRateLimited,
	passwordResetAuditPayload,
	resolvePasswordResetLoginName,
} from '../src/lib/passwordResetLoginName.ts';

function queryResult(data, error = null, calls = []) {
	return {
		select() {
			return this;
		},
		eq(column, value) {
			calls.push(['eq', column, value]);
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
			if (table === 'profiles') return queryResult(profiles, null, calls);
			if (table === 'organisation_members') return queryResult(memberships, null, calls);
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

function eligibleClient(loginName, contactEmail = `${loginName}@example.com`) {
	return adminClient({
		profiles: [{ id: `${loginName}-profile`, auth_user_id: `${loginName}-auth`, contact_email: contactEmail }],
		memberships: [{ id: `${loginName}-membership` }],
		authUser: { id: `${loginName}-auth`, email: `mark.nesbit.professional+wt.${loginName}.44444444@gmail.com` },
	});
}

const trustedResetEnv = {
	PUBLIC_SUPABASE_URL: 'https://project-ref.supabase.co',
	WATCHTOWER_SITE_URL: 'https://watch-tower.co.uk',
};

function recoveryProperties({
	origin = 'https://project-ref.supabase.co',
	path = '/auth/v1/verify',
	type = 'recovery',
	tokenHash = 'provider-token-hash',
	redirectTo = 'https://watch-tower.co.uk/reset-password',
	verificationType = 'recovery',
	hashedToken = 'provider-token-hash',
} = {}) {
	const url = new URL(path, origin);
	if (tokenHash !== null) url.searchParams.set('token_hash', tokenHash);
	if (type !== null) url.searchParams.set('type', type);
	if (redirectTo !== null) url.searchParams.set('redirect_to', redirectTo);
	return {
		action_link: url.toString(),
		verification_type: verificationType,
		hashed_token: hashedToken,
	};
}

test('forgotten-password form accepts login names rather than email addresses', async () => {
	const form = await readFile(new URL('../src/components/auth/ForgotPasswordForm.astro', import.meta.url), 'utf8');

	assert.match(form, /<form class="auth-card" data-forgot-form method="post" action="\/forgot-password" novalidate>/);
	assert.match(form, /Login name<input name="loginName" type="text" autocomplete="username" autocapitalize="none" spellcheck="false" required/);
	assert.doesNotMatch(form, /type="email"|name="email"|autocomplete="email"|resetPasswordForEmail|supabaseClient/);
});

test('password-reset login-name resolver trims and compares case-insensitively for known users', async () => {
	for (const loginName of ['james.brooks', 'ruby.atkinson', 'mark.nesbit.professional']) {
		const client = eligibleClient(loginName);
		const result = await resolvePasswordResetLoginName(client, ` ${loginName.toUpperCase()} `);

		assert.equal(result.status, 'resolved');
		assert.equal(result.profileId, `${loginName}-profile`);
		assert.equal(result.authUserId, `${loginName}-auth`);
		assert.equal(result.contactEmail, `${loginName}@example.com`);
		assert.match(result.authEmail, /mark\.nesbit\.professional\+wt\./);
		assert.ok(client.calls.some((call) => call[0] === 'eq' && call[1] === 'login_name' && call[2] === loginName));
	}
});

test('password-reset resolver returns safe failure states without arbitrary matches', async () => {
	assert.equal(
		(await resolvePasswordResetLoginName(adminClient({ profiles: [] }), 'unknown.person')).status,
		'profile_not_found',
	);
	assert.equal(
		(await resolvePasswordResetLoginName(adminClient({
			profiles: [
				{ id: 'profile-a', auth_user_id: 'auth-a', contact_email: 'a@example.com' },
				{ id: 'profile-b', auth_user_id: 'auth-b', contact_email: 'b@example.com' },
			],
		}), 'ruby.atkinson')).status,
		'ambiguous_login_name',
	);
	assert.equal(
		(await resolvePasswordResetLoginName(adminClient({
			profiles: [{ id: 'profile-id', auth_user_id: null, contact_email: 'ruby@example.com' }],
		}), 'ruby.atkinson')).status,
		'auth_identity_missing',
	);
	assert.equal(
		(await resolvePasswordResetLoginName(adminClient({
			profiles: [{ id: 'profile-id', auth_user_id: 'auth-user-id', contact_email: 'ruby@example.com' }],
			memberships: [],
		}), 'ruby.atkinson')).status,
		'no_active_membership',
	);
	assert.equal(
		(await resolvePasswordResetLoginName(adminClient({
			profiles: [{ id: 'profile-id', auth_user_id: 'auth-user-id', contact_email: null }],
			memberships: [{ id: 'membership-id' }],
		}), 'ruby.atkinson')).status,
		'missing_delivery_address',
	);
	assert.equal(
		(await resolvePasswordResetLoginName(adminClient({
			profiles: [{ id: 'profile-id', auth_user_id: 'auth-user-id', contact_email: 'ruby@example.com' }],
			memberships: [{ id: 'membership-id' }],
			authUser: null,
		}), 'ruby.atkinson')).status,
		'auth_account_invalid',
	);
});

test('password reset delivery sends generated recovery links to contact email through Resend', async () => {
	let requestBody = {};
	const result = await sendPasswordResetEmail({
		recipientEmail: 'Ruby.Atkinson+Reset@Example.com',
		actionLink: 'https://supabase.example/auth/v1/verify?token_hash=abc&type=recovery&redirect_to=https%3A%2F%2Fwatch-tower.co.uk%2Freset-password',
		env: {
			WATCHTOWER_EMAIL_PROVIDER: 'resend',
			WATCHTOWER_RESEND_API_KEY: 're_test',
			WATCHTOWER_EMAIL_FROM_NAME: 'Watchtower',
			WATCHTOWER_EMAIL_FROM_ADDRESS: 'invitations@watch-tower.co.uk',
			WATCHTOWER_PASSWORD_RESET_REPLY_TO: 'support@watch-tower.co.uk',
			WATCHTOWER_SITE_URL: 'https://watch-tower.co.uk',
		},
		fetchImpl: async (_url, init) => {
			requestBody = JSON.parse(String(init?.body ?? '{}'));
			assert.equal(String(init?.headers?.authorization ?? ''), 'Bearer re_test');
			return new Response(JSON.stringify({ id: 'resend_reset_123' }), { status: 200, headers: { 'content-type': 'application/json' } });
		},
	});

	assert.equal(result.status, 'delivered');
	assert.equal(result.providerName, 'resend');
	assert.equal(result.providerMessageId, 'resend_reset_123');
	assert.deepEqual(requestBody.to, ['ruby.atkinson+reset@example.com']);
	assert.equal(requestBody.from, 'Watchtower <invitations@watch-tower.co.uk>');
	assert.equal(requestBody.reply_to, 'support@watch-tower.co.uk');
	assert.match(requestBody.subject, /Reset your Watchtower password/);
	assert.match(requestBody.text, /token_hash=abc/);
	assert.doesNotMatch(JSON.stringify(requestBody), /mark\.nesbit\.professional\+wt/i);
});

test('password reset provider configuration is production-origin bounded', () => {
	assert.equal(buildPasswordResetCompletionUrl({ WATCHTOWER_SITE_URL: 'https://watch-tower.co.uk/app' }), 'https://watch-tower.co.uk/reset-password');
	assert.equal(buildPasswordResetCompletionUrl({ WATCHTOWER_SITE_URL: 'https://evil.example' }), null);
	assert.equal(resolvePasswordResetProviderConfig({ WATCHTOWER_PASSWORD_RESET_DELIVERY_MODE: 'test_record_only' }).mode, 'test_record_only');
	assert.equal(resolvePasswordResetProviderConfig({
		WATCHTOWER_EMAIL_PROVIDER: 'resend',
		WATCHTOWER_RESEND_API_KEY: 're_test',
		WATCHTOWER_EMAIL_FROM_ADDRESS: 'invitations@watch-tower.co.uk',
		WATCHTOWER_SITE_URL: 'https://watch-tower.co.uk',
	}).mode, 'resend');
});

test('Supabase recovery action-link validation accepts the trusted provider URL and Watchtower redirect', () => {
	const result = validateSupabaseRecoveryActionLink(recoveryProperties(), trustedResetEnv);

	assert.equal(result.status, 'valid');
	assert.match(result.actionLink, /^https:\/\/project-ref\.supabase\.co\/auth\/v1\/verify\?/);
	assert.doesNotMatch(result.actionLink, /^https:\/\/watch-tower\.co\.uk/);
	assert.equal(result.diagnostics.expectedProviderOrigin, 'https://project-ref.supabase.co');
	assert.equal(result.diagnostics.observedProviderOrigin, 'https://project-ref.supabase.co');
	assert.equal(result.diagnostics.originsMatch, true);
});

test('Supabase recovery action-link validation rejects unsafe provider URLs', () => {
	assert.equal(validateSupabaseRecoveryActionLink(null, trustedResetEnv).failureCode, 'provider_link_missing');
	assert.equal(validateSupabaseRecoveryActionLink({ action_link: 'not a url' }, trustedResetEnv).failureCode, 'provider_response_invalid');
	assert.equal(validateSupabaseRecoveryActionLink(recoveryProperties({ origin: 'https://project-ref.supabase.co.evil.example' }), trustedResetEnv).failureCode, 'provider_host_invalid');
	assert.equal(validateSupabaseRecoveryActionLink(recoveryProperties({ origin: 'https://evil-project-ref.supabase.co' }), trustedResetEnv).failureCode, 'provider_host_invalid');
	assert.equal(validateSupabaseRecoveryActionLink(recoveryProperties({ origin: 'http://project-ref.supabase.co' }), trustedResetEnv).failureCode, 'provider_host_invalid');
	assert.equal(validateSupabaseRecoveryActionLink(recoveryProperties({ origin: 'https://user:pass@project-ref.supabase.co' }), trustedResetEnv).failureCode, 'provider_host_invalid');
	assert.equal(validateSupabaseRecoveryActionLink(recoveryProperties({ path: '/auth/v1/callback' }), trustedResetEnv).failureCode, 'provider_path_invalid');
	assert.equal(validateSupabaseRecoveryActionLink(recoveryProperties({ tokenHash: null }), trustedResetEnv).failureCode, 'provider_response_invalid');
	assert.equal(validateSupabaseRecoveryActionLink(recoveryProperties({ type: 'signup' }), trustedResetEnv).failureCode, 'provider_response_invalid');
	assert.equal(validateSupabaseRecoveryActionLink(recoveryProperties({ type: null, verificationType: 'signup' }), trustedResetEnv).failureCode, 'provider_response_invalid');
});

test('Supabase recovery action-link validation accepts only explicitly configured Auth action origins', () => {
	const customOriginEnv = {
		...trustedResetEnv,
		SUPABASE_AUTH_ACTION_ORIGIN: ' https://auth.watch-tower.co.uk/reset ',
	};
	const result = validateSupabaseRecoveryActionLink(recoveryProperties({ origin: 'https://auth.watch-tower.co.uk' }), customOriginEnv);

	assert.deepEqual(resolveTrustedSupabaseActionOrigins(customOriginEnv), [
		'https://auth.watch-tower.co.uk',
		'https://project-ref.supabase.co',
	]);
	assert.equal(result.status, 'valid');
	assert.equal(result.diagnostics.expectedProviderOrigin, 'https://auth.watch-tower.co.uk');
	assert.equal(result.diagnostics.observedProviderHostname, 'auth.watch-tower.co.uk');
	assert.equal(validateSupabaseRecoveryActionLink(recoveryProperties({ origin: 'https://other-project.supabase.co' }), customOriginEnv).failureCode, 'provider_host_invalid');
	assert.equal(validateSupabaseRecoveryActionLink(recoveryProperties({ origin: 'https://anything.supabase.co' }), {
		...trustedResetEnv,
		PUBLIC_SUPABASE_URL: 'https://stale-project.supabase.co',
	}).failureCode, 'provider_host_invalid');
});

test('Supabase recovery action-link validation supports explicit exact allow-list origins', () => {
	const allowListEnv = {
		...trustedResetEnv,
		SUPABASE_AUTH_ACTION_ORIGINS: 'https://auth-one.watch-tower.co.uk, https://auth-two.watch-tower.co.uk/path,not a url,http://auth-three.watch-tower.co.uk',
	};

	assert.deepEqual(resolveTrustedSupabaseActionOrigins(allowListEnv), [
		'https://auth-one.watch-tower.co.uk',
		'https://auth-two.watch-tower.co.uk',
		'https://project-ref.supabase.co',
	]);
	assert.equal(validateSupabaseRecoveryActionLink(recoveryProperties({ origin: 'https://auth-two.watch-tower.co.uk' }), allowListEnv).status, 'valid');
	assert.equal(validateSupabaseRecoveryActionLink(recoveryProperties({ origin: 'https://auth-two.watch-tower.co.uk.evil.example' }), allowListEnv).failureCode, 'provider_host_invalid');
});

test('Supabase recovery action-link diagnostics are safe and omit query token and redirect data', () => {
	const result = validateSupabaseRecoveryActionLink(recoveryProperties({ origin: 'https://unexpected.supabase.co' }), trustedResetEnv);

	assert.equal(result.status, 'invalid');
	assert.equal(result.failureCode, 'provider_host_invalid');
	assert.deepEqual(result.diagnostics, {
		expectedProviderOrigin: 'https://project-ref.supabase.co',
		observedProviderOrigin: 'https://unexpected.supabase.co',
		expectedProviderHostname: 'project-ref.supabase.co',
		observedProviderHostname: 'unexpected.supabase.co',
		observedProtocol: 'https:',
		observedPathname: '/auth/v1/verify',
		originsMatch: false,
		hostnamesMatch: false,
	});
	assert.doesNotMatch(JSON.stringify(result.diagnostics), /token_hash|provider-token-hash|redirect_to|watch-tower\.co\.uk\/reset-password|\?/i);
});

test('production Worker runtime declares the public Supabase URL used by recovery validation', async () => {
	const wranglerConfig = await readFile(new URL('../wrangler.toml', import.meta.url), 'utf8');
	const envExample = await readFile(new URL('../.env.example', import.meta.url), 'utf8');

	assert.match(wranglerConfig, /PUBLIC_SUPABASE_URL = "https:\/\/wwxauzcgqtrqjyyskqzp\.supabase\.co"/);
	assert.doesNotMatch(wranglerConfig, /PUBLIC_SUPABASE_ANON_KEY|SUPABASE_SERVICE_ROLE_KEY|WATCHTOWER_RESEND_API_KEY/);
	assert.match(envExample, /SUPABASE_AUTH_ACTION_ORIGIN=/);
	assert.match(envExample, /Auth action-link origin/);
});

test('Supabase recovery action-link validation rejects unsafe Watchtower redirects', () => {
	assert.equal(validateSupabaseRecoveryActionLink(recoveryProperties({ redirectTo: 'https://watch-tower.co.uk/reset-password' }), trustedResetEnv).status, 'valid');
	assert.equal(validateSupabaseRecoveryActionLink(recoveryProperties({ redirectTo: 'https://evil.example/reset-password' }), trustedResetEnv).failureCode, 'redirect_invalid');
	assert.equal(validateSupabaseRecoveryActionLink(recoveryProperties({ redirectTo: 'https://watch-tower.co.uk.evil.example/reset-password' }), trustedResetEnv).failureCode, 'redirect_invalid');
	assert.equal(validateSupabaseRecoveryActionLink(recoveryProperties({ redirectTo: 'https://reset.watch-tower.co.uk/reset-password' }), trustedResetEnv).failureCode, 'redirect_invalid');
	assert.equal(validateSupabaseRecoveryActionLink(recoveryProperties({ redirectTo: '//evil.example/reset-password' }), trustedResetEnv).failureCode, 'redirect_invalid');
	assert.equal(validateSupabaseRecoveryActionLink(recoveryProperties({ redirectTo: 'javascript:alert(1)' }), trustedResetEnv).failureCode, 'redirect_invalid');
	assert.equal(validateSupabaseRecoveryActionLink(recoveryProperties({ redirectTo: 'data:text/html,reset' }), trustedResetEnv).failureCode, 'redirect_invalid');
	assert.equal(validateSupabaseRecoveryActionLink(recoveryProperties({ redirectTo: 'https://user:pass@watch-tower.co.uk/reset-password' }), trustedResetEnv).failureCode, 'redirect_invalid');
	assert.equal(validateSupabaseRecoveryActionLink(recoveryProperties({ redirectTo: 'https://watch-tower.co.uk/login' }), trustedResetEnv).failureCode, 'redirect_invalid');
	assert.equal(validateSupabaseRecoveryActionLink(recoveryProperties({ redirectTo: null }), trustedResetEnv).failureCode, 'redirect_invalid');
});

test('validated recovery action link is delivered through Resend without exposing contact email to the page', async () => {
	const validation = validateSupabaseRecoveryActionLink(recoveryProperties(), trustedResetEnv);
	assert.equal(validation.status, 'valid');

	let requestBody = {};
	const result = await sendPasswordResetEmail({
		recipientEmail: 'James.Brooks+Reset@Example.com',
		actionLink: validation.actionLink,
		env: {
			...trustedResetEnv,
			WATCHTOWER_EMAIL_PROVIDER: 'resend',
			WATCHTOWER_RESEND_API_KEY: 're_test',
			WATCHTOWER_EMAIL_FROM_ADDRESS: 'invitations@watch-tower.co.uk',
		},
		fetchImpl: async (_url, init) => {
			requestBody = JSON.parse(String(init?.body ?? '{}'));
			return new Response(JSON.stringify({ id: 'resend_reset_456' }), { status: 200, headers: { 'content-type': 'application/json' } });
		},
	});

	assert.equal(result.status, 'delivered');
	assert.deepEqual(requestBody.to, ['james.brooks+reset@example.com']);
	assert.match(requestBody.text, /https:\/\/project-ref\.supabase\.co\/auth\/v1\/verify/);
	assert.doesNotMatch(JSON.stringify(requestBody), /mark\.nesbit\.professional\+wt/i);
});

test('password reset public confirmation and audit payload stay neutral and redacted', async () => {
	const page = await readFile(new URL('../src/pages/forgot-password.astro', import.meta.url), 'utf8');
	const form = await readFile(new URL('../src/components/auth/ForgotPasswordForm.astro', import.meta.url), 'utf8');
	const loginPage = await readFile(new URL('../src/pages/login.astro', import.meta.url), 'utf8');
	const resetForm = await readFile(new URL('../src/components/auth/ResetPasswordForm.astro', import.meta.url), 'utf8');
	const setupRoute = await readFile(new URL('../src/pages/invitations/setup.ts', import.meta.url), 'utf8');

	assert.equal(PASSWORD_RESET_PUBLIC_CONFIRMATION, 'If an eligible account matches that login name, password reset instructions have been sent.');
	assert.match(page, /Astro\.request\.method === 'POST'/);
	assert.match(page, /resolvePasswordResetLoginName\(adminSupabase, loginName\)/);
	assert.match(page, /auth\.admin\.generateLink\(\{/);
	assert.match(page, /type: 'recovery'/);
	assert.match(page, /sendPasswordResetEmail\(\{/);
	assert.match(page, /validateSupabaseRecoveryActionLink\(linkData\?\.properties/);
	assert.match(page, /password_reset_provider_origin_mismatch/);
	assert.match(page, /recipientEmail: resolution\.contactEmail/);
	assert.match(page, /email: resolution\.authEmail/);
	assert.match(page, /actionLink: actionLinkValidation\.actionLink/);
	assert.match(page, /message = PASSWORD_RESET_PUBLIC_CONFIRMATION/);
	assert.doesNotMatch(form, /mark\.nesbit\.professional\+wt|contact_email|auth_email|token_hash/);
	assert.doesNotMatch(page, /import\.meta\.env/);
	assert.doesNotMatch(page, /resetPasswordForEmail|recordAuthAuditEvent|formData\.get\('email'\)|console\.(?:log|warn|error)\([^)]*(?:loginName|authEmail|contactEmail|actionLink|token|password)|console\.info\([^)]*(?:actionLink|tokenHash|contactEmail|authEmail|redirectTo)/);
	assert.match(loginPage, /resolveLoginNameAuthIdentity/);
	assert.match(resetForm, /supabase\.auth\.updateUser\(\{ password \}\)/);
	assert.match(setupRoute, /resolveLinkedAuthUserId\(adminSupabase, invitation, tokenHash\)/);

	const auditPayload = passwordResetAuditPayload({ outcome: 'success', deliveryPath: 'watchtower_resend_contact_email', activeMembershipCount: 1 });
	assert.deepEqual(auditPayload, {
		routeName: 'forgot_password',
		outcome: 'success',
		delivery_path: 'watchtower_resend_contact_email',
		active_membership_count: 1,
	});
	assert.doesNotMatch(JSON.stringify(auditPayload), /@|token_hash|reset_token|new_password|james|ruby|mark\.nesbit\.professional\+wt/i);
});

test('password reset helpers avoid logging reset links and generated email escapes HTML', () => {
	const email = renderPasswordResetEmail('https://supabase.example/reset?token_hash=<secret>');

	assert.match(email.text, /token_hash=<secret>/);
	assert.match(email.html, /token_hash=&lt;secret&gt;/);
});

test('password reset rate limiting fails closed without exposing account state', () => {
	clearPasswordResetRateLimitState();
	const key = 'stable-rate-limit-key';

	assert.equal(isPasswordResetRateLimited(key, 1_000), false);
	assert.equal(isPasswordResetRateLimited(key, 2_000), false);
	assert.equal(isPasswordResetRateLimited(key, 3_000), false);
	assert.equal(isPasswordResetRateLimited(key, 4_000), true);
	assert.equal(PASSWORD_RESET_PUBLIC_CONFIRMATION, 'If an eligible account matches that login name, password reset instructions have been sent.');
});
