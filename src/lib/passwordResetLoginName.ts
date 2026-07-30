import { normaliseLoginNameInput, safeLoginDiagnostic } from './loginNameAuth.ts';
import { normalisePasswordResetEmail } from './passwordResetDelivery.ts';

export type PasswordResetResolutionStatus =
	| 'resolved'
	| 'malformed_login_name'
	| 'profile_not_found'
	| 'ambiguous_login_name'
	| 'auth_identity_missing'
	| 'auth_account_invalid'
	| 'no_active_membership'
	| 'missing_delivery_address';

export type PasswordResetResolutionSuccess = {
	status: 'resolved';
	authUserId: string;
	authEmail: string;
	profileId: string;
	contactEmail: string;
	activeMembershipCount: number;
};

export type PasswordResetResolutionFailure = {
	status: Exclude<PasswordResetResolutionStatus, 'resolved'>;
	profileFound?: boolean;
	candidateCount?: number;
	activeMembershipCount?: number;
	authUserLinked?: boolean;
	profileId?: string;
	authUserId?: string;
};

export type PasswordResetResolutionResult = PasswordResetResolutionSuccess | PasswordResetResolutionFailure;

type ProfileRow = {
	id?: string | null;
	auth_user_id?: string | null;
	contact_email?: string | null;
};

type AuthUser = {
	id?: string | null;
	email?: string | null;
};

const PASSWORD_RESET_RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;
const PASSWORD_RESET_RATE_LIMIT_MAX_REQUESTS = 3;
const resetAttempts = new Map<string, number[]>();

async function loadActiveMembershipCount(adminClient, authUserId: string) {
	const { data, error } = await adminClient
		.from('organisation_members')
		.select('id')
		.eq('status', 'active')
		.or(`auth_user_id.eq.${authUserId},and(auth_user_id.is.null,user_id.eq.${authUserId})`)
		.limit(2);

	if (error) throw error;
	return data?.length ?? 0;
}

export async function resolvePasswordResetLoginName(adminClient, rawLoginName: unknown): Promise<PasswordResetResolutionResult> {
	const loginName = normaliseLoginNameInput(rawLoginName);
	if (!loginName) return { status: 'malformed_login_name', profileFound: false };

	const { data: profiles, error: profileError } = await adminClient
		.from('profiles')
		.select('id, auth_user_id, contact_email')
		.eq('login_name', loginName)
		.limit(2);

	if (profileError) throw profileError;
	const candidateCount = profiles?.length ?? 0;
	if (candidateCount === 0) return { status: 'profile_not_found', profileFound: false, candidateCount };
	if (candidateCount !== 1) return { status: 'ambiguous_login_name', profileFound: true, candidateCount };

	const profile = profiles[0] as ProfileRow;
	if (!profile.id || !profile.auth_user_id) {
		return {
			status: 'auth_identity_missing',
			profileFound: true,
			candidateCount,
			authUserLinked: false,
			profileId: profile.id ?? undefined,
		};
	}

	const activeMembershipCount = await loadActiveMembershipCount(adminClient, profile.auth_user_id);
	if (activeMembershipCount < 1) {
		return {
			status: 'no_active_membership',
			profileFound: true,
			candidateCount,
			activeMembershipCount,
			authUserLinked: true,
			profileId: profile.id,
			authUserId: profile.auth_user_id,
		};
	}

	const contactEmail = normalisePasswordResetEmail(profile.contact_email);
	if (!contactEmail) {
		return {
			status: 'missing_delivery_address',
			profileFound: true,
			candidateCount,
			activeMembershipCount,
			authUserLinked: true,
			profileId: profile.id,
			authUserId: profile.auth_user_id,
		};
	}

	const { data: authUserData, error: authUserError } = await adminClient.auth.admin.getUserById(profile.auth_user_id);
	const authUser = authUserData?.user as AuthUser | undefined;
	const authEmail = normalisePasswordResetEmail(authUser?.email);
	if (authUserError || authUser?.id !== profile.auth_user_id || !authEmail) {
		return {
			status: 'auth_account_invalid',
			profileFound: true,
			candidateCount,
			activeMembershipCount,
			authUserLinked: true,
			profileId: profile.id,
			authUserId: profile.auth_user_id,
		};
	}

	return {
		status: 'resolved',
		authUserId: profile.auth_user_id,
		authEmail,
		profileId: profile.id,
		contactEmail,
		activeMembershipCount,
	};
}

export function passwordResetDiagnostic(details: PasswordResetResolutionResult | { status: string }) {
	return {
		...safeLoginDiagnostic(details),
		profileFound: 'profileFound' in details ? details.profileFound ?? null : details.status === 'resolved' ? true : null,
		authUserLinked: 'authUserLinked' in details ? details.authUserLinked ?? null : details.status === 'resolved' ? true : null,
	};
}

export function passwordResetAuditPayload(input: {
	outcome: string;
	deliveryPath?: string;
	activeMembershipCount?: number | null;
}) {
	return {
		routeName: 'forgot_password',
		outcome: input.outcome,
		delivery_path: input.deliveryPath ?? null,
		active_membership_count: input.activeMembershipCount ?? null,
	};
}

export async function passwordResetRateLimitKey(rawLoginName: unknown, request: Request): Promise<string> {
	const loginName = normaliseLoginNameInput(rawLoginName) ?? 'malformed';
	const source = String(request.headers.get('cf-connecting-ip') ?? request.headers.get('x-forwarded-for') ?? 'unknown')
		.split(',')[0]
		.trim()
		.toLowerCase() || 'unknown';
	const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${source}:${loginName}`));
	return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function isPasswordResetRateLimited(key: string, now = Date.now()) {
	const windowStart = now - PASSWORD_RESET_RATE_LIMIT_WINDOW_MS;
	const attempts = (resetAttempts.get(key) ?? []).filter((attempt) => attempt >= windowStart);
	if (attempts.length >= PASSWORD_RESET_RATE_LIMIT_MAX_REQUESTS) {
		resetAttempts.set(key, attempts);
		return true;
	}
	attempts.push(now);
	resetAttempts.set(key, attempts);
	return false;
}

export function clearPasswordResetRateLimitState() {
	resetAttempts.clear();
}
