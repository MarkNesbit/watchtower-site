import { WORKSPACE_ROLES, isWorkspaceRole, type WorkspaceRole } from './permissions.ts';
import { getInternalRoleSimulationState } from './internalTesting.ts';

export const DEMO_PEOPLE_REQUIRED_COLUMNS = ['display_name', 'email', 'notification_email', 'workspace_role'] as const;
export const DEMO_PEOPLE_OPTIONAL_COLUMNS = ['project_role', 'is_default_risk_owner', 'is_default_risk_actioner', 'notes'] as const;
export const DEMO_PERSON_IMPORT_COLUMNS = [...DEMO_PEOPLE_REQUIRED_COLUMNS, ...DEMO_PEOPLE_OPTIONAL_COLUMNS] as const;

export type DemoPerson = {
	id?: string;
	organisation_id?: string;
	display_name: string;
	email: string;
	notification_email: string;
	workspace_role: Exclude<WorkspaceRole, 'owner'>;
	project_role?: string | null;
	is_default_risk_owner: boolean;
	is_default_risk_actioner: boolean;
	notes?: string | null;
	status: 'active' | 'removed';
	is_demo_person: true;
	linked_profile_id?: string | null;
};

export type DemoPersonCsvRow = DemoPerson & {
	rowNumber: number;
};

export type DemoPersonCsvError = {
	rowNumber: number;
	field?: string;
	message: string;
};

export type DemoPeopleCsvValidation = {
	rows: DemoPersonCsvRow[];
	errors: DemoPersonCsvError[];
	headers: string[];
};

function splitCsvLine(line: string): string[] {
	const values: string[] = [];
	let value = '';
	let inQuotes = false;

	for (let index = 0; index < line.length; index += 1) {
		const char = line[index];
		const nextChar = line[index + 1];
		if (char === '"' && inQuotes && nextChar === '"') {
			value += '"';
			index += 1;
		} else if (char === '"') {
			inQuotes = !inQuotes;
		} else if (char === ',' && !inQuotes) {
			values.push(value);
			value = '';
		} else {
			value += char;
		}
	}

	values.push(value);
	return values.map((item) => item.trim());
}

function normaliseHeader(value: string): string {
	return value.trim().toLowerCase();
}

function cleanOptionalText(value: string | undefined): string | null {
	return value?.trim() || null;
}

function parseBoolean(value: string | undefined): boolean {
	const normalised = value?.trim().toLowerCase();
	return normalised === 'true' || normalised === 'yes' || normalised === '1';
}

