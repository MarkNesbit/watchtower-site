import { resolveWatchtowerSiteOrigin, type WatchtowerOriginEnv } from './watchtowerOrigins.ts';

const RESEND_EMAIL_ENDPOINT = 'https://api.resend.com/emails';
const PROVIDER_TIMEOUT_MS = 10_000;

export const PASSWORD_RESET_PUBLIC_CONFIRMATION = 'If an eligible account matches that login name, password reset instructions have been sent.';

export type PasswordResetDeliveryEnv = WatchtowerOriginEnv & {
	PUBLIC_SUPABASE_URL?: string;
	SUPABASE_AUTH_ACTION_ORIGIN?: string;
	SUPABASE_AUTH_ACTION_ORIGINS?: string;
	WATCHTOWER_PASSWORD_RESET_DELIVERY_MODE?: string;
	WATCHTOWER_EMAIL_PROVIDER?: string;
	WATCHTOWER_RESEND_API_KEY?: string;
	WATCHTOWER_EMAIL_FROM_ADDRESS?: string;
	WATCHTOWER_EMAIL_FROM_NAME?: string;
	WATCHTOWER_PASSWORD_RESET_REPLY_TO?: string;
	WATCHTOWER_INVITATION_REPLY_TO?: string;
	WATCHTOWER_INVITATION_FROM_EMAIL?: string;
	WATCHTOWER_INVITATION_FROM_NAME?: string;
};

export type SupabaseRecoveryActionLinkValidationCode =
	| 'provider_link_missing'
	| 'provider_host_invalid'
	| 'provider_path_invalid'
	| 'provider_response_invalid'
	| 'redirect_invalid';

export type SupabaseRecoveryActionLinkValidationResult =
	| {
		status: 'valid';
		actionLink: string;
		diagnostics: SupabaseRecoveryActionLinkDiagnostics;
		responseDiagnostics: SupabaseRecoveryProviderResponseDiagnostics;
	}
	| {
		status: 'invalid';
		failureCode: SupabaseRecoveryActionLinkValidationCode;
		diagnostics: SupabaseRecoveryActionLinkDiagnostics;
		responseDiagnostics: SupabaseRecoveryProviderResponseDiagnostics;
	};

export type SupabaseRecoveryActionLinkDiagnostics = {
	expectedProviderOrigin: string | null;
	observedProviderOrigin: string | null;
	expectedProviderHostname: string | null;
	observedProviderHostname: string | null;
	observedProtocol: string | null;
	observedPathname: string | null;
	originsMatch: boolean;
	hostnamesMatch: boolean;
};

export type SupabaseRecoveryProviderResponseDiagnostics = {
	topLevelKeys: string[];
	propertyKeys: string[];
	hasProperties: boolean;
	hasActionLink: boolean;
	actionLinkType: string;
	hasVerificationType: boolean;
	verificationTypeValue: string;
	hasHashedToken: boolean;
	hashedTokenType: string;
	actionLinkQueryParameterNames: string[];
};

export type PasswordResetDeliveryResult = {
	status: 'delivered' | 'delivery_failed';
	providerName?: string;
	providerMessageId?: string;
	failureCode?: string;
	failureMessage?: string;
};

type ProviderConfig =
	| { mode: 'test_record_only' }
	| { mode: 'provider_required'; failureCode: string; failureMessage: string }
	| {
		mode: 'resend';
		apiKey: string;
		from: string;
		replyTo?: string;
		siteOrigin: string;
	};

export function normalisePasswordResetEmail(value: unknown): string | null {
	const email = String(value ?? '').trim().toLowerCase();
	if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
	return email;
}

function hasBinding(value: unknown): boolean {
	return String(value ?? '').trim().length > 0;
}

