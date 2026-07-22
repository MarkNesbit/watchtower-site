import { parse } from 'csv-parse/sync';
import { WORKSPACE_ROLES, isWorkspaceRole, type WorkspaceRole } from './permissions.ts';
import { WORKSPACE_TEAM_CSV_COLUMNS, type WorkspaceTeamCsvColumn } from './workspaceTeamCsv.ts';

export const WORKSPACE_TEAM_IMPORT_MAX_FILE_BYTES = 1024 * 1024;
export const WORKSPACE_TEAM_IMPORT_FILE_FIELD = 'team_csv';
export const WORKSPACE_TEAM_IMPORT_ACCEPTED_CONTENT_TYPES = new Set([
	'text/csv',
	'application/csv',
	'application/vnd.ms-excel',
	'text/plain',
	'application/octet-stream',
	'',
]);

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const FORMULA_TRIGGER_PATTERN = /^[=+\-@]/;
const METADATA_COLUMNS = ['export_id', 'membership_snapshot_version', 'exported_at', 'export_mode'] as const;
const PROTECTED_EXISTING_COLUMNS = [
	'login_name',
	'workspace_role',
	'membership_status',
	'invited_at',
	'invitation_expires_at',
	'accepted_at',
	'last_login_at',
	'added_at',
	'deactivated_at',
	'reactivated_at',
] as const satisfies readonly WorkspaceTeamCsvColumn[];
const NEW_ROW_PROTECTED_COLUMNS = [
	'workspace_membership_id',
	'user_id',
	'login_name',
	'membership_status',
	'invited_at',
	'invitation_expires_at',
	'accepted_at',
	'last_login_at',
	'added_at',
	'deactivated_at',
	'reactivated_at',
] as const satisfies readonly WorkspaceTeamCsvColumn[];

export type WorkspaceTeamImportStatus = 'validated' | 'stale_review_required' | 'validation_failed' | 'superseded';
export type WorkspaceTeamImportChangeType = 'addition' | 'identity_correction' | 'deactivation' | 'reactivation' | 'unchanged' | 'invalid';
export type WorkspaceTeamImportValidationState = 'valid' | 'warning' | 'error';
export type WorkspaceTeamProposedAction = 'none' | 'reactivate';

export type WorkspaceTeamImportSourceExport = {
	id: string;
	organisation_id: string;
	export_mode: string;
	status: string;
	exported_at: string;
	membership_snapshot_version: number | string;
	checkout_expires_at?: string | null;
	superseded_at?: string | null;
	superseded_by_export_id?: string | null;
};

export type WorkspaceTeamImportMemberSnapshot = {
	source_row_number?: number | null;
	workspace_membership_id: string;
	user_id: string;
	login_name?: string | null;
	first_name?: string | null;
	last_name?: string | null;
	email?: string | null;
	contact_email?: string | null;
	workspace_role?: string | null;
	role?: string | null;
	membership_status?: string | null;
	invited_at?: string | null;
	invitation_expires_at?: string | null;
	accepted_at?: string | null;
	last_login_at?: string | null;
	added_at?: string | null;
	deactivated_at?: string | null;
	reactivated_at?: string | null;
};

export type WorkspaceTeamImportContext = {
	organisationId: string;
	sourceExport?: WorkspaceTeamImportSourceExport | null;
	sourceRows?: WorkspaceTeamImportMemberSnapshot[];
	liveRows?: WorkspaceTeamImportMemberSnapshot[];
	liveSnapshotVersion?: number | string | null;
	allowSharedContactEmail?: boolean;
	now?: Date;
};

export type WorkspaceTeamImportRowEvidence = {
	source_row_number: number;
	supplied_membership_id: string | null;
	supplied_user_id: string | null;
	raw_values: Record<string, string>;
	normalised_values: Record<string, string | null>;
	validation_state: WorkspaceTeamImportValidationState;
	validation_messages: Array<{ field: string; message: string }>;
	proposed_change_type: WorkspaceTeamImportChangeType;
	source_export_values: Record<string, unknown>;
	live_values: Record<string, unknown>;
	proposed_values: Record<string, unknown>;
	field_differences: Array<{ field: string; from: unknown; to: unknown }>;
	is_unchanged: boolean;
	formula_safety: Record<string, { reversed: boolean; formulaLike: boolean }>;
};

