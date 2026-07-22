export const WORKSPACE_TEAM_CSV_COLUMNS = [
	'export_id',
	'membership_snapshot_version',
	'exported_at',
	'export_mode',
	'workspace_membership_id',
	'user_id',
	'login_name',
	'first_name',
	'last_name',
	'email',
	'workspace_role',
	'membership_status',
	'invited_at',
	'invitation_expires_at',
	'accepted_at',
	'last_login_at',
	'added_at',
	'deactivated_at',
	'reactivated_at',
] as const;

export type WorkspaceTeamCsvColumn = (typeof WORKSPACE_TEAM_CSV_COLUMNS)[number];
export type WorkspaceTeamCsvMode = 'editable' | 'read_only';

export type WorkspaceTeamCsvRow = {
	source_row_number?: number;
	workspace_membership_id?: string | null;
	user_id?: string | null;
	login_name?: string | null;
	first_name?: string | null;
	last_name?: string | null;
	email?: string | null;
	workspace_role?: string | null;
	membership_status?: string | null;
	invited_at?: string | null;
	invitation_expires_at?: string | null;
	accepted_at?: string | null;
	last_login_at?: string | null;
	added_at?: string | null;
	deactivated_at?: string | null;
	reactivated_at?: string | null;
};

export type WorkspaceTeamCsvExport = {
	export_id: string;
	membership_snapshot_version: number | string;
	exported_at: string;
	export_mode: WorkspaceTeamCsvMode;
	rows: WorkspaceTeamCsvRow[];
};

const FORMULA_PREFIX_PATTERN = /^[=+\-@]/;

function normaliseCsvValue(value: unknown): string {
	if (value === null || value === undefined) return '';
	const text = value instanceof Date ? value.toISOString() : String(value);
	return FORMULA_PREFIX_PATTERN.test(text) ? `'${text}` : text;
}

export function encodeCsvCell(value: unknown): string {
	const text = normaliseCsvValue(value);
	const escaped = text.replace(/"/g, '""');
	return /[",\r\n]/.test(escaped) ? `"${escaped}"` : escaped;
}

function rowValue(exportRun: WorkspaceTeamCsvExport, row: WorkspaceTeamCsvRow, column: WorkspaceTeamCsvColumn): unknown {
	if (column === 'export_id') return exportRun.export_id;
	if (column === 'membership_snapshot_version') return exportRun.membership_snapshot_version;
	if (column === 'exported_at') return exportRun.exported_at;
	if (column === 'export_mode') return exportRun.export_mode;
	return row[column];
}

export function buildWorkspaceTeamCsv(exportRun: WorkspaceTeamCsvExport): string {
	const header = WORKSPACE_TEAM_CSV_COLUMNS.join(',');
	const rows = exportRun.rows.map((row) => (
		WORKSPACE_TEAM_CSV_COLUMNS
			.map((column) => encodeCsvCell(rowValue(exportRun, row, column)))
			.join(',')
	));
	return `\uFEFF${[header, ...rows].join('\r\n')}\r\n`;
}

export function safeWorkspaceTeamCsvFilename(workspaceSlug: string, exportedAt: string | Date, mode: WorkspaceTeamCsvMode): string {
	const safeSlug = workspaceSlug
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9-]+/g, '-')
		.replace(/^-+|-+$/g, '') || 'workspace';
	const date = exportedAt instanceof Date ? exportedAt : new Date(exportedAt);
	const timestamp = Number.isNaN(date.getTime())
		? new Date().toISOString()
		: date.toISOString();
	const compactTimestamp = timestamp
		.slice(0, 16)
		.replace(/[-:T]/g, '')
		.replace(/^(\d{8})(\d{4})$/, '$1-$2');
	return `watchtower-workspace-team-${safeSlug}-${compactTimestamp}-${mode}.csv`;
}