function formatDisplayName(value: string): string {
	return value.replace(/[<>"\r\n]/g, '').trim() || 'Watchtower';
}

export function resolvePasswordResetSiteOrigin(env: PasswordResetDeliveryEnv = import.meta.env ?? {}): string | null {
	return resolveWatchtowerSiteOrigin(env);
}

export function passwordResetDeliveryMode(env: PasswordResetDeliveryEnv = import.meta.env ?? {}): 'provider_required' | 'test_record_only' {
	const mode = String(env.WATCHTOWER_PASSWORD_RESET_DELIVERY_MODE ?? '').trim();
	return mode === 'test_record_only' ? 'test_record_only' : 'provider_required';
}

export function passwordResetEmailConfigDiagnostics(env: PasswordResetDeliveryEnv = import.meta.env ?? {}) {
	return {
		publicSupabaseUrlBindingPresent: hasBinding(env.PUBLIC_SUPABASE_URL),
		authActionOriginBindingPresent: hasBinding(env.SUPABASE_AUTH_ACTION_ORIGIN) || hasBinding(env.SUPABASE_AUTH_ACTION_ORIGINS),
		providerBindingPresent: hasBinding(env.WATCHTOWER_EMAIL_PROVIDER),
		apiKeyBindingPresent: hasBinding(env.WATCHTOWER_RESEND_API_KEY),
		senderBindingPresent: hasBinding(env.WATCHTOWER_EMAIL_FROM_ADDRESS ?? env.WATCHTOWER_INVITATION_FROM_EMAIL),
		siteUrlBindingPresent: hasBinding(env.WATCHTOWER_SITE_URL),
	};
}

export function resolvePasswordResetProviderConfig(env: PasswordResetDeliveryEnv = import.meta.env ?? {}): ProviderConfig {
	if (passwordResetDeliveryMode(env) === 'test_record_only') {
		return { mode: 'test_record_only' };
	}

	const provider = String(env.WATCHTOWER_EMAIL_PROVIDER ?? '').trim().toLowerCase();
	if (!provider || provider !== 'resend') {
		return {
			mode: 'provider_required',
			failureCode: 'provider_not_configured',
			failureMessage: 'Password reset email provider is not configured.',
		};
	}

	const apiKey = String(env.WATCHTOWER_RESEND_API_KEY ?? '').trim();
	const fromEmail = normalisePasswordResetEmail(env.WATCHTOWER_EMAIL_FROM_ADDRESS ?? env.WATCHTOWER_INVITATION_FROM_EMAIL);
	const fromName = String(env.WATCHTOWER_EMAIL_FROM_NAME ?? env.WATCHTOWER_INVITATION_FROM_NAME ?? 'Watchtower').trim() || 'Watchtower';
	const siteOrigin = resolvePasswordResetSiteOrigin(env);
	if (!apiKey || !fromEmail || !siteOrigin) {
		return {
			mode: 'provider_required',
			failureCode: 'provider_not_configured',
			failureMessage: 'Password reset email provider is missing required server-side configuration.',
		};
	}

	const replyTo = normalisePasswordResetEmail(env.WATCHTOWER_PASSWORD_RESET_REPLY_TO ?? env.WATCHTOWER_INVITATION_REPLY_TO);
	return {
		mode: 'resend',
		apiKey,
		from: `${formatDisplayName(fromName)} <${fromEmail}>`,
		replyTo: replyTo ?? undefined,
		siteOrigin,
	};
}

export function buildPasswordResetCompletionUrl(env: PasswordResetDeliveryEnv = import.meta.env ?? {}): string | null {
	const siteOrigin = resolvePasswordResetSiteOrigin(env);
	if (!siteOrigin) return null;
	return new URL('/reset-password', siteOrigin).toString();
}

export function validateSupabaseRecoveryActionLink(
	response: Record<string, unknown> | null | undefined,
	env: PasswordResetDeliveryEnv = import.meta.env ?? {},
): SupabaseRecoveryActionLinkValidationResult {
	const trustedOrigins = resolveTrustedSupabaseActionOrigins(env);
	const extracted = extractGeneratedRecoveryAction(response);
	const emptyDiagnostics = recoveryActionLinkDiagnostics(null, trustedOrigins);
	if (extracted.status !== 'extracted') {
		return invalidRecoveryLink(extracted.failureCode, emptyDiagnostics, extracted.responseDiagnostics);
	}
	const { actionLink: rawActionLink, properties, responseDiagnostics } = extracted;

	if (trustedOrigins.length < 1) return invalidRecoveryLink('provider_host_invalid', emptyDiagnostics, responseDiagnostics);

	let actionUrl: URL;
	try {
		actionUrl = new URL(rawActionLink);
	} catch {
		return invalidRecoveryLink('provider_response_invalid', emptyDiagnostics, responseDiagnostics);
	}
	const diagnostics = recoveryActionLinkDiagnostics(actionUrl, trustedOrigins);
	const originTrusted = trustedOrigins.includes(actionUrl.origin);

	if (
		actionUrl.protocol !== 'https:'
		|| !originTrusted
		|| actionUrl.username
		|| actionUrl.password
	) {
		return invalidRecoveryLink('provider_host_invalid', diagnostics, responseDiagnostics);
	}

	if (normalisePathname(actionUrl.pathname) !== '/auth/v1/verify') {
		return invalidRecoveryLink('provider_path_invalid', diagnostics, responseDiagnostics);
	}

	const responseVerificationType = stringProperty(properties, 'verification_type');
	const linkVerificationType = actionUrl.searchParams.get('type');
	const verificationType = responseVerificationType ?? linkVerificationType;
	if (verificationType !== 'recovery' || (linkVerificationType !== null && linkVerificationType !== 'recovery')) {
		return invalidRecoveryLink('provider_response_invalid', diagnostics, responseDiagnostics);
	}

	const providerToken = actionUrl.searchParams.get('token');
	if (!providerToken || !providerToken.trim()) return invalidRecoveryLink('provider_response_invalid', diagnostics, responseDiagnostics);

	const responseTokenHash = stringProperty(properties, 'hashed_token');
	if (responseTokenHash !== null && !responseTokenHash.trim()) return invalidRecoveryLink('provider_response_invalid', diagnostics, responseDiagnostics);

	const redirectTo = actionUrl.searchParams.get('redirect_to') ?? stringProperty(properties, 'redirect_to');
	if (!redirectTo || !isApprovedPasswordResetRedirect(redirectTo, env)) {
		return invalidRecoveryLink('redirect_invalid', diagnostics, responseDiagnostics);
	}

	return { status: 'valid', actionLink: rawActionLink, diagnostics, responseDiagnostics };
}

export function renderPasswordResetEmail(actionLink: string) {
	const subject = 'Reset your Watchtower password';
	const text = [
		'Hello,',
		'',
		'A password reset was requested for your Watchtower account.',
		'Use the secure link below to choose a new password.',
		'',
		`Reset password: ${actionLink}`,
		'',
		'If you did not request this, ignore this message.',
	].join('\n');
	const html = [
		'<main>',
		'<p>Hello,</p>',
		'<p>A password reset was requested for your Watchtower account.</p>',
		'<p>Use the secure link below to choose a new password.</p>',
		`<p><a href="${escapeHtml(actionLink)}">Reset password</a></p>`,
		'<p>If you did not request this, ignore this message.</p>',
		'</main>',
	].join('');
	return { subject, text, html };
}

export async function sendPasswordResetEmail(request: {
	recipientEmail?: string | null;
	actionLink: string;
	env?: PasswordResetDeliveryEnv;
	fetchImpl?: typeof fetch;
}): Promise<PasswordResetDeliveryResult> {
	const recipientEmail = normalisePasswordResetEmail(request.recipientEmail);
	if (!recipientEmail) {
		return deliveryFailure('recipient_email_missing', 'Password reset recipient email could not be resolved.');
	}

	const config = resolvePasswordResetProviderConfig(request.env ?? import.meta.env ?? {});
	if (config.mode === 'test_record_only') {
		return {
			status: 'delivered',
			providerName: 'test_record_only',
			providerMessageId: 'test_password_reset',
		};
	}
	if (config.mode === 'provider_required') {
		return deliveryFailure(config.failureCode, config.failureMessage);
	}

	const email = renderPasswordResetEmail(request.actionLink);
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), PROVIDER_TIMEOUT_MS);
	try {
		const response = await (request.fetchImpl ?? fetch)(RESEND_EMAIL_ENDPOINT, {
			method: 'POST',
			headers: {
				authorization: `Bearer ${config.apiKey}`,
				'content-type': 'application/json',
			},
			body: JSON.stringify({
				from: config.from,
				to: [recipientEmail],
				reply_to: config.replyTo,
				subject: email.subject,
				html: email.html,
				text: email.text,
				headers: {
					'X-Watchtower-Email-Type': 'password-reset',
				},
			}),
			signal: controller.signal,
		});
		clearTimeout(timeout);

		if (!response.ok) {
			return {
				...deliveryFailure(failureCodeForProviderStatus(response.status), safeProviderFailureMessage(response.status)),
				providerName: 'resend',
			};
		}

		const body = await safeJson(response);
		return {
			status: 'delivered',
			providerName: 'resend',
			providerMessageId: typeof body?.id === 'string' ? body.id : undefined,
		};
	} catch (error) {
		clearTimeout(timeout);
		const aborted = error instanceof Error && error.name === 'AbortError';
		return {
			...deliveryFailure(
				aborted ? 'provider_timeout' : 'provider_unavailable',
				aborted ? 'Password reset email provider timed out.' : 'Password reset email provider could not be reached.',
			),
			providerName: 'resend',
		};
	}
}

