import type { APIRoute } from 'astro';
import { buildWorkspaceTeamPath, getWorkspaceBySlug } from '../../../../../../lib/projects.ts';
import { isWorkspaceRole } from '../../../../../../lib/permissions.ts';
import { createSupabaseServerClient, getServerAccessToken } from '../../../../../../lib/supabaseServer.ts';
import {
	WORKSPACE_TEAM_CHECKOUT_RELEASE_RPC,
	logWorkspaceTeamCheckoutReleaseFailure,
	workspaceTeamCheckoutReleaseErrorCode,
	workspaceTeamCheckoutReleaseStateErrorCode,
	type WorkspaceTeamCheckoutReleaseExportState,
} from '../../../../../../lib/workspaceTeamCheckoutRelease.ts';

function teamRedirect(workspaceSlug: string, params: Record<string, string>) {
	const query = new URLSearchParams(params);
	return new Response(null, {
		status: 303,
		headers: {
			location: `${buildWorkspaceTeamPath(workspaceSlug)}?${query.toString()}`,
			'cache-control': 'private, no-store, no-cache, must-revalidate',
		},
	});
}

export const POST: APIRoute = async ({ cookies, params, request }) => {
	const workspaceSlug = params.workspaceSlug ?? '';
	const accessToken = getServerAccessToken(cookies);
	if (!accessToken) return teamRedirect(workspaceSlug, { checkout_release: 'error', checkout_release_error: 'signin' });

	const serverSupabase = createSupabaseServerClient(accessToken);
	const workspace = await getWorkspaceBySlug(serverSupabase, workspaceSlug, accessToken);
	const organisation = Array.isArray(workspace?.organisations) ? workspace?.organisations[0] : workspace?.organisations;
	if (!workspace || !organisation || !isWorkspaceRole(workspace.role)) {
		return teamRedirect(workspaceSlug, { checkout_release: 'error', checkout_release_error: 'workspace' });
	}
	if (workspace.role !== 'owner' && workspace.role !== 'admin') {
		return teamRedirect(workspaceSlug, { checkout_release: 'error', checkout_release_error: 'permission' });
	}

	const formData = await request.formData();
	const exportId = String(formData.get('export_id') ?? '').trim();
	if (!exportId) return teamRedirect(workspaceSlug, { checkout_release: 'error', checkout_release_error: 'missing_export' });

	const { data: actorData } = await serverSupabase.auth.getUser(accessToken);
	const actorId = actorData.user?.id ?? null;
	const { data: exportState } = await serverSupabase
		.from('workspace_membership_export_runs')
		.select('requested_by, export_mode, status, editing_mode, checkout_expires_at, superseded_at, released_at')
		.eq('organisation_id', organisation.id)
		.eq('id', exportId)
		.maybeSingle();
	const stateErrorCode = workspaceTeamCheckoutReleaseStateErrorCode(
		exportState as WorkspaceTeamCheckoutReleaseExportState | null,
		actorId,
	);

	const { error } = await serverSupabase.rpc(WORKSPACE_TEAM_CHECKOUT_RELEASE_RPC, {
		p_organisation_id: organisation.id,
		p_export_id: exportId,
		p_release_reason: 'Current holder selected Undo from Team administration.',
		p_release_source: 'holder_undo',
	});
	if (error) {
		logWorkspaceTeamCheckoutReleaseFailure({
			workspaceId: organisation.id,
			workspaceSlug,
			exportId,
			actorId,
			error,
		});
		return teamRedirect(workspaceSlug, {
			checkout_release: 'error',
			checkout_release_error: workspaceTeamCheckoutReleaseErrorCode(error, stateErrorCode),
		});
	}

	return teamRedirect(workspaceSlug, { checkout_release: 'success' });
};

export const GET: APIRoute = async () => new Response('Workspace Team checkout release requires a confirmed POST request.', {
	status: 405,
	headers: {
		'content-type': 'text/plain; charset=utf-8',
		'cache-control': 'private, no-store, no-cache, must-revalidate',
	},
});
