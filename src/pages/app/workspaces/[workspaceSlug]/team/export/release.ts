import type { APIRoute } from 'astro';
import { buildWorkspaceTeamPath, getWorkspaceBySlug } from '../../../../../../lib/projects.ts';
import { isWorkspaceRole } from '../../../../../../lib/permissions.ts';
import { createSupabaseServerClient, getServerAccessToken } from '../../../../../../lib/supabaseServer.ts';

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

function releaseErrorCode(message: string | undefined) {
	if (!message) return 'failed';
	if (message.includes('WT_MEMBERSHIP_EXPORT_RELEASE_HOLDER_ONLY')) return 'holder_only';
	if (message.includes('WT_MEMBERSHIP_EXPORT_RELEASE_NOT_ACTIVE')) return 'not_active';
	if (message.includes('WT_MEMBERSHIP_EXPORT_RELEASE_RACE')) return 'stale';
	if (message.includes('WT_MEMBERSHIP_PERMISSION_DENIED')) return 'permission';
	return 'failed';
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

	const { error } = await serverSupabase.rpc('release_workspace_membership_csv_checkout', {
		target_organisation_id: organisation.id,
		target_export_id: exportId,
		release_reason: 'Current holder selected Undo from Team administration.',
		release_source: 'holder_undo',
	});
	if (error) {
		return teamRedirect(workspaceSlug, {
			checkout_release: 'error',
			checkout_release_error: releaseErrorCode(error.message),
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