export type WorkspaceTeamImportValidationResult = {
	status: WorkspaceTeamImportStatus;
	fileErrors: Array<{ field: string; message: string }>;
	warnings: Array<{ field: string; message: string }>;
	sourceExportId: string | null;
	sourceSnapshotVersion: number | null;
	liveSnapshotVersion: number | null;
	checkoutExpired: boolean;
	sourceStale: boolean;
	sourceSuperseded: boolean;
	summary: {
		total_rows: number;
		valid_rows: number;
		invalid_rows: number;
		warnings: number;
		unchanged: number;
		additions: number;
		identity_corrections: number;
		name_corrections: number;
		email_corrections: number;
		deactivations: number;
		reactivations: number;
	};
	rows: WorkspaceTeamImportRowEvidence[];
};

type ParsedCsv = {
	header: string[];
	rows: string[][];
	errors: Array<{ field: string; message: string }>;
};

function blankToNull(value: unknown): string | null {
	if (value === null || value === undefined) return null;
	const text = String(value).trim();
	return text ? text : null;
}

function normaliseUuid(value: unknown): string | null {
	const text = blankToNull(value)?.toLowerCase() ?? null;
	return text;
}

function normaliseEmail(value: unknown): string | null {
	return blankToNull(value)?.toLowerCase() ?? null;
}

function normaliseRole(value: unknown): WorkspaceRole | null {
	const role = blankToNull(value)?.toLowerCase() ?? null;
	return isWorkspaceRole(role) ? role : null;
}

function normaliseAction(value: unknown): WorkspaceTeamProposedAction | null {
	const action = blankToNull(value)?.toLowerCase().replace(/[\s-]+/g, '_') ?? null;
	if (!action || action === 'none') return 'none';
	if (action === 'reactivate') return 'reactivate';
	return null;
}

function isIsoTimestampOrBlank(value: unknown): boolean {
	const text = blankToNull(value);
	if (!text) return true;
	const parsed = new Date(text);
	return !Number.isNaN(parsed.getTime());
}

function snapshotEmail(row?: WorkspaceTeamImportMemberSnapshot | null): string | null {
	return normaliseEmail(row?.contact_email ?? row?.email);
}

function snapshotRole(row?: WorkspaceTeamImportMemberSnapshot | null): string | null {
	return blankToNull(row?.workspace_role ?? row?.role)?.toLowerCase() ?? null;
}

function snapshotValue(row: WorkspaceTeamImportMemberSnapshot | null | undefined, column: WorkspaceTeamCsvColumn): string | null {
	if (!row) return null;
	if (column === 'email') return snapshotEmail(row);
	if (column === 'workspace_role') return snapshotRole(row);
	const value = row[column as keyof WorkspaceTeamImportMemberSnapshot];
	return blankToNull(value);
}

function rowIdentity(row: Record<string, string | null>): string {
	return row.workspace_membership_id || row.user_id || row.email || `${row.first_name ?? ''} ${row.last_name ?? ''}`.trim() || 'new row';
}

function message(field: string, text: string) {
	return { field, message: text };
}

export function parseWorkspaceTeamCsvText(csvText: string): ParsedCsv {
	try {
		const records = parse(csvText, {
			bom: true,
			relax_column_count: true,
			skip_empty_lines: true,
		}) as string[][];
		if (records.length === 0) return { header: [], rows: [], errors: [message('file', 'CSV file is empty.')] };
		const [header, ...rows] = records;
		const errors = rows
			.map((row, index) => row.length === header.length
				? null
				: message('file', `Row ${index + 2} has ${row.length} columns but the header has ${header.length}.`))
			.filter((entry): entry is { field: string; message: string } => Boolean(entry));
		return { header: header.map((column) => String(column ?? '').trim()), rows, errors };
	} catch {
		return {
			header: [],
			rows: [],
			errors: [message('file', 'CSV could not be parsed. Check quotes, line breaks and spreadsheet export format.')],
		};
	}
}

