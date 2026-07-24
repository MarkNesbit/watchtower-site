import {
	buildWorkspaceInvitationAcceptPath,
	renderInvitationEmail,
	type InvitationDeliveryResult,
} from './workspaceInvitations.ts';

const RESEND_EMAIL_ENDPOINT = 'https://api.resend.com/emails';
const PRODUCTION_INVITATION_ORIGIN = 'https://watch-tower.co.uk';
const PROVIDER_TIMEOUT_MS = 10_000;

export type InvitationDeliveryEnv = {
	WATCHTOWER_INVITATION_DELIVERY_MODE?: string;
	WATCHTOWER_EMAIL_PROVIDER?: string;
	WATCHTOWER_RESEND_API_KEY?: string;
	WATCHTOWER_EMAIL_FROM_ADDRESS?: string;
	WATCHTOWER_EMAIL_FROM_NAME?: string;
	WATCHTOWER_INVITATION_REPLY_TO?: string;
	WATCHTOWER_SITE_URL?: string;
	WATCHTOWER_INVITATION_FROM_EMAIL?: string;
	WATCHTOWER_INVITATION_FROM_NAME?: string;
};

export type WorkspaceInvitationEmailDeliveryRequest = {
	invitationId: string;
	membershipId: string;
	recipientEmail?: string | null;
	rawToken: string;
	workspaceName: string;
	personName: string;
	roleLabel: string;
	expiresAt?: string | null;
	requestOrigin?: string;
	fetchImpl?: typeof fetch;
	env?: InvitationDeliveryEnv;
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

export function workspaceInvitationDeliveryMode(env: InvitationDeliveryEnv = import.meta.env ?? {}): 'provider_required' | 'test_record_only' {
	const mode = String(env.WATCHTOWER_INVITATION_DELIVERY_MODE ?? '').trim();
	return mode === 'test_record_only' ? 'test_record_only' : 'provider_required';
}

export function resolveWorkspaceInvitationSiteOrigin(env: InvitationDeliveryEnv = import.meta.env ?? {}): string | null {
	const configured = String(env.WATCHTOWER_SITE_URL ?? '').trim();
	if (!configured) return null;
	try {
		const url = new URL(configured);
		if (url.protocol !== 'https:' || url.origin !== PRODUCTION_INVITATION_ORIGIN) return null;
		return url.origin;
	} catch {
		return null;
	}
}

export function workspaceInvitationEmailConfigDiagnostics(env: InvitationDeliveryEnv = import.meta.env ?? {}) {
	return {
		providerBindingPresent: hasBinding(env.WATCHTOWER_EMAIL_PROVIDER),
		apiKeyBindingPresent: hasBinding(env.WATCHTOWER_RESEND_API_KEY),
		senderBindingPresent: hasBinding(env.WATCHTOWER_EMAIL_FROM_ADDRESS ?? env.WATCHTOWER_INVITATION_FROM_EMAIL),
		siteUrlBindingPresent: hasBinding(env.WATCHTOWER_SITE_URL),
	};
}

export function resolveInvitationProviderConfig(env: InvitationDeliveryEnv = import.meta.env ?? {}): ProviderConfig {
	if (workspaceInvitationDeliveryMode(env) === 'test_record_only') {
		return { mode: 'test_record_only' };
	}

	const provider = String(env.WATCHTOWER_EMAIL_PROVIDER ?? '').trim().toLowerCase();
	if (!provider) {
		return {
			mode: 'provider_required',
			failureCode: 'provider_not_configured',
			failureMessage: 'Invitation email provider is not configured. Retry after enabling the server-side delivery provider.',
		};
	}
	if (provider !== 'resend') {
		return {
			mode: 'provider_required',
			failureCode: 'provider_not_configured',
			failureMessage: 'Invitation email provider is not supported by this deployment.',
		};
	}

	const apiKey = String(env.WATCHTOWER_RESEND_API_KEY ?? '').trim();
	const fromEmail = normaliseEmail(env.WATCHTOWER_EMAIL_FROM_ADDRESS ?? env.WATCHTOWER_INVITATION_FROM_EMAIL);
	const fromName = String(env.WATCHTOWER_EMAIL_FROM_NAME ?? env.WATCHTOWER_INVITATION_FROM_NAME ?? 'Watchtower').trim() || 'Watchtower';
	const siteOrigin = resolveWorkspaceInvitationSiteOrigin(env);
	if (!apiKey || !fromEmail || !siteOrigin) {
		return {
			mode: 'provider_required',
			failureCode: 'provider_not_configured',
			failureMessage: 'Invitation email provider is missing required server-side configuration.',
		};
	}

	const replyTo = normaliseEmail(env.WATCHTOWER_INVITATION_REPLY_TO);
	return {
		mode: 'resend',
		apiKey,
		from: `${formatDisplayName(fromName)} <${fromEmail}>`,
		replyTo: replyTo ?? undefined,
		siteOrigin,
	};
}

export async function sendWorkspaceInvitationEmail(request: WorkspaceInvitationEmailDeliveryRequest): Promise<InvitationDeliveryResult> {
	const recipientEmail = normaliseEmail(request.recipientEmail);
	if (!recipientEmail) {
		return deliveryFailure(request, 'recipient_email_missing', 'Invitation recipient email could not be resolved from trusted invitation data.');
	}

	const env = request.env ?? import.meta.env ?? {};
	const config = resolveInvitationProviderConfig(env);
	const acceptOrigin = config.mode === 'resend'
		? config.siteOrigin
		: request.requestOrigin ?? PRODUCTION_INVITATION_ORIGIN;
	const acceptUrl = buildWorkspaceInvitationAcceptPath(request.rawToken, acceptOrigin);
	const email = renderInvitationEmail({
		workspaceName: request.workspaceName,
		personName: request.personName,
		roleLabel: request.roleLabel,
		acceptUrl,
		expiresAt: request.expiresAt,
	});

	if (config.mode === 'test_record_only') {
		return {
			invitationId: request.invitationId,
			membershipId: request.membershipId,
			status: 'delivered',
			providerName: 'test_record_only',
			providerMessageId: `test_${request.invitationId}`,
		};
	}
	if (config.mode === 'provider_required') {
		return deliveryFailure(request, config.failureCode, config.failureMessage);
	}

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
					'X-Watchtower-Invitation-Id': request.invitationId,
				},
			}),
			signal: controller.signal,
		});
		clearTimeout(timeout);

		if (!response.ok) {
			return {
				...deliveryFailure(request, failureCodeForProviderStatus(response.status), safeProviderFailureMessage(response.status)),
				providerName: 'resend',
			};
		}

		const body = await safeJson(response);
		const providerMessageId = typeof body?.id === 'string' ? body.id : undefined;
		return {
			invitationId: request.invitationId,
			membershipId: request.membershipId,
			status: 'delivered',
			providerName: 'resend',
			providerMessageId,
		};
	} catch (error) {
		clearTimeout(timeout);
		const aborted = error instanceof Error && error.name === 'AbortError';
		return {
			...deliveryFailure(
				request,
				aborted ? 'provider_timeout' : 'provider_unavailable',
				aborted ? 'Invitation email provider timed out. Retry is available.' : 'Invitation email provider could not be reached. Retry is available.',
			),
			providerName: 'resend',
		};
	}
}

function deliveryFailure(request: WorkspaceInvitationEmailDeliveryRequest, failureCode: string, failureMessage: string): InvitationDeliveryResult {
	return {
		invitationId: request.invitationId,
		membershipId: request.membershipId,
		status: 'delivery_failed',
		failureCode,
		failureMessage,
	};
}

function normaliseEmail(value: unknown): string | null {
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

function failureCodeForProviderStatus(status: number): string {
	if (status === 401 || status === 403) return 'provider_auth_failed';
	if (status === 429) return 'provider_rate_limited';
	if (status >= 400 && status < 500) return 'provider_rejected';
	return 'provider_unavailable';
}

function safeProviderFailureMessage(status: number): string {
	if (status === 401 || status === 403) return 'Invitation email provider rejected the configured credentials. Retry after updating the server-side provider secret.';
	if (status === 429) return 'Invitation email provider rate limit was reached. Retry later.';
	if (status >= 400 && status < 500) return 'Invitation email provider rejected the message. Retry after checking server-side email configuration.';
	return 'Invitation email provider did not accept the message. Retry is available.';
}

async function safeJson(response: Response): Promise<Record<string, unknown> | null> {
	try {
		const parsed = await response.json();
		return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : null;
	} catch {
		return null;
	}
}
