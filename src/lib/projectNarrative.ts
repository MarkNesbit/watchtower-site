import { assertCan, type WorkspaceRole } from './permissions.ts';

export const NARRATIVE_SOURCE_TYPES = ['manual', 'risk', 'issue', 'dependency', 'assumption', 'system'] as const;
export type NarrativeSourceType = (typeof NARRATIVE_SOURCE_TYPES)[number];

export const NARRATIVE_ATTENTION_LEVELS = ['neutral', 'green', 'amber', 'red'] as const;
export type NarrativeAttentionLevel = (typeof NARRATIVE_ATTENTION_LEVELS)[number];

export type ProjectNarrativeEntryInput = {
	projectId: string;
	sourceType?: NarrativeSourceType;
	sourceRecordId?: string | null;
	sourceRef?: string | null;
	attentionLevel?: NarrativeAttentionLevel;
	title?: string | null;
	details?: string | null;
	createdTimezone?: string | null;
};

export function isNarrativeSourceType(value: unknown): value is NarrativeSourceType {
	return typeof value === 'string' && NARRATIVE_SOURCE_TYPES.includes(value as NarrativeSourceType);
}

export function isNarrativeAttentionLevel(value: unknown): value is NarrativeAttentionLevel {
	return typeof value === 'string' && NARRATIVE_ATTENTION_LEVELS.includes(value as NarrativeAttentionLevel);
}

function cleanOptionalText(value: string | null | undefined): string | null {
	return value?.trim() || null;
}

export async function listProjectNarrativeEntries(
	organisationId: string,
	projectId: string,
	workspaceRole: WorkspaceRole,
	client,
) {
	assertCan(workspaceRole, 'narrative.view', 'Your workspace role does not permit Project Narrative access.');

	const { data, error } = await client
		.from('project_narrative_entries')
		.select(
			'id, organisation_id, project_id, entry_number, narrative_ref, source_type, source_record_id, source_ref, attention_level, title, details, created_by, updated_by, created_at, updated_at, created_timezone, updated_timezone',
		)
		.eq('organisation_id', organisationId)
		.eq('project_id', projectId)
		.order('created_at', { ascending: false })
		.order('entry_number', { ascending: false });

	if (error) throw error;
	return data ?? [];
}

export async function createProjectNarrativeEntry(
	input: ProjectNarrativeEntryInput,
	workspaceRole: WorkspaceRole,
	client,
) {
	assertCan(workspaceRole, 'narrative.create', 'Your workspace role does not permit Project Narrative entry creation.');

	const sourceType = input.sourceType ?? 'manual';
	const attentionLevel = input.attentionLevel ?? 'neutral';
	if (!isNarrativeSourceType(sourceType)) throw new Error('Select a valid Project Narrative source type.');
	if (!isNarrativeAttentionLevel(attentionLevel)) throw new Error('Select a valid Project Narrative attention level.');

	const title = cleanOptionalText(input.title);
	const details = cleanOptionalText(input.details);
	if (!title && !details) throw new Error('A Project Narrative entry requires a title or details.');

	const { data, error } = await client
		.from('project_narrative_entries')
		.insert({
			project_id: input.projectId,
			source_type: sourceType,
			source_record_id: input.sourceRecordId ?? null,
			source_ref: cleanOptionalText(input.sourceRef),
			attention_level: attentionLevel,
			title,
			details,
			created_timezone: cleanOptionalText(input.createdTimezone),
		})
		.select(
			'id, organisation_id, project_id, entry_number, narrative_ref, source_type, source_record_id, source_ref, attention_level, title, details, created_by, created_at, created_timezone',
		)
		.single();

	if (error) throw error;
	return data;
}
