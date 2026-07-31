import type { APIRoute } from 'astro';
import { getWorkspaceBySlug } from '../../../../../../lib/projects.ts';
import { can, isWorkspaceRole } from '../../../../../../lib/permissions.ts';
import { createSupabaseServerClient, getServerAccessToken } from '../../../../../../lib/supabaseServer.ts';
import {
	WORKSPACE_TEAM_MEMBER_DEACTIVATION_IMPACT_RPC,
	workspaceTeamDeactivationErrorMessage,
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

export const POST: APIRoute = async ({ cookies, params, request }) => {
	const accessToken = getServerAccessToken(cookies);
	if (!accessToken) return json({ success: false, message: 'Sign in before reviewing member deactivation impact.' }, 401);

	const workspaceSlug = params.workspaceSlug ?? '';
	const serverSupabase = createSupabaseServerClient(accessToken);
	const workspace = await getWorkspaceBySlug(serverSupabase, workspaceSlug, accessToken);
	const organisation = Array.isArray(workspace?.organisations) ? workspace?.organisations[0] : workspace?.organisations;
	if (!workspace || !organisation || !isWorkspaceRole(workspace.role)) {
		return json({ success: false, message: 'Workspace access could not be confirmed for member deactivation.' }, 404);
	}
	if (!can(workspace.role, 'workspaceTeam.manageRoles')) {
		return json({ success: false, message: 'Only active Workspace Owners and Admins can deactivate workspace members.' }, 403);
	}

	const formData = await request.formData();
	const membershipId = String(formData.get('membership_id') ?? '').trim();
	if (!membershipId) return json({ success: false, message: 'Member could not be identified.' }, 400);

	const { data, error } = await serverSupabase.rpc(WORKSPACE_TEAM_MEMBER_DEACTIVATION_IMPACT_RPC, {
		p_organisation_id: organisation.id,
		p_membership_id: membershipId,
	});
	if (error) {
		return json({ success: false, message: workspaceTeamDeactivationErrorMessage(error) }, 400);
	}

	return json({
		success: true,
		impact: data ?? {},
	});
};

export const GET: APIRoute = async () => json({
	success: false,
	message: 'Member deactivation impact review requires a confirmed POST request.',
}, 405);
