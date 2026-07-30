import { safeSupabaseErrorDiagnostics } from './workspaceInvitationAuthProvisioning.ts';

export type WorkspaceInvitationAcceptanceLookupOutcome =
	| 'invalid'
	| 'expired'
	| 'cancelled'
	| 'superseded'
	| 'accepted'
	| 'failed';

export type WorkspaceInvitationAcceptanceLookupInfo = {
	invitation_id?: string | null;
	membership_id?: string | null;
	profile_id?: string | null;
	status?: string | null;
};

type LookupFailureLogInput = {
	routeName: string;
	currentInvitation?: WorkspaceInvitationAcceptanceLookupInfo | null;
	currentAuthUserId?: string | null;
	lookupOperationName: string;
	error: unknown;
	classifiedOutcome?: WorkspaceInvitationAcceptanceLookupOutcome;
};

function hardenLookupDiagnosticText(value: string | null | undefined) {
	if (!value) return value;
	return value
		.replace(/\btoken[_-]?hash\b\s*[:=]\s*[^\s,;]+/gi, '[redacted-token-hash]')
		.replace(/\btoken[_-]?hash\b/gi, '[redacted-token-hash]')
		.replace(/\[redacted-\[redacted-token-hash\]\]/gi, '[redacted-token-hash]')
		.replace(/\b(?:access|refresh)[_-]?token\b/gi, '[redacted-token]')
		.replace(/\bauth(?:entication)?\s+alias\b\s*[:=]\s*[^\s,;]+/gi, 'auth alias=[redacted]')
		.replace(/\bhttps?:\/\/[^\s]+/gi, '[redacted-url]');
}

function acceptanceLookupLogIds(currentInvitation: WorkspaceInvitationAcceptanceLookupInfo | null | undefined) {
	return {
		invitationId: currentInvitation?.invitation_id ?? null,
		membershipId: currentInvitation?.membership_id ?? null,
		profileId: currentInvitation?.profile_id ?? null,
	};
}

export function classifyWorkspaceInvitationAcceptanceLookupOutcome(
	error: unknown,
	currentInvitation?: WorkspaceInvitationAcceptanceLookupInfo | null,
): WorkspaceInvitationAcceptanceLookupOutcome {
	const currentStatus = currentInvitation?.status?.toLowerCase();
	if (currentStatus === 'expired') return 'expired';
	if (currentStatus === 'cancelled') return 'cancelled';
	if (currentStatus === 'superseded') return 'superseded';
	if (currentStatus === 'accepted') return 'accepted';

	const diagnostics = safeSupabaseErrorDiagnostics(error, 'Invitation lookup failed');
	const text = [
		diagnostics.supabaseErrorCode,
		diagnostics.safeErrorMessage,
		diagnostics.safeDetails,
		diagnostics.safeHint,
	].filter(Boolean).join(' ');

	if (/EXPIRED|INVITATION_EXPIRED|invite_expired/i.test(text)) return 'expired';
	if (/CANCELLED|CANCELED|INVITATION_CANCEL/i.test(text)) return 'cancelled';
	if (/SUPERSEDED|INVITATION_SUPERSEDED/i.test(text)) return 'superseded';
	if (/ACCEPTED|ALREADY_USED|already been used/i.test(text)) return 'accepted';
	if (/INVALID|NOT_FOUND|NOT_ACCEPTABLE|REPLAY|TOKEN_INVALID|TOKEN_REQUIRED|PGRST116/i.test(text)) return 'invalid';
	return 'failed';
}

export function buildWorkspaceInvitationAcceptanceLookupFailureLog(input: LookupFailureLogInput) {
	const diagnostics = safeSupabaseErrorDiagnostics(input.error, 'Invitation lookup failed');

	return {
		routeName: input.routeName,
		...acceptanceLookupLogIds(input.currentInvitation),
		currentAuthUserId: input.currentAuthUserId ?? null,
		lookupOperationName: input.lookupOperationName,
		supabaseErrorCode: hardenLookupDiagnosticText(diagnostics.supabaseErrorCode),
		safeErrorMessage: hardenLookupDiagnosticText(diagnostics.safeErrorMessage),
		safeDetails: hardenLookupDiagnosticText(diagnostics.safeDetails),
		safeHint: hardenLookupDiagnosticText(diagnostics.safeHint),
		classifiedOutcome: input.classifiedOutcome ?? classifyWorkspaceInvitationAcceptanceLookupOutcome(input.error, input.currentInvitation),
	};
}
