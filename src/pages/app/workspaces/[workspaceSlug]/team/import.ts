import type { APIRoute } from 'astro';
import { buildWorkspaceTeamPath, getWorkspaceBySlug } from '../../../../../lib/projects.ts';
import { isWorkspaceRole } from '../../../../../lib/permissions.ts';
import { createSupabaseServerClient, getServerAccessToken } from '../../../../../lib/supabaseServer.ts';
import {
	WORKSPACE_TEAM_IMPORT_ACCEPTED_CONTENT_TYPES,
	WORKSPACE_TEAM_IMPORT_FILE_FIELD,
	WORKSPACE_TEAM_IMPORT_MAX_FILE_BYTES,
	extractWorkspaceTeamCsvMetadata,
	validateWorkspaceTeamCsvImport,
	type WorkspaceTeamImportMemberSnapshot,
} from '../../../../../lib/workspaceTeamCsvImport.ts';

function importError(message: string, status = 400) {
	return new Response(message, {
		status,
		headers: {
			'content-type': 'text/plain; charset=utf-8',
			'cache-control': 'private, no-store, no-cache, must-revalidate',
		},
	});
}

async function sha256Hex(buffer: ArrayBuffer): Promise<string> {
	const digest = await crypto.subtle.digest('SHA-256', buffer);
	return [...new Uint8Array(digest)]
		.map((byte) => byte.toString(16).padStart(2, '0'))
		.join('');
}

function redirectToImportRun(workspaceSlug: string, importRunId: string) {
	return new Response(null, {
		status: 303,
		headers: {
			location: `${buildWorkspaceTeamPath(workspaceSlug)}?import_run=${encodeURIComponent(importRunId)}`,
			'cache-control': 'private, no-store, no-cache, must-revalidate',
		},
	});
}

function isCsvFilename(filename: string) {
	return filename.trim().toLowerCase().endsWith('.csv');
}

function asSourceRows(rows: Array<Record<string, unknown>>): WorkspaceTeamImportMemberSnapshot[] {
	return rows.map((row) => ({
		source_row_number: Number(row.source_row_number ?? 0),
		workspace_membership_id: String(row.workspace_membership_id ?? ''),
		user_id: String(row.user_id ?? ''),
		login_name: row.login_name as string | null,
		first_name: row.first_name as string | null,
		last_name: row.last_name as string | null,
		email: row.contact_email as string | null,
		contact_email: row.contact_email as string | null,
		workspace_role: row.workspace_role as string | null,
		membership_status: row.membership_status as string | null,
		invited_at: row.invited_at as string | null,
		invitation_expires_at: row.invitation_expires_at as string | null,
		accepted_at: row.accepted_at as string | null,
		last_login_at: row.last_login_at as string | null,
		added_at: row.added_at as string | null,
		deactivated_at: row.deactivated_at as string | null,
		reactivated_at: row.reactivated_at as string | null,
	}));
}

function asLiveRows(rows: Array<Record<string, unknown>>): WorkspaceTeamImportMemberSnapshot[] {
	return rows.map((row) => ({
		workspace_membership_id: String(row.organisation_membership_id ?? ''),
		user_id: String(row.profile_id ?? ''),
		login_name: row.login_name as string | null,
		first_name: row.first_name as string | null,
		last_name: row.last_name as string | null,
		email: row.contact_email as string | null,
		contact_email: row.contact_email as string | null,
		workspace_role: row.role as string | null,
		membership_status: row.membership_status as string | null,
		invited_at: row.invited_at as string | null,
		invitation_expires_at: row.invitation_expires_at as string | null,
		accepted_at: row.accepted_at as string | null,
		deactivated_at: row.deactivated_at as string | null,
		reactivated_at: row.reactivated_at as string | null,
	}));
}