function looksLikeEmail(value: string): boolean {
	return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export function parseDemoPeopleCsv(csvText: string): DemoPeopleCsvValidation {
	const lines = csvText
		.replace(/^\uFEFF/, '')
		.split(/\r?\n/)
		.filter((line) => line.trim().length > 0);

	if (lines.length === 0) {
		return { rows: [], errors: [{ rowNumber: 1, message: 'CSV file is empty.' }], headers: [] };
	}

	const headers = splitCsvLine(lines[0]).map(normaliseHeader);
	const errors: DemoPersonCsvError[] = [];
	const rows: DemoPersonCsvRow[] = [];

	for (const column of DEMO_PEOPLE_REQUIRED_COLUMNS) {
		if (!headers.includes(column)) {
			errors.push({ rowNumber: 1, field: column, message: `Missing required column: ${column}.` });
		}
	}

	const seenEmails = new Set<string>();
	for (let lineIndex = 1; lineIndex < lines.length; lineIndex += 1) {
		const rowNumber = lineIndex + 1;
		const values = splitCsvLine(lines[lineIndex]);
		const record = Object.fromEntries(headers.map((header, index) => [header, values[index] ?? '']));
		const displayName = String(record.display_name ?? '').trim();
		const email = String(record.email ?? '').trim().toLowerCase();
		const notificationEmail = String(record.notification_email ?? '').trim().toLowerCase();
		const workspaceRole = String(record.workspace_role ?? '').trim().toLowerCase();

		if (!displayName) errors.push({ rowNumber, field: 'display_name', message: 'Display name is required.' });
		if (!email) {
			errors.push({ rowNumber, field: 'email', message: 'Email is required.' });
		} else if (!looksLikeEmail(email)) {
			errors.push({ rowNumber, field: 'email', message: 'Email must be a valid address.' });
		}
		if (!notificationEmail) {
			errors.push({ rowNumber, field: 'notification_email', message: 'Notification email is required.' });
		} else if (!looksLikeEmail(notificationEmail)) {
			errors.push({ rowNumber, field: 'notification_email', message: 'Notification email must be a valid address.' });
		}
		if (!isWorkspaceRole(workspaceRole)) {
			errors.push({ rowNumber, field: 'workspace_role', message: `Workspace role must be one of ${WORKSPACE_ROLES.join(', ')}.` });
		} else if (workspaceRole === 'owner') {
			errors.push({ rowNumber, field: 'workspace_role', message: 'Owner demo personas are blocked for MVP safety.' });
		}
		if (email && seenEmails.has(email)) {
			errors.push({ rowNumber, field: 'email', message: 'Email must be unique within this import.' });
		}
		seenEmails.add(email);

		if (displayName && email && notificationEmail && isWorkspaceRole(workspaceRole) && workspaceRole !== 'owner') {
			rows.push({
				rowNumber,
				display_name: displayName,
				email,
				notification_email: notificationEmail,
				workspace_role: workspaceRole,
				project_role: cleanOptionalText(record.project_role),
				is_default_risk_owner: parseBoolean(record.is_default_risk_owner),
				is_default_risk_actioner: parseBoolean(record.is_default_risk_actioner),
				notes: cleanOptionalText(record.notes),
				status: 'active',
				is_demo_person: true,
				linked_profile_id: null,
			});
		}
	}

	return { rows, errors, headers };
}

export async function listWorkspaceDemoPeople(client, accessToken?: string): Promise<DemoPerson[]> {
	const state = await getInternalRoleSimulationState(client, accessToken);
	if (!state.isInternalTester || !state.workspace) return [];

	const { data, error } = await client
		.from('workspace_demo_people')
		.select('id, organisation_id, display_name, email, notification_email, workspace_role, project_role, is_default_risk_owner, is_default_risk_actioner, notes, status, is_demo_person, linked_profile_id')
		.eq('organisation_id', state.workspace.id)
		.eq('is_demo_person', true)
		.eq('status', 'active')
		.order('display_name', { ascending: true });

	if (error) throw error;
	return (data ?? []) as DemoPerson[];
}

export async function replaceWorkspaceDemoPeople(client, rows: DemoPersonCsvRow[], accessToken?: string): Promise<DemoPerson[]> {
	const state = await getInternalRoleSimulationState(client, accessToken);
	if (!state.isInternalTester || !state.workspace) {
		throw new Error('Demo people import is not available for this account or workspace.');
	}
	if (rows.length === 0) throw new Error('Import at least one valid demo person.');

	const { error: resetError } = await client
		.from('internal_role_simulations')
		.update({ is_active: false })
		.eq('organisation_id', state.workspace.id)
		.eq('is_active', true);
	if (resetError) throw resetError;

	const { error: deleteError } = await client
		.from('workspace_demo_people')
		.delete()
		.eq('organisation_id', state.workspace.id)
		.eq('is_demo_person', true);
	if (deleteError) throw deleteError;

	const payload = rows.map((row) => ({
		organisation_id: state.workspace?.id,
		display_name: row.display_name,
		email: row.email,
		notification_email: row.notification_email,
		workspace_role: row.workspace_role,
		project_role: row.project_role,
		is_default_risk_owner: row.is_default_risk_owner,
		is_default_risk_actioner: row.is_default_risk_actioner,
		notes: row.notes,
		status: 'active',
		is_demo_person: true,
		linked_profile_id: null,
	}));

	const { data, error } = await client
		.from('workspace_demo_people')
		.insert(payload)
		.select('id, organisation_id, display_name, email, notification_email, workspace_role, project_role, is_default_risk_owner, is_default_risk_actioner, notes, status, is_demo_person, linked_profile_id');
	if (error) throw error;
	return (data ?? []) as DemoPerson[];
}
