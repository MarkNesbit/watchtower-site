import { authenticatedUserDisplayName, AUTHENTICATED_USER_DISPLAY_FALLBACK } from './authenticatedUserDisplay.ts';
import { getCurrentWorkspace } from './projects.ts';

export const AUTHENTICATED_DASHBOARD_WORKSPACE_FALLBACK = 'Workspace unavailable';

type DashboardDirectoryRow = {
	organisation_id?: string | null;
	organisation_membership_id?: string | null;
	profile_id?: string | null;
	auth_user_id?: string | null;
	first_name?: string | null;
	last_name?: string | null;
	display_name?: string | null;
	login_name?: string | null;
	membership_status?: string | null;
};

type SupabaseError = {
	code?: string | null;
	message?: string | null;
	details?: string | null;
	hint?: string | null;
};

export type AuthenticatedDashboardContext = {
	personName: string;
	workspaceName: string;
	signedInAuthUserId: string | null;
	resolvedWorkspaceId: string | null;
	activeMembershipCount: number | null;
	directoryRowFound: boolean;
	personFallbackUsed: boolean;
	workspaceFallbackUsed: boolean;
};

function cleanDashboardText(value: unknown): string {
	return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
}

function getMembershipOrganisation(membership: unknown): { id?: string | null; name?: string | null } | null {
	if (!membership || typeof membership !== 'object') return null;
	const organisations = (membership as { organisations?: unknown }).organisations;
	if (Array.isArray(organisations)) return organisations[0] as { id?: string | null; name?: string | null } | null;
	return organisations as { id?: string | null; name?: string | null } | null;
}

function safeDiagnosticText(value: unknown): string | null {
	if (typeof value !== 'string') return null;
	const redacted = value
		.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[redacted-email]')
		.replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[redacted-token]')
		.replace(/\b[a-f0-9]{32,}\b/gi, '[redacted-secret]')
		.replace(/(password|token|secret|key)\s*[:=]\s*\S+/gi, '$1=[redacted]');
	return redacted.slice(0, 240);
}

function logProfileResolutionFailure(details: {
	signedInAuthUserId: string | null;
	resolvedWorkspaceId: string | null;
	activeMembershipCount: number | null;
	directoryRowFound: boolean;
	fallbackUsed: boolean;
	error?: SupabaseError | null;
}) {
	console.warn('authenticated_user_profile_resolution_failed', {
		routeName: 'authenticated_dashboard',
		signedInAuthUserId: details.signedInAuthUserId,
		resolvedWorkspaceId: details.resolvedWorkspaceId,
		activeMembershipCount: details.activeMembershipCount,
		directoryRowFound: details.directoryRowFound,
		fallbackUsed: details.fallbackUsed,
		safeErrorCode: details.error?.code ?? null,
		safeErrorMessage: safeDiagnosticText(details.error?.message),
	});
}

function logWorkspaceResolutionFailure(details: {
	signedInAuthUserId: string | null;
	resolvedWorkspaceId: string | null;
	fallbackUsed: boolean;
	error?: SupabaseError | null;
}) {
	console.warn('authenticated_dashboard_workspace_resolution_failed', {
		routeName: 'authenticated_dashboard',
		signedInAuthUserId: details.signedInAuthUserId,
		resolvedWorkspaceId: details.resolvedWorkspaceId,
		fallbackUsed: details.fallbackUsed,
		safeErrorCode: details.error?.code ?? null,
		safeErrorMessage: safeDiagnosticText(details.error?.message),
	});
}

function emptyDashboardContext(overrides: Partial<AuthenticatedDashboardContext> = {}): AuthenticatedDashboardContext {
	return {
		personName: AUTHENTICATED_USER_DISPLAY_FALLBACK,
		workspaceName: AUTHENTICATED_DASHBOARD_WORKSPACE_FALLBACK,
		signedInAuthUserId: null,
		resolvedWorkspaceId: null,
		activeMembershipCount: null,
		directoryRowFound: false,
		personFallbackUsed: true,
		workspaceFallbackUsed: true,
		...overrides,
	};
}