export const POST: APIRoute = async ({ cookies, params, request }) => {
	const accessToken = getServerAccessToken(cookies);
	if (!accessToken) return importError('Sign in before uploading Workspace Team CSV files.', 401);

	const workspaceSlug = params.workspaceSlug ?? '';
	const serverSupabase = createSupabaseServerClient(accessToken);
	const workspace = await getWorkspaceBySlug(serverSupabase, workspaceSlug, accessToken);
	const organisation = Array.isArray(workspace?.organisations) ? workspace?.organisations[0] : workspace?.organisations;
	if (!workspace || !organisation || !isWorkspaceRole(workspace.role)) {
		return importError('Workspace not found or your active membership could not be confirmed.', 404);
	}
	if (workspace.role !== 'owner' && workspace.role !== 'admin') {
		return importError('Only active Workspace Owners and Admins can upload Workspace Team CSV files.', 403);
	}

	const formData = await request.formData();
	const uploadedFile = formData.get(WORKSPACE_TEAM_IMPORT_FILE_FIELD);
	if (!(uploadedFile instanceof File)) return importError('Choose a Workspace Team CSV file before uploading.', 400);
	if (!isCsvFilename(uploadedFile.name)) return importError('Workspace Team uploads must use a .csv file.', 400);
	if (!WORKSPACE_TEAM_IMPORT_ACCEPTED_CONTENT_TYPES.has(uploadedFile.type)) return importError('Workspace Team uploads must be CSV text files.', 400);
	if (uploadedFile.size === 0) return importError('Workspace Team CSV file is empty.', 400);
	if (uploadedFile.size > WORKSPACE_TEAM_IMPORT_MAX_FILE_BYTES) return importError('Workspace Team CSV file is larger than the supported limit.', 413);

	const buffer = await uploadedFile.arrayBuffer();
	let csvText = '';
	try {
		csvText = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
	} catch {
		return importError('Workspace Team CSV file must be valid UTF-8 text.', 400);
	}

	const fileHash = await sha256Hex(buffer);
	const metadata = extractWorkspaceTeamCsvMetadata(csvText);
	const sourceExportId = metadata.exportId;
	let sourceExport = null;
	let sourceRows: WorkspaceTeamImportMemberSnapshot[] = [];
	let liveRows: WorkspaceTeamImportMemberSnapshot[] = [];
	let liveSnapshotVersion: number | string | null = null;

	if (sourceExportId) {
		const { data: exportData } = await serverSupabase
			.from('workspace_membership_export_runs')
			.select('id, organisation_id, export_mode, status, exported_at, membership_snapshot_version, checkout_expires_at, superseded_at, superseded_by_export_id, released_at, released_by, release_source')
			.eq('id', sourceExportId)
			.maybeSingle();
		sourceExport = exportData ?? null;
		if (sourceExport?.organisation_id === organisation.id) {
			const { data: exportRows } = await serverSupabase
				.from('workspace_membership_export_rows')
				.select('source_row_number, workspace_membership_id, user_id, login_name, first_name, last_name, contact_email, workspace_role, membership_status, invited_at, invitation_expires_at, accepted_at, last_login_at, added_at, deactivated_at, reactivated_at')
				.eq('export_run_id', sourceExportId)
				.eq('organisation_id', organisation.id)
				.order('source_row_number', { ascending: true });
			sourceRows = asSourceRows(exportRows ?? []);
		}
	}

	const { data: liveData } = await serverSupabase
		.from('workspace_member_admin_directory')
		.select('organisation_membership_id, profile_id, login_name, first_name, last_name, contact_email, role, membership_status, invited_at, invitation_expires_at, accepted_at, deactivated_at, reactivated_at')
		.eq('organisation_id', organisation.id);
	liveRows = asLiveRows(liveData ?? []);

	const { data: snapshotData } = await serverSupabase.rpc('current_workspace_membership_snapshot_version', {
		target_organisation_id: organisation.id,
	});
	liveSnapshotVersion = typeof snapshotData === 'number' || typeof snapshotData === 'string'
		? snapshotData
		: sourceExport?.membership_snapshot_version ?? null;

	const validation = validateWorkspaceTeamCsvImport(csvText, {
		organisationId: organisation.id,
		sourceExport,
		sourceRows,
		liveRows,
		liveSnapshotVersion,
		allowSharedContactEmail: workspaceSlug === 'mark-nesbit-professional-workspace',
	});

	const failureMessage = validation.fileErrors[0]?.message
		?? validation.rows.find((row) => row.validation_state === 'error')?.validation_messages[0]?.message
		?? null;
	const { data: importRunId, error: recordError } = await serverSupabase.rpc('record_workspace_membership_import_validation', {
		target_organisation_id: organisation.id,
		target_source_export_id: validation.sourceExportId,
		import_metadata: {
			status: validation.status,
			original_filename: uploadedFile.name,
			file_size_bytes: uploadedFile.size,
			file_hash: fileHash,
			source_snapshot_version: validation.sourceSnapshotVersion,
			live_snapshot_version: validation.liveSnapshotVersion,
			source_export_mode: sourceExport?.export_mode ?? null,
			checkout_expired: validation.checkoutExpired,
			source_stale: validation.sourceStale,
			source_superseded: validation.sourceSuperseded,
			validation_summary: validation.summary,
			failure_code: failureMessage ? 'workspace_team_csv_validation' : null,
			failure_message: failureMessage,
			failure_details: {
				file_errors: validation.fileErrors,
				warnings: validation.warnings,
			},
		},
		import_rows: validation.rows,
	});

	if (recordError || !importRunId) {
		return importError(recordError?.message || 'Workspace Team CSV validation evidence could not be saved.', 400);
	}

	return redirectToImportRun(workspaceSlug, String(importRunId));
};

export const GET: APIRoute = async () => importError('Workspace Team CSV uploads require a confirmed POST request.', 405);
