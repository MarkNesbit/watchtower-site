import type { APIRoute } from 'astro';
import { buildWorkspaceTeamPath, getWorkspaceBySlug } from '../../../../../../lib/projects.ts';
import { can, isWorkspaceRole } from '../../../../../../lib/permissions.ts';
import { createSupabaseServerClient, getServerAccessToken } from '../../../../../../lib/supabaseServer.ts';
import {
	WORKSPACE_TEAM_MEMBER_REACTIVATE_RPC,
	workspaceTeamReactivationErrorMessage,
} from '../../../../../../lib/workspaceTeam.ts';

function wantsJson(request: Request) {
	return request.headers.get('accept')?.includes('application/json');
}

function json(data: Record<string, unknown>, status = 200) {
	return new Response(JSON.stringify(data), {
		status,
		headers: {
			'content-type': 'application/json; charset=utf-8',
			'cache-control': 'private, no-store, no-cache, must-revalidate',
		},
	});
}

function redirect(workspaceSlug: string, state: 'success' | 'error', errorCode = '') {
	const query = new URLSearchParams({ member_reactivation: state });
	if (errorCode) query.set('member_reactivation_error', errorCode);
	return new Response(null, {
		status: 303,
		headers: {
			location: `${buildWorkspaceTeamPath(workspaceSlug)}?${query.toString()}`,
			'cache-control': 'private, no-store, no-cache, must-revalidate',
		},
	});
}

function reactivationErrorCode(error: unknown) {
	const message = typeof (error as { message?: unknown })?.message === 'string'
		? (error as { message: string }).message
		: '';
	if (message.includes('WT_MEMBER_REACTIVATION_STALE')) return 'stale';
	if (message.includes('WT_MEMBER_REACTIVATION_LOCKED')) return 'locked';
	if (message.includes('WT_MEMBER_REACTIVATION_SESSION')) return 'session';
	if (message.includes('WT_MEMBER_REACTIVATION_SELF_DENIED')) return 'self';
	if (message.includes('WT_MEMBER_REACTIVATION_ADMIN_TARGET_DENIED')) return 'admin_target';
	if (message.includes('WT_MEMBER_REACTIVATION_ADMIN_ASSIGN_DENIED')) return 'admin_assign';
	if (message.includes('WT_MEMBER_REACTIVATION_INVALID_TARGET')) return 'invalid';
	if (message.includes('WT_MEMBER_REACTIVATION_REASON_REQUIRED')) return 'reason_required';
	if (message.includes('WT_MEMBER_REACTIVATION_REASON_TOO_LONG')) return 'reason_too_long';
	if (message.includes('WT_MEMBER_REACTIVATION_DEACTIVATED_ONLY')) return 'deactivated_only';
	if (message.includes('WT_MEMBER_REACTIVATION_ACCEPTED_ONLY')) return 'accepted_only';
	if (message.includes('WT_MEMBER_REACTIVATION_AUTH_IDENTITY_MISSING')) return 'identity_missing';
	if (message.includes('WT_MEMBER_REACTIVATION_PREVIOUS_ROLE_UNAVAILABLE')) return 'previous_role';
	if (message.includes('WT_MEMBERSHIP_PERMISSION_DENIED')) return 'permission';
	return 'failed';
}

export const POST: APIRoute = async ({ cookies, params, request }) => {
	const jsonResponse = wantsJson(request);
	const workspaceSlug = params.workspaceSlug ?? '';
	const accessToken = getServerAccessToken(cookies);
	if (!accessToken) {
		return jsonResponse
			? json({ success: false, message: 'Sign in before reactivating workspace members.' }, 401)
			: redirect(workspaceSlug, 'error', 'signin');
	}

	const serverSupabase = createSupabaseServerClient(accessToken);
	const workspace = await getWorkspaceBySlug(serverSupabase, workspaceSlug, accessToken);
	const organisation = Array.isArray(workspace?.organisations) ? workspace?.organisations[0] : workspace?.organisations;
	if (!workspace || !organisation || !isWorkspaceRole(workspace.role)) {
		return jsonResponse
			? json({ success: false, message: 'Workspace access could not be confirmed for member reactivation.' }, 404)
			: redirect(workspaceSlug, 'error', 'workspace');
	}
	if (!can(workspace.role, 'workspaceTeam.manageRoles')) {
		return jsonResponse
			? json({ success: false, message: 'Only active Workspace Owners and Admins can reactivate workspace members.' }, 403)
			: redirect(workspaceSlug, 'error', 'permission');
	}

	const formData = await request.formData();
	const membershipId = String(formData.get('membership_id') ?? '').trim();
	const expectedSnapshotVersion = String(formData.get('expected_snapshot_version') ?? '').trim();
	const editSessionId = String(formData.get('edit_session_id') ?? '').trim() || null;
	const targetRole = String(formData.get('reactivation_target_role') ?? formData.get('target_role') ?? '').trim().toLowerCase();
	const deactivatedInError = String(formData.get('deactivated_in_error') ?? '') === 'on';
	const reason = String(formData.get('reactivation_reason') ?? '');
	if (!membershipId || !expectedSnapshotVersion || !editSessionId) {
		return jsonResponse
			? json({ success: false, message: 'The reactivation request was incomplete.' }, 400)
			: redirect(workspaceSlug, 'error', 'invalid');
	}

	const { error } = await serverSupabase.rpc(WORKSPACE_TEAM_MEMBER_REACTIVATE_RPC, {
		p_organisation_id: organisation.id,
		p_membership_id: membershipId,
		p_expected_snapshot_version: expectedSnapshotVersion,
		p_edit_session_id: editSessionId,
		p_target_role: targetRole || null,
		p_deactivated_in_error: deactivatedInError,
		p_reason: reason,
	});
	if (error) {
		const message = workspaceTeamReactivationErrorMessage(error);
		return jsonResponse
			? json({ success: false, message }, 400)
			: redirect(workspaceSlug, 'error', reactivationErrorCode(error));
	}

	return jsonResponse
		? json({ success: true, message: 'Workspace member reactivated.' })
		: redirect(workspaceSlug, 'success');
};

export const GET: APIRoute = async () => new Response('Member reactivation requires a confirmed POST request.', {
	status: 405,
	headers: {
		'content-type': 'text/plain; charset=utf-8',
		'cache-control': 'private, no-store, no-cache, must-revalidate',
	},
});