function deliveryFailure(failureCode: string, failureMessage: string): PasswordResetDeliveryResult {
	return {
		status: 'delivery_failed',
		failureCode,
		failureMessage,
	};
}

function failureCodeForProviderStatus(status: number): string {
	if (status === 401 || status === 403) return 'provider_auth_failed';
	if (status === 429) return 'provider_rate_limited';
	if (status >= 400 && status < 500) return 'provider_rejected';
	return 'provider_unavailable';
}

function safeProviderFailureMessage(status: number): string {
	if (status === 401 || status === 403) return 'Password reset email provider rejected the configured credentials.';
	if (status === 429) return 'Password reset email provider rate limit was reached.';
	if (status >= 400 && status < 500) return 'Password reset email provider rejected the message.';
	return 'Password reset email provider did not accept the message.';
}

function invalidRecoveryLink(
	failureCode: SupabaseRecoveryActionLinkValidationCode,
	diagnostics: SupabaseRecoveryActionLinkDiagnostics,
	responseDiagnostics: SupabaseRecoveryProviderResponseDiagnostics,
): SupabaseRecoveryActionLinkValidationResult {
	return { status: 'invalid', failureCode, diagnostics, responseDiagnostics };
}

export function extractGeneratedRecoveryAction(response: Record<string, unknown> | null | undefined):
	| { status: 'extracted'; actionLink: string; properties: Record<string, unknown>; responseDiagnostics: SupabaseRecoveryProviderResponseDiagnostics }
	| { status: 'invalid'; failureCode: SupabaseRecoveryActionLinkValidationCode; responseDiagnostics: SupabaseRecoveryProviderResponseDiagnostics } {
	const responseDiagnostics = recoveryProviderResponseDiagnostics(response);
	if (!isRecord(response) || !isRecord(response.properties)) {
		return { status: 'invalid', failureCode: 'provider_response_invalid', responseDiagnostics };
	}

	const actionLink = response.properties.action_link;
	if (actionLink === undefined || actionLink === null || actionLink === '') {
		return { status: 'invalid', failureCode: 'provider_link_missing', responseDiagnostics };
	}
	if (typeof actionLink !== 'string' || actionLink.trim().length < 1 || actionLink !== actionLink.trim()) {
		return { status: 'invalid', failureCode: 'provider_response_invalid', responseDiagnostics };
	}

	return {
		status: 'extracted',
		actionLink,
		properties: response.properties,
		responseDiagnostics,
	};
}