export async function loadAuthenticatedDashboardContext(client, accessToken?: string): Promise<AuthenticatedDashboardContext> {
	let userResult;
	try {
		userResult = accessToken
			? await client.auth.getUser(accessToken)
			: await client.auth.getUser();
	} catch (error) {
		logProfileResolutionFailure({
			signedInAuthUserId: null,
			resolvedWorkspaceId: null,
			activeMembershipCount: null,
			directoryRowFound: false,
			fallbackUsed: true,
			error: error as SupabaseError,
		});
		return emptyDashboardContext();
	}
	const { data: userData, error: userError } = userResult;
	if (userError) {
		logProfileResolutionFailure({
			signedInAuthUserId: null,
			resolvedWorkspaceId: null,
			activeMembershipCount: null,
			directoryRowFound: false,
			fallbackUsed: true,
			error: userError,
		});
		return emptyDashboardContext();
	}
	const signedInAuthUserId = userData.user?.id ?? null;
	if (!signedInAuthUserId) return emptyDashboardContext();

	let workspace;
	try {
		workspace = await getCurrentWorkspace(client, accessToken);
	} catch (error) {
		logWorkspaceResolutionFailure({
			signedInAuthUserId,
			resolvedWorkspaceId: null,
			fallbackUsed: true,
			error: error as SupabaseError,
		});
		return emptyDashboardContext({ signedInAuthUserId });
	}
	const organisation = getMembershipOrganisation(workspace);
	const resolvedWorkspaceId = organisation?.id ?? null;
	const workspaceName = cleanDashboardText(organisation?.name) || AUTHENTICATED_DASHBOARD_WORKSPACE_FALLBACK;
	const workspaceFallbackUsed = workspaceName === AUTHENTICATED_DASHBOARD_WORKSPACE_FALLBACK;
	if (workspaceFallbackUsed) {
		logWorkspaceResolutionFailure({
			signedInAuthUserId,
			resolvedWorkspaceId,
			fallbackUsed: true,
		});
	}

	if (!resolvedWorkspaceId) {
		logProfileResolutionFailure({
			signedInAuthUserId,
			resolvedWorkspaceId,
			activeMembershipCount: null,
			directoryRowFound: false,
			fallbackUsed: true,
		});
		return emptyDashboardContext({
			signedInAuthUserId,
			workspaceName,
			resolvedWorkspaceId,
			workspaceFallbackUsed,
		});
	}

	let directoryResult;
	try {
		directoryResult = await client
			.from('workspace_member_directory')
			.select('organisation_id, organisation_membership_id, profile_id, auth_user_id, first_name, last_name, display_name, login_name, membership_status')
			.eq('organisation_id', resolvedWorkspaceId)
			.eq('auth_user_id', signedInAuthUserId)
			.eq('membership_status', 'active')
			.limit(2);
	} catch (error) {
		logProfileResolutionFailure({
			signedInAuthUserId,
			resolvedWorkspaceId,
			activeMembershipCount: null,
			directoryRowFound: false,
			fallbackUsed: true,
			error: error as SupabaseError,
		});
		return emptyDashboardContext({
			signedInAuthUserId,
			workspaceName,
			resolvedWorkspaceId,
			workspaceFallbackUsed,
		});
	}
	const { data, error } = directoryResult;

	const activeMembershipCount = data?.length ?? 0;
	const directoryRowFound = !error && activeMembershipCount === 1;
	const row = directoryRowFound ? data[0] as DashboardDirectoryRow : null;
	const personName = authenticatedUserDisplayName(row);
	const personFallbackUsed = personName === AUTHENTICATED_USER_DISPLAY_FALLBACK;

	if (error || !directoryRowFound || personFallbackUsed) {
		logProfileResolutionFailure({
			signedInAuthUserId,
			resolvedWorkspaceId,
			activeMembershipCount,
			directoryRowFound,
			fallbackUsed: true,
			error,
		});
	}

	return {
		personName,
		workspaceName,
		signedInAuthUserId,
		resolvedWorkspaceId,
		activeMembershipCount,
		directoryRowFound,
		personFallbackUsed,
		workspaceFallbackUsed,
	};
}