export function validateWorkspaceTeamCsvHeader(header: string[]) {
	const errors: Array<{ field: string; message: string }> = [];
	if (header.length === 0) errors.push(message('header', 'CSV header row is required.'));
	const seen = new Set<string>();
	const duplicates = new Set<string>();
	for (const column of header) {
		if (seen.has(column)) duplicates.add(column);
		seen.add(column);
	}
	for (const duplicate of duplicates) errors.push(message('header', `Duplicate CSV column "${duplicate}" is not allowed.`));
	for (const column of WORKSPACE_TEAM_CSV_COLUMNS) {
		if (!seen.has(column)) errors.push(message('header', `Required CSV column "${column}" is missing.`));
	}
	for (const column of header) {
		if (!WORKSPACE_TEAM_CSV_COLUMNS.includes(column as WorkspaceTeamCsvColumn)) {
			errors.push(message('header', `Unsupported CSV column "${column}" is not part of the Workspace Team export contract.`));
		}
	}
	if (header.length !== WORKSPACE_TEAM_CSV_COLUMNS.length) {
		errors.push(message('header', 'CSV columns must match the current Workspace Team export contract exactly.'));
	}
	return errors;
}

function recordFromRow(header: string[], row: string[]): Record<WorkspaceTeamCsvColumn, string> {
	const record = Object.fromEntries(WORKSPACE_TEAM_CSV_COLUMNS.map((column) => [column, ''])) as Record<WorkspaceTeamCsvColumn, string>;
	header.forEach((column, index) => {
		if (WORKSPACE_TEAM_CSV_COLUMNS.includes(column as WorkspaceTeamCsvColumn)) {
			record[column as WorkspaceTeamCsvColumn] = String(row[index] ?? '');
		}
	});
	return record;
}

export function extractWorkspaceTeamCsvMetadata(csvText: string) {
	const parsed = parseWorkspaceTeamCsvText(csvText);
	const headerErrors = validateWorkspaceTeamCsvHeader(parsed.header);
	if (parsed.errors.length > 0 || headerErrors.length > 0 || parsed.rows.length === 0) {
		return { exportId: null, errors: [...parsed.errors, ...headerErrors] };
	}
	const record = recordFromRow(parsed.header, parsed.rows[0]);
	const exportId = record.export_id.trim() || null;
	if (!exportId || !UUID_PATTERN.test(exportId)) {
		return { exportId: null, errors: [message('export_id', 'CSV export_id must be a valid UUID.')] };
	}
	return { exportId, errors: [] };
}

function normaliseUploadedValue(rawValue: string, sourceValue: string | null | undefined) {
	const trimmed = rawValue.trim();
	const candidate = trimmed.startsWith("'") ? trimmed.slice(1) : trimmed;
	const reversed = trimmed.startsWith("'")
		&& FORMULA_TRIGGER_PATTERN.test(candidate)
		&& sourceValue !== null
		&& sourceValue !== undefined
		&& candidate === String(sourceValue);
	const value = reversed ? candidate : trimmed;
	return {
		value: value || null,
		reversed,
		formulaLike: FORMULA_TRIGGER_PATTERN.test(value),
	};
}

function sourceSnapshotObject(row?: WorkspaceTeamImportMemberSnapshot | null) {
	if (!row) return {};
	return {
		workspace_membership_id: row.workspace_membership_id,
		user_id: row.user_id,
		login_name: row.login_name ?? null,
		first_name: row.first_name ?? null,
		last_name: row.last_name ?? null,
		email: snapshotEmail(row),
		workspace_role: snapshotRole(row),
		membership_status: row.membership_status ?? null,
		invited_at: row.invited_at ?? null,
		invitation_expires_at: row.invitation_expires_at ?? null,
		accepted_at: row.accepted_at ?? null,
		last_login_at: row.last_login_at ?? null,
		added_at: row.added_at ?? null,
		deactivated_at: row.deactivated_at ?? null,
		reactivated_at: row.reactivated_at ?? null,
	};
}

function emptySummary(): WorkspaceTeamImportValidationResult['summary'] {
	return {
		total_rows: 0,
		valid_rows: 0,
		invalid_rows: 0,
		warnings: 0,
		unchanged: 0,
		additions: 0,
		identity_corrections: 0,
		name_corrections: 0,
		email_corrections: 0,
		deactivations: 0,
		reactivations: 0,
	};
}