export function resolveTrustedSupabaseActionOrigins(env: PasswordResetDeliveryEnv = import.meta.env ?? {}): string[] {
	const configuredOrigins = [
		env.SUPABASE_AUTH_ACTION_ORIGIN,
		...String(env.SUPABASE_AUTH_ACTION_ORIGINS ?? '').split(','),
		env.PUBLIC_SUPABASE_URL,
	];
	const origins: string[] = [];
	for (const configuredOrigin of configuredOrigins) {
		const origin = normaliseTrustedHttpsOrigin(configuredOrigin);
		if (origin && !origins.includes(origin)) origins.push(origin);
	}
	return origins;
}

function normaliseTrustedHttpsOrigin(value: unknown): string | null {
	const configured = String(value ?? '').trim();
	if (!configured) return null;
	try {
		const url = new URL(configured);
		if (url.protocol !== 'https:' || url.username || url.password) return null;
		return url.origin;
	} catch {
		return null;
	}
}

function recoveryActionLinkDiagnostics(actionUrl: URL | null, trustedOrigins: string[]): SupabaseRecoveryActionLinkDiagnostics {
	const expectedProviderOrigin = trustedOrigins[0] ?? null;
	const observedProviderOrigin = actionUrl?.origin ?? null;
	const expectedProviderHostname = expectedProviderOrigin ? new URL(expectedProviderOrigin).hostname : null;
	const observedProviderHostname = actionUrl?.hostname ?? null;
	return {
		expectedProviderOrigin,
		observedProviderOrigin,
		expectedProviderHostname,
		observedProviderHostname,
		observedProtocol: actionUrl?.protocol ?? null,
		observedPathname: actionUrl ? normalisePathname(actionUrl.pathname) : null,
		originsMatch: observedProviderOrigin !== null && trustedOrigins.includes(observedProviderOrigin),
		hostnamesMatch: observedProviderHostname !== null && trustedOrigins.some((origin) => new URL(origin).hostname === observedProviderHostname),
	};
}

