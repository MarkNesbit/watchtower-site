import type { APIRoute } from 'astro';
import { buildWorkspaceTeamPath, getWorkspaceBySlug } from '../../../../../../../../lib/projects.ts';
import { isWorkspaceRole } from '../../../../../../../../lib/permissions.ts';
import { createSupabaseServerClient, getServerAccessToken } from '../../../../../../../../lib/supabaseServer.ts';

function redirectToTeam(workspaceSlug: string, importRunId: string, state: string) {
	const params = new URLSearchParams({ import_run: importRunId, review_confirmation: state });
	return new Response(null, {
		status: 303,
		headers: {
			location: `${buildWorkspaceTeamPath(workspaceSlug)}?${params.toString()}`,
			'cache-control': 'private, no-store, no-cache, must-revalidate',
		},
	});
}

export const POST: APIRoute = async ({ cookies, params, request }) => {
	const workspaceSlug = params.workspaceSlug ?? '';
	const importRunId = params.importRunId ?? '';
	const accessToken = getServerAccessToken(cookies);
	if (!accessToken) return redirectToTeam(workspaceSlug, importRunId, 'signin');

	const serverSupabase = createSupabaseServerClient(accessToken);
	const workspace = await getWorkspaceBySlug(serverSupabase, workspaceSlug, accessToken);
	const organisation = Array.isArray(workspace?.organisations) ? workspace?.organisations[0] : workspace?.organisations;
	if (!workspace || !organisation || !isWorkspaceRole(workspace.role)) {
		return redirectToTeam(workspaceSlug, importRunId, 'workspace');
	}
	if (workspace.role !== 'owner' && workspace.role !== 'admin') {
		return redirectToTeam(workspaceSlug, importRunId, 'permission');
	}

	const formData = await request.formData();
	const selectionSource = String(formData.get('selection_source') ?? '').trim();
	const selectedImportRowIds = selectionSource === 'persisted_draft'
		? null
		: formData.getAll('selected_import_row_id')
			.map((value) => String(value).trim())
			.filter(Boolean);
	const batchReason = String(formData.get('batch_reason') ?? '').trim() || null;

	const { error } = await serverSupabase.rpc('confirm_workspace_membership_selected_change_set', {
		target_import_run_id: importRunId,
		selected_import_row_ids: selectedImportRowIds,
		batch_reason: batchReason,
	});

	if (error) {
		console.error('workspace_team_bulk_review_confirmation_failed', {
			routeName: 'workspace_team_bulk_review_confirmation',
			workspaceId: organisation.id,
			importRunId,
			selectedCount: selectedImportRowIds?.length ?? null,
			selectionSource,
			code: error.code,
			message: error.message,
			details: error.details,
			hint: error.hint,
		});
		return redirectToTeam(workspaceSlug, importRunId, 'error');
	}

	return redirectToTeam(workspaceSlug, importRunId, 'success');
};

export const GET: APIRoute = async ({ params }) => redirectToTeam(
	params.workspaceSlug ?? '',
	params.importRunId ?? '',
	'method',
);
