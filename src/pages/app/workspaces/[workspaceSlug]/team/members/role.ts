import type { APIRoute } from 'astro';
import { buildWorkspaceTeamPath, getWorkspaceBySlug } from '../../../../../../lib/projects.ts';
import { can, isWorkspaceRole } from '../../../../../../lib/permissions.ts';
import { createSupabaseServerClient, getServerAccessToken } from '../../../../../../lib/supabaseServer.ts';
import {
	WORKSPACE_TEAM_MEMBER_ROLE_CHANGE_RPC,
	workspaceTeamRoleChangeErrorMessage,
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
	const query = new URLSearchParams({ member_role: state });
	if (errorCode) query.set('member_role_error', errorCode);
	return new Response(null, {
		status: 303,
		headers: {
			location: `${buildWorkspaceTeamPath(workspaceSlug)}?${query.toString()}`,
			'cache-control': 'private, no-store, no-cache, must-revalidate',
		},
	});
}

function roleErrorCode(error: unknown) {
	const message = typeof (error as { message?: unknown })?.message === 'string'
		? (error as { message: string }).message
		: '';
	if (message.includes('WT_MEMBER_ROLE_STALE')) return 'stale';
	if (message.includes('WT_MEMBER_ROLE_LOCKED')) return 'locked';
	if (message.includes('WT_MEMBER_ROLE_SESSION')) return 'session';
	if (message.includes('WT_MEMBER_ROLE_SELF_DENIED')) return 'self';
	if (message.includes('WT_MEMBER_ROLE_INVALID_TARGET')) return 'invalid';
	if (message.includes('WT_MEMBER_ROLE_ACTIVE_ONLY')) return 'active_only';
	if (message.includes('WT_MEMBERSHIP_PERMISSION_DENIED')) return 'permission';
	return 'failed';
}

export const POST: APIRoute = async ({ cookies, locals, params, request }) => {
	const jsonResponse = wantsJson(request);
	const workspaceSlug = params.workspaceSlug ?? '';
	const accessToken = getServerAccessToken(cookies);
	if (!accessToken) {
		return jsonResponse
			? json({ success: false, message: 'Sign in before changing workspace roles.' }, 401)
			: redirect(workspaceSlug, 'error', 'signin');
	}

	const runtimeEnv = (locals as { runtime?: { env?: Record<string, unknown> } }).runtime?.env;
	const serverSupabase = createSupabaseServerClient(accessToken, runtimeEnv);
	const workspace = await getWorkspaceBySlug(serverSupabase, workspaceSlug, accessToken);
	const organisation = Array.isArray(workspace?.organisations) ? workspace?.organisations[0] : workspace?.organisations;
	if (!workspace || !organisation || !isWorkspaceRole(workspace.role)) {
		return jsonResponse
			? json({ success: false, message: 'Workspace access could not be confirmed for role management.' }, 404)
			: redirect(workspaceSlug, 'error', 'workspace');
	}
	if (!can(workspace.role, 'workspaceTeam.manageRoles')) {
		return jsonResponse
			? json({ success: false, message: 'Only active Workspace Owners and Admins can change workspace roles.' }, 403)
			: redirect(workspaceSlug, 'error', 'permission');
	}

	const formData = await request.formData();
	const membershipId = String(formData.get('membership_id') ?? '').trim();
	const targetRole = String(formData.get('target_role') ?? '').trim();
	const expectedSnapshotVersion = String(formData.get('expected_snapshot_version') ?? '').trim();
	const editSessionId = String(formData.get('edit_session_id') ?? '').trim() || null;
	if (!membershipId || !targetRole || !expectedSnapshotVersion) {
		return jsonResponse
			? json({ success: false, message: 'The role change request was incomplete.' }, 400)
			: redirect(workspaceSlug, 'error', 'invalid');
	}

	const { error } = await serverSupabase.rpc(WORKSPACE_TEAM_MEMBER_ROLE_CHANGE_RPC, {
		p_organisation_id: organisation.id,
		p_membership_id: membershipId,
		p_target_role: targetRole,
		p_expected_snapshot_version: expectedSnapshotVersion,
		p_edit_session_id: editSessionId,
	});
	if (error) {
		const message = workspaceTeamRoleChangeErrorMessage(error);
		return jsonResponse
			? json({ success: false, message }, 400)
			: redirect(workspaceSlug, 'error', roleErrorCode(error));
	}

	return jsonResponse
		? json({ success: true, message: 'Workspace role updated.' })
		: redirect(workspaceSlug, 'success');
};

export const GET: APIRoute = async () => new Response('Workspace role changes require a confirmed POST request.', {
	status: 405,
	headers: {
		'content-type': 'text/plain; charset=utf-8',
		'cache-control': 'private, no-store, no-cache, must-revalidate',
	},
});