function recoveryProviderResponseDiagnostics(response: Record<string, unknown> | null | undefined): SupabaseRecoveryProviderResponseDiagnostics {
	const topLevelKeys = safeObjectKeys(response);
	const properties = isRecord(response) && isRecord(response.properties) ? response.properties : null;
	const propertyKeys = safeObjectKeys(properties);
	const actionLink = properties?.action_link;
	const verificationType = properties?.verification_type;
	const hashedToken = properties?.hashed_token;
	return {
		topLevelKeys,
		propertyKeys,
		hasProperties: Boolean(properties),
		hasActionLink: typeof actionLink === 'string' && actionLink.trim().length > 0,
		actionLinkType: safeValueType(actionLink),
		hasVerificationType: verificationType !== undefined && verificationType !== null,
		verificationTypeValue: safeVerificationTypeValue(verificationType),
		hasHashedToken: hashedToken !== undefined && hashedToken !== null,
		hashedTokenType: safeValueType(hashedToken),
		actionLinkQueryParameterNames: actionLinkQueryParameterNames(actionLink),
	};
}

function actionLinkQueryParameterNames(actionLink: unknown): string[] {
	if (typeof actionLink !== 'string') return [];
	try {
		return Array.from(new URL(actionLink).searchParams.keys());
	} catch {
		return [];
	}
}

function safeObjectKeys(value: unknown): string[] {
	return isRecord(value) ? Object.keys(value).sort() : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function safeValueType(value: unknown): string {
	if (value === undefined) return 'undefined';
	if (value === null) return 'null';
	if (Array.isArray(value)) return 'array';
	return typeof value;
}

function safeVerificationTypeValue(value: unknown): string {
	if (value === 'recovery') return 'recovery';
	return safeValueType(value);
}

function isApprovedPasswordResetRedirect(rawRedirectTo: string, env: PasswordResetDeliveryEnv): boolean {
	const expected = buildPasswordResetCompletionUrl(env);
	if (!expected) return false;
	try {
		const redirectUrl = new URL(rawRedirectTo);
		const expectedUrl = new URL(expected);
		return redirectUrl.protocol === 'https:'
			&& redirectUrl.origin === expectedUrl.origin
			&& normalisePathname(redirectUrl.pathname) === normalisePathname(expectedUrl.pathname)
			&& !redirectUrl.username
			&& !redirectUrl.password
			&& redirectUrl.search === ''
			&& redirectUrl.hash === '';
	} catch {
		return false;
	}
}

function normalisePathname(pathname: string): string {
	return pathname.length > 1 ? pathname.replace(/\/+$/g, '') : pathname;
}

function stringProperty(properties: Record<string, unknown> | null | undefined, name: string): string | null {
	const value = properties?.[name];
	return typeof value === 'string' ? value : null;
}

async function safeJson(response: Response): Promise<Record<string, unknown> | null> {
	try {
		const parsed = await response.json();
		return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : null;
	} catch {
		return null;
	}
}

function escapeHtml(value: string) {
	return value
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;')
		.replaceAll("'", '&#39;');
}