function deriveStatus(result: WorkspaceTeamImportValidationResult): WorkspaceTeamImportStatus {
	if (result.sourceSuperseded) return 'superseded';
	if (result.fileErrors.length > 0 || result.summary.invalid_rows > 0) return 'validation_failed';
	if (result.sourceStale) return 'stale_review_required';
	return 'validated';
}

function addRowError(row: WorkspaceTeamImportRowEvidence, field: string, text: string) {
	row.validation_messages.push(message(field, text));
	row.validation_state = 'error';
	row.proposed_change_type = 'invalid';
	row.is_unchanged = false;
}

export function validateWorkspaceTeamCsvImport(csvText: string, context: WorkspaceTeamImportContext): WorkspaceTeamImportValidationResult {
	const parsed = parseWorkspaceTeamCsvText(csvText);
	const headerErrors = validateWorkspaceTeamCsvHeader(parsed.header);
	const fileErrors = [...parsed.errors, ...headerErrors];
	const rows: WorkspaceTeamImportRowEvidence[] = [];
	const summary = emptySummary();
	const sourceRows = new Map((context.sourceRows ?? []).map((row) => [row.workspace_membership_id, row]));
	const liveRows = new Map((context.liveRows ?? []).map((row) => [row.workspace_membership_id, row]));
	const now = context.now ?? new Date();
	const sourceExport = context.sourceExport ?? null;
	const sourceExportId = sourceExport?.id ?? null;
	const sourceSnapshotVersion = Number(sourceExport?.membership_snapshot_version ?? NaN);
	const liveSnapshotVersion = context.liveSnapshotVersion === null || context.liveSnapshotVersion === undefined
		? null
		: Number(context.liveSnapshotVersion);
	const checkoutExpired = Boolean(sourceExport?.checkout_expires_at && new Date(sourceExport.checkout_expires_at).getTime() < now.getTime());
	const sourceSuperseded = Boolean(sourceExport?.superseded_at || sourceExport?.status === 'superseded');
	const sourceStale = Boolean(
		sourceExport
		&& liveSnapshotVersion
		&& Number(sourceExport.membership_snapshot_version) !== liveSnapshotVersion
	);
	const warnings = checkoutExpired
		? [message('checkout_expires_at', 'The editable checkout window has expired. Validation continues against current live workspace data.')]
		: [];
	if (sourceStale) warnings.push(message('membership_snapshot_version', 'The uploaded file is stale because live Workspace Team data has changed since export.'));

	if (parsed.rows.length === 0 && fileErrors.length === 0) {
		fileErrors.push(message('file', 'CSV must contain at least one data row.'));
	}

	if (fileErrors.length === 0) {
		const records = parsed.rows.map((row) => recordFromRow(parsed.header, row));
		const metadataValues = new Map<(typeof METADATA_COLUMNS)[number], Set<string>>();
		for (const column of METADATA_COLUMNS) metadataValues.set(column, new Set());
		for (const record of records) {
			for (const column of METADATA_COLUMNS) metadataValues.get(column)?.add(record[column].trim());
		}
		for (const [column, values] of metadataValues) {
			if (values.size !== 1 || values.has('')) fileErrors.push(message(column, `CSV must contain one consistent ${column} value.`));
		}

		const uploadedExportId = records[0]?.export_id.trim() || null;
		const uploadedMode = records[0]?.export_mode.trim() || null;
		const uploadedSnapshot = Number(records[0]?.membership_snapshot_version.trim() || NaN);
		const uploadedExportedAt = records[0]?.exported_at.trim() || null;

		if (!uploadedExportId || !UUID_PATTERN.test(uploadedExportId)) fileErrors.push(message('export_id', 'CSV export_id must be a valid UUID.'));
		if (!Number.isSafeInteger(uploadedSnapshot) || uploadedSnapshot <= 0) fileErrors.push(message('membership_snapshot_version', 'CSV membership_snapshot_version must be a positive integer.'));
		if (!uploadedExportedAt || !isIsoTimestampOrBlank(uploadedExportedAt)) fileErrors.push(message('exported_at', 'CSV exported_at must be a valid timestamp.'));
		if (uploadedMode !== 'editable' && uploadedMode !== 'read_only') fileErrors.push(message('export_mode', 'CSV export_mode must be editable or read_only.'));
		if (!sourceExport) {
			fileErrors.push(message('export_id', 'The source export could not be found for this workspace.'));
		} else {
			if (sourceExport.organisation_id !== context.organisationId) fileErrors.push(message('export_id', 'The source export belongs to a different workspace.'));
			if (uploadedExportId && uploadedExportId !== sourceExport.id) fileErrors.push(message('export_id', 'CSV export_id does not match the stored source export.'));
			if (uploadedMode !== sourceExport.export_mode) fileErrors.push(message('export_mode', 'CSV export_mode does not match the stored source export.'));
			if (uploadedSnapshot !== Number(sourceExport.membership_snapshot_version)) fileErrors.push(message('membership_snapshot_version', 'CSV snapshot version does not match the stored source export.'));
			if (uploadedExportedAt && uploadedExportedAt !== sourceExport.exported_at) fileErrors.push(message('exported_at', 'CSV exported_at does not match the stored source export.'));
			if (sourceExport.export_mode === 'read_only') fileErrors.push(message('export_mode', 'Read-only Workspace Team exports cannot be used for membership administration.'));
			if (sourceSuperseded) fileErrors.push(message('source_export_id', 'This team file has been superseded by a newer editable export and can no longer be used.'));
		}

		if (fileErrors.length === 0) {
			const seenMembershipRows = new Map<string, WorkspaceTeamImportRowEvidence[]>();
			const seenUserRows = new Map<string, WorkspaceTeamImportRowEvidence[]>();
			const seenEmailRows = new Map<string, WorkspaceTeamImportRowEvidence[]>();
			const retainedMembershipIds = new Set<string>();

			records.forEach((record, index) => {
				const sourceRowNumber = index + 2;
				const sourceForFormula = sourceRows.get(normaliseUuid(record.workspace_membership_id) ?? '');
				const normalised = Object.fromEntries(WORKSPACE_TEAM_CSV_COLUMNS.map((column) => {
					const sourceValue = snapshotValue(sourceForFormula, column);
					const uploadValue = normaliseUploadedValue(record[column], sourceValue);
					return [column, column === 'email' ? normaliseEmail(uploadValue.value) : uploadValue.value];
				})) as Record<WorkspaceTeamCsvColumn, string | null>;
				normalised.workspace_membership_id = normaliseUuid(normalised.workspace_membership_id);
				normalised.user_id = normaliseUuid(normalised.user_id);
				normalised.workspace_role = normaliseRole(normalised.workspace_role) ?? normalised.workspace_role;
				normalised.proposed_membership_action = normaliseAction(normalised.proposed_membership_action);

				const formulaSafety = Object.fromEntries(WORKSPACE_TEAM_CSV_COLUMNS.map((column) => {
					const sourceValue = snapshotValue(sourceForFormula, column);
					const uploadValue = normaliseUploadedValue(record[column], sourceValue);
					return [column, { reversed: uploadValue.reversed, formulaLike: uploadValue.formulaLike }];
				}));
				const row: WorkspaceTeamImportRowEvidence = {
					source_row_number: sourceRowNumber,
					supplied_membership_id: normalised.workspace_membership_id,
					supplied_user_id: normalised.user_id,
					raw_values: record,
					normalised_values: normalised,
					validation_state: 'valid',
					validation_messages: [],
					proposed_change_type: 'unchanged',
					source_export_values: sourceSnapshotObject(sourceForFormula),
					live_values: {},
					proposed_values: {},
					field_differences: [],
					is_unchanged: true,
					formula_safety: formulaSafety,
				};
				rows.push(row);

				const hasMembershipId = Boolean(normalised.workspace_membership_id);
				const hasUserId = Boolean(normalised.user_id);
				if (hasMembershipId !== hasUserId) addRowError(row, 'workspace_membership_id', 'Existing rows must keep both membership UUID and user UUID.');
				if (normalised.workspace_membership_id && !UUID_PATTERN.test(normalised.workspace_membership_id)) addRowError(row, 'workspace_membership_id', 'Membership UUID is not valid.');
				if (normalised.user_id && !UUID_PATTERN.test(normalised.user_id)) addRowError(row, 'user_id', 'User UUID is not valid.');

				if (hasMembershipId && hasUserId && normalised.workspace_membership_id && normalised.user_id) {
					retainedMembershipIds.add(normalised.workspace_membership_id);
					const sourceRow = sourceRows.get(normalised.workspace_membership_id);
					const liveRow = liveRows.get(normalised.workspace_membership_id);
					row.source_export_values = sourceSnapshotObject(sourceRow);
					row.live_values = sourceSnapshotObject(liveRow);
					if (!sourceRow) addRowError(row, 'workspace_membership_id', 'Membership UUID was not present in the source export.');
					if (sourceRow && sourceRow.user_id !== normalised.user_id) addRowError(row, 'user_id', 'User UUID does not match the source export membership.');
					if (!liveRow) addRowError(row, 'workspace_membership_id', 'Membership UUID is not present in the current workspace.');
					if (liveRow && liveRow.user_id !== normalised.user_id) addRowError(row, 'user_id', 'User UUID does not match the live workspace membership.');

					for (const column of PROTECTED_EXISTING_COLUMNS) {
						const uploadedValue = normalised[column] ?? null;
						const expectedValue = snapshotValue(sourceRow, column);
						if ((uploadedValue ?? '') !== (expectedValue ?? '')) {
							addRowError(row, column, `${column} is protected and cannot be changed in this CSV slice.`);
						}
					}
					for (const timestampColumn of ['exported_at', 'invited_at', 'invitation_expires_at', 'accepted_at', 'last_login_at', 'added_at', 'deactivated_at', 'reactivated_at'] as const) {
						if (!isIsoTimestampOrBlank(normalised[timestampColumn])) addRowError(row, timestampColumn, `${timestampColumn} must be blank or a valid timestamp.`);
					}

					if (normalised.proposed_membership_action === null) addRowError(row, 'proposed_membership_action', 'proposed_membership_action must be blank, none or reactivate.');
					if (normalised.proposed_membership_action === 'reactivate') {
						if ((liveRow?.membership_status ?? sourceRow?.membership_status) === 'deactivated') {
							row.proposed_change_type = 'reactivation';
							row.proposed_values = { membership_status: 'active' };
							row.is_unchanged = false;
						} else {
							addRowError(row, 'proposed_membership_action', 'Only deactivated memberships can request reactivation.');
						}
					}

					if (row.validation_state !== 'error' && row.proposed_change_type !== 'reactivation') {
						for (const field of ['first_name', 'last_name', 'email'] as const) {
							const uploadedValue = normalised[field] ?? null;
							const liveValue = snapshotValue(liveRow, field);
							if ((uploadedValue ?? '') !== (liveValue ?? '')) {
								row.field_differences.push({ field, from: liveValue, to: uploadedValue });
								row.proposed_values[field] = uploadedValue;
							}
						}
						if (row.field_differences.length > 0) {
							row.proposed_change_type = 'identity_correction';
							row.is_unchanged = false;
						}
					}
				} else if (!hasMembershipId && !hasUserId) {
					for (const column of NEW_ROW_PROTECTED_COLUMNS) {
						if (normalised[column]) addRowError(row, column, `${column} must be blank for new-person rows.`);
					}
					if (!normalised.first_name) addRowError(row, 'first_name', 'First name is required for a new workspace person.');
					if (!normalised.last_name) addRowError(row, 'last_name', 'Last name is required for a new workspace person.');
					if (!normalised.email || !EMAIL_PATTERN.test(normalised.email)) addRowError(row, 'email', 'A valid contact email is required for a new workspace person.');
					if (normalised.workspace_role && !WORKSPACE_ROLES.includes(normalised.workspace_role as WorkspaceRole)) {
						addRowError(row, 'workspace_role', 'Workspace role must be owner, admin, member or viewer when supplied.');
					}
					if (normalised.proposed_membership_action !== 'none') addRowError(row, 'proposed_membership_action', 'New-person rows cannot request reactivation.');
					if (row.validation_state !== 'error') {
						row.proposed_change_type = 'addition';
						row.proposed_values = {
							first_name: normalised.first_name,
							last_name: normalised.last_name,
							email: normalised.email,
							workspace_role: normaliseRole(normalised.workspace_role) ?? 'viewer',
						};
						row.is_unchanged = false;
					}
				}

				for (const [value, map] of [
					[normalised.workspace_membership_id, seenMembershipRows],
					[normalised.user_id, seenUserRows],
					[normalised.email, seenEmailRows],
				] as const) {
					if (!value) continue;
					const existingRows = map.get(value) ?? [];
					existingRows.push(row);
					map.set(value, existingRows);
				}
			});

			for (const duplicateRows of seenMembershipRows.values()) {
				if (duplicateRows.length > 1) duplicateRows.forEach((row) => addRowError(row, 'workspace_membership_id', 'Duplicate membership UUID in uploaded file.'));
			}
			for (const duplicateRows of seenUserRows.values()) {
				if (duplicateRows.length > 1) duplicateRows.forEach((row) => addRowError(row, 'user_id', 'Duplicate user UUID in uploaded file.'));
			}
			if (!context.allowSharedContactEmail) {
				for (const duplicateRows of seenEmailRows.values()) {
					const identities = new Set(duplicateRows.map((row) => row.supplied_membership_id ?? rowIdentity(row.normalised_values)));
					if (identities.size > 1) duplicateRows.forEach((row) => addRowError(row, 'email', 'Duplicate contact email is not allowed for different people in this workspace.'));
				}
			}

			if (!rows.some((row) => row.validation_state === 'error')) {
				for (const sourceRow of sourceRows.values()) {
					if (retainedMembershipIds.has(sourceRow.workspace_membership_id)) continue;
					const liveRow = liveRows.get(sourceRow.workspace_membership_id);
					if ((liveRow?.membership_status ?? sourceRow.membership_status) === 'deactivated') continue;
					rows.push({
						source_row_number: sourceRow.source_row_number ?? 1,
						supplied_membership_id: sourceRow.workspace_membership_id,
						supplied_user_id: sourceRow.user_id,
						raw_values: {},
						normalised_values: {},
						validation_state: 'warning',
						validation_messages: [message('workspace_membership_id', 'Source export row is absent from the uploaded CSV; this is a proposed deactivation only.')],
						proposed_change_type: 'deactivation',
						source_export_values: sourceSnapshotObject(sourceRow),
						live_values: sourceSnapshotObject(liveRow),
						proposed_values: { membership_status: 'deactivated' },
						field_differences: [{ field: 'membership_status', from: liveRow?.membership_status ?? sourceRow.membership_status, to: 'deactivated' }],
						is_unchanged: false,
						formula_safety: {},
					});
				}
			}
		}
	}

	for (const row of rows) {
		if (row.validation_state === 'error') summary.invalid_rows += 1;
		else summary.valid_rows += 1;
		if (row.validation_state === 'warning') summary.warnings += 1;
		if (row.is_unchanged) summary.unchanged += 1;
		if (row.proposed_change_type === 'addition') summary.additions += 1;
		if (row.proposed_change_type === 'identity_correction') {
			summary.identity_corrections += 1;
			if (row.field_differences.some((difference) => difference.field === 'first_name' || difference.field === 'last_name')) summary.name_corrections += 1;
			if (row.field_differences.some((difference) => difference.field === 'email')) summary.email_corrections += 1;
		}
		if (row.proposed_change_type === 'deactivation') summary.deactivations += 1;
		if (row.proposed_change_type === 'reactivation') summary.reactivations += 1;
	}
	summary.total_rows = rows.length || parsed.rows.length;

	const result: WorkspaceTeamImportValidationResult = {
		status: 'validation_failed',
		fileErrors,
		warnings,
		sourceExportId,
		sourceSnapshotVersion: Number.isSafeInteger(sourceSnapshotVersion) ? sourceSnapshotVersion : null,
		liveSnapshotVersion: liveSnapshotVersion && Number.isSafeInteger(liveSnapshotVersion) ? liveSnapshotVersion : null,
		checkoutExpired,
		sourceStale,
		sourceSuperseded,
		summary,
		rows,
	};
	result.status = deriveStatus(result);
	return result;
}
