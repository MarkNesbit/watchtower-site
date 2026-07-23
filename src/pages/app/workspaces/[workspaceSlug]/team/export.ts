import type { APIRoute } from 'astro';
import { getWorkspaceBySlug } from '../../../../../lib/projects.ts';
import { isWorkspaceRole } from '../../../../../lib/permissions.ts';
import { buildWorkspaceTeamCsv, normaliseWorkspaceTeamCsvExport, safeWorkspaceTeamCsvFilename, type WorkspaceTeamCsvExport, type WorkspaceTeamCsvMode } from '../../../../../lib/workspaceTeamCsv.ts';
import { createSupabaseServerClient, getServerAccessToken } from '../../../../../lib/supabaseServer.ts';

function csvError(message: string, status = 400) {
	return new Response(message, {
		status,
		headers: {
			'content-type': 'text/plain; charset=utf-8',
			'cache-control': 'private, no-store, no-cache, must-revalidate',
		},
	});
}

function isExportMode(value: string): value is WorkspaceTeamCsvMode {
	return value === 'editable' || value === 'read_only';
}

export const POST: APIRoute = async ({ cookies, params, request }) => {
	const accessToken = getServerAccessToken(cookies);
	if (!accessToken) return csvError('Sign in before exporting Workspace Team data.', 401);

	const workspaceSlug = params.workspaceSlug ?? '';
	const serverSupabase = createSupabaseServerClient(accessToken);
	const workspace = await getWorkspaceBySlug(serverSupabase, workspaceSlug, accessToken);
	const organisation = Array.isArray(workspace?.organisations) ? workspace?.organisations[0] : workspace?.organisations;
	if (!workspace || !organisation || !isWorkspaceRole(workspace.role)) {
		return csvError('Workspace not found or your active membership could not be confirmed.', 404);
	}
	if (workspace.role !== 'owner' && workspace.role !== 'admin') {
		return csvError('Only active Workspace Owners and Admins can export Workspace Team CSV files.', 403);
	}

	const formData = await request.formData();
	const requestedMode = String(formData.get('export_mode') ?? 'editable');
	const takeoverExportId = String(formData.get('takeover_export_id') ?? '').trim() || null;
	const confirmedTakeover = String(formData.get('confirm_takeover') ?? '') === 'true';
	if (!isExportMode(requestedMode)) return csvError('Choose an editable or read-only export.', 400);
	if (takeoverExportId && !confirmedTakeover) return csvError('Confirm takeover before replacing an active editable export.', 400);

	const { data, error } = await serverSupabase.rpc('create_workspace_membership_csv_export', {
		target_organisation_id: organisation.id,
		requested_export_mode: requestedMode,
		takeover_export_id: takeoverExportId,
	});
	if (error) {
		const message = error.message?.includes('WT_MEMBERSHIP_EXPORT_ACTIVE_CHECKOUT')
			? 'Another editable Workspace Team export is already checked out. Download a read-only copy or use takeover from the Workspace Team page.'
			: error.message || 'Workspace Team CSV export could not be created.';
		return csvError(message, error.message?.includes('WT_MEMBERSHIP_EXPORT_ACTIVE_CHECKOUT') ? 409 : 400);
	}

	let exportRun: WorkspaceTeamCsvExport;
	try {
		exportRun = normaliseWorkspaceTeamCsvExport(data as WorkspaceTeamCsvExport);
	} catch {
		return csvError('Workspace Team CSV export returned an unsafe snapshot version. Download a fresh export after the service is updated.', 500);
	}
	const csv = buildWorkspaceTeamCsv(exportRun);
	const filename = safeWorkspaceTeamCsvFilename(workspaceSlug, exportRun.exported_at, exportRun.export_mode);

	return new Response(csv, {
		status: 200,
		headers: {
			'content-type': 'text/csv; charset=utf-8',
			'content-disposition': `attachment; filename="${filename}"`,
			'cache-control': 'private, no-store, no-cache, must-revalidate',
			'x-watchtower-export-id': exportRun.export_id,
			'x-watchtower-export-mode': exportRun.export_mode,
			'x-watchtower-membership-snapshot-version': String(exportRun.membership_snapshot_version),
		},
	});
};

export const GET: APIRoute = async () => csvError('Workspace Team CSV exports require a confirmed POST request.', 405);
