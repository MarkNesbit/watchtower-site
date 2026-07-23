import type { APIRoute } from 'astro';
import { getWorkspaceBySlug } from '../../../../../../../../lib/projects.ts';
import { isWorkspaceRole } from '../../../../../../../../lib/permissions.ts';
import { createSupabaseServerClient, getServerAccessToken } from '../../../../../../../../lib/supabaseServer.ts';

function jsonResponse(status: number, body: Record<string, unknown>) {
	return new Response(JSON.stringify(body), {
		status,
		headers: {
			'content-type': 'application/json; charset=utf-8',
			'cache-control': 'private, no-store, no-cache, must-revalidate',
		},
	});
}

export const POST: APIRoute = async ({ cookies, params, request }) => {
	const workspaceSlug = params.workspaceSlug ?? '';
	const importRunId = params.importRunId ?? '';
	const accessToken = getServerAccessToken(cookies);
	if (!accessToken) return jsonResponse(401, { ok: false, error: 'signin' });

	const serverSupabase = createSupabaseServerClient(accessToken);
	const workspace = await getWorkspaceBySlug(serverSupabase, workspaceSlug, accessToken);
	const organisation = Array.isArray(workspace?.organisations) ? workspace?.organisations[0] : workspace?.organisations;
	if (!workspace || !organisation || !isWorkspaceRole(workspace.role)) {
		return jsonResponse(404, { ok: false, error: 'workspace' });
	}
	if (workspace.role !== 'owner' && workspace.role !== 'admin') {
		return jsonResponse(403, { ok: false, error: 'permission' });
	}

	const formData = await request.formData();
	const importRowId = String(formData.get('import_row_id') ?? '').trim();
	const selected = String(formData.get('review_selected') ?? '') === 'true';
	const draftReason = String(formData.get('review_draft_reason') ?? '').trim() || null;
	if (!importRowId) return jsonResponse(400, { ok: false, error: 'missing_row' });

	const { error } = await serverSupabase.rpc('save_workspace_membership_review_draft_selection', {
		target_import_row_id: importRowId,
		requested_review_selected: selected,
		review_draft_reason: draftReason,
	});

	if (error) {
		console.error('workspace_team_review_draft_save_failed', {
			routeName: 'workspace_team_review_draft',
			workspaceId: organisation.id,
			importRunId,
			importRowId,
			rpcName: 'save_workspace_membership_review_draft_selection',
			code: error.code,
			message: error.message,
			details: error.details,
			hint: error.hint,
		});
		return jsonResponse(409, { ok: false, error: 'save_failed' });
	}

	return jsonResponse(200, { ok: true });
};

export const GET: APIRoute = () => jsonResponse(405, { ok: false, error: 'method' });
