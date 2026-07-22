export const WORKSPACE_TEAM_CHECKOUT_RELEASE_RPC = 'release_workspace_membership_csv_checkout';
export const WORKSPACE_TEAM_CHECKOUT_RELEASE_ROUTE = 'workspace_team_checkout_release';

export type WorkspaceTeamCheckoutReleaseError = {
	code?: string | null;
	message?: string | null;
	details?: string | null;
	hint?: string | null;
};

export type WorkspaceTeamCheckoutReleaseExportState = {
	requested_by?: string | null;
	export_mode?: string | null;
	status?: string | null;
	editing_mode?: string | null;
	checkout_expires_at?: string | null;
	superseded_at?: string | null;
	released_at?: string | null;
};

export type WorkspaceTeamCheckoutReleaseErrorCode =
	| 'not_holder'
	| 'already_released'
	| 'expired'
	| 'superseded'
	| 'no_active_checkout'
	| 'permission_denied'
	| 'audit_failed'
	| 'rpc_failed'
	| 'stale'
	| 'failed';

export function workspaceTeamCheckoutReleaseStateErrorCode(
	exportState: WorkspaceTeamCheckoutReleaseExportState | null | undefined,
	actorId: string | null | undefined,
	now = new Date(),
): WorkspaceTeamCheckoutReleaseErrorCode | null {
	if (!exportState) return 'no_active_checkout';
	if (exportState.released_at || exportState.status === 'released') return 'already_released';
	if (exportState.superseded_at || exportState.status === 'superseded') return 'superseded';
	if (!exportState.checkout_expires_at) return 'no_active_checkout';
	const checkoutExpiry = new Date(exportState.checkout_expires_at).getTime();
	if (Number.isNaN(checkoutExpiry)) return 'no_active_checkout';
	if (checkoutExpiry <= now.getTime()) return 'expired';
	if (
		exportState.export_mode !== 'editable' ||
		exportState.status !== 'checked_out' ||
		exportState.editing_mode !== 'checked_out'
	) return 'no_active_checkout';
	if (actorId && exportState.requested_by && exportState.requested_by !== actorId) return 'not_holder';
	return null;
}

export function workspaceTeamCheckoutReleaseErrorCode(
	error: WorkspaceTeamCheckoutReleaseError | null | undefined,
	stateErrorCode: WorkspaceTeamCheckoutReleaseErrorCode | null = null,
): WorkspaceTeamCheckoutReleaseErrorCode {
	const text = [
		error?.code,
		error?.message,
		error?.details,
		error?.hint,
	]
		.filter(Boolean)
		.join(' ');

	if (/WT_MEMBERSHIP_EXPORT_RELEASE_HOLDER_ONLY/.test(text)) return 'not_holder';
	if (/WT_MEMBERSHIP_EXPORT_RELEASE_ALREADY_RELEASED/.test(text)) return 'already_released';
	if (/WT_MEMBERSHIP_EXPORT_RELEASE_EXPIRED/.test(text)) return 'expired';
	if (/WT_MEMBERSHIP_EXPORT_RELEASE_SUPERSEDED/.test(text)) return 'superseded';
	if (/WT_MEMBERSHIP_EXPORT_RELEASE_NOT_FOUND|WT_MEMBERSHIP_EXPORT_RELEASE_NO_ACTIVE_CHECKOUT|WT_MEMBERSHIP_EXPORT_RELEASE_NOT_ACTIVE/.test(text)) {
		return stateErrorCode ?? 'no_active_checkout';
	}
	if (/WT_MEMBERSHIP_PERMISSION_DENIED/.test(text)) return 'permission_denied';
	if (/WT_MEMBERSHIP_EXPORT_RELEASE_AUDIT_FAILED|workspace_membership_audit_events_.*check/.test(text)) return 'audit_failed';
	if (/WT_MEMBERSHIP_EXPORT_RELEASE_RACE/.test(text)) return 'stale';
	if (/PGRST202|Could not find function|schema cache|function .* does not exist/i.test(text)) return 'rpc_failed';
	return stateErrorCode ?? 'failed';
}

export function logWorkspaceTeamCheckoutReleaseFailure(details: {
	workspaceId: string;
	workspaceSlug: string;
	exportId: string;
	actorId: string | null;
	error: WorkspaceTeamCheckoutReleaseError;
}) {
	console.error('workspace_team_checkout_release_failed', {
		routeName: WORKSPACE_TEAM_CHECKOUT_RELEASE_ROUTE,
		workspaceId: details.workspaceId,
		workspaceSlug: details.workspaceSlug,
		exportId: details.exportId,
		actorId: details.actorId,
		rpcName: WORKSPACE_TEAM_CHECKOUT_RELEASE_RPC,
		code: details.error.code ?? null,
		message: details.error.message ?? null,
		details: details.error.details ?? null,
		hint: details.error.hint ?? null,
	});
}
