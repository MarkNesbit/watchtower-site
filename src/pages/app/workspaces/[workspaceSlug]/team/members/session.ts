import type { APIRoute } from 'astro';
import { getWorkspaceBySlug } from '../../../../../../lib/projects.ts';
import { can, isWorkspaceRole } from '../../../../../../lib/permissions.ts';
import { createSupabaseServerClient, getServerAccessToken } from '../../../../../../lib/supabaseServer.ts';
import {
	WORKSPACE_TEAM_MEMBER_SESSION_RELEASE_RPC,
	WORKSPACE_TEAM_MEMBER_SESSION_RPC,
} from '../../../../../../lib/workspaceTeam.ts';

function json(data: Record<string, unknown>, status = 200) {
	return new Response(JSON.stringify(data), {
		status,
		headers: {
			'content-type': 'application/json; charset=utf-8',
			'cache-control': 'private, no-store, no-cache, must-revalidate',
		},
	});
}

function errorMessage(error: unknown) {
	const message = typeof (error as { message?: unknown })?.message === 'string'
		? (error as { message: string }).message
		: '';
	const details = typeof (error as { details?: unknown })?.details === 'string'
		? (error as { details: string }).details
		: '';
	const hint = typeof (error as { hint?: unknown })?.hint === 'string'
		? (error as { hint: string }).hint
		: '';
	const diagnostic = `${message} ${details} ${hint}`;
	if (message.includes('WT_MEMBERSHIP_PERMISSION_DENIED')) return 'Only active Workspace Owners and Admins can manage workspace roles.';
	if (message.includes('WT_MEMBER_ROLE_ACTIVE_ONLY')) return 'Only active workspace members can be opened for role management.';
	if (
		diagnostic.includes('start_workspace_member_edit_session')
		|| diagnostic.includes('workspace_member_edit_sessions')
		|| diagnostic.includes('Could not find the function')
		|| diagnostic.includes('schema cache')
		|| diagnostic.includes('does not exist')
	) {
		return 'Workspace role editing is not ready yet. Apply the latest Workspace Team database migration, then reopen this member.';
	}
	return 'Member edit availability could not be checked.';
}

export const POST: APIRoute = async ({ cookies, params, request }) => {
	const accessToken = getServerAccessToken(cookies);
	if (!accessToken) return json({ success: false, message: 'Sign in before opening member details.' }, 401);

	const workspaceSlug = params.workspaceSlug ?? '';
	const serverSupabase = createSupabaseServerClient(accessToken);
	const workspace = await getWorkspaceBySlug(serverSupabase, workspaceSlug, accessToken);
	const organisation = Array.isArray(workspace?.organisations) ? workspace?.organisations[0] : workspace?.organisations;
	if (!workspace || !organisation || !isWorkspaceRole(workspace.role)) {
		return json({ success: false, message: 'Workspace access could not be confirmed.' }, 404);
	}
	if (!can(workspace.role, 'workspaceTeam.manageRoles')) {
		return json({ success: false, message: 'Only active Workspace Owners and Admins can manage workspace roles.' }, 403);
	}

	const formData = await request.formData();
	const sessionAction = String(formData.get('session_action') ?? 'start');
	if (sessionAction === 'release') {
		const sessionId = String(formData.get('session_id') ?? '').trim();
		if (!sessionId) return json({ success: true, released: false });
		const releaseSource = String(formData.get('release_source') ?? 'modal_closed').trim() || 'modal_closed';
		const { error } = await serverSupabase.rpc(WORKSPACE_TEAM_MEMBER_SESSION_RELEASE_RPC, {
			p_organisation_id: organisation.id,
			p_session_id: sessionId,
			p_release_source: releaseSource,
		});
		if (error) return json({ success: false, message: 'Member edit session could not be released.' }, 400);
		return json({ success: true, released: true });
	}

	const membershipId = String(formData.get('membership_id') ?? '').trim();
	if (!membershipId) return json({ success: false, message: 'Member could not be identified.' }, 400);

	const { data, error } = await serverSupabase.rpc(WORKSPACE_TEAM_MEMBER_SESSION_RPC, {
		p_organisation_id: organisation.id,
		p_membership_id: membershipId,
	});
	if (error) return json({ success: false, message: errorMessage(error) }, 400);

	const result = Array.isArray(data) ? data[0] : data;
	return json({
		success: true,
		can_edit: Boolean(result?.can_edit),
		session_id: result?.session_id ?? null,
		expires_at: result?.expires_at ?? null,
		message: result?.message ?? (result?.can_edit ? 'You can edit this member role.' : 'This member is read-only.'),
		locked_by_display_name: result?.locked_by_display_name ?? null,
	});
};

export const GET: APIRoute = async () => json({
	success: false,
	message: 'Member edit sessions require a confirmed POST request.',
}, 405);
