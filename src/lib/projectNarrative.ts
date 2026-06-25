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
	links?: ProjectNarrativeEntryLinkInput[];
};

export type ProjectNarrativeEntryLinkInput = {
	label?: string | null;
	url?: string | null;
};

export type NormalisedProjectNarrativeLink = {
	label: string;
	url: string;
};

export function isNarrativeSourceType(value: unknown): value is NarrativeSourceType {
	return typeof value === 'string' && NARRATIVE_SOURCE_TYPES.includes(value as NarrativeSourceType);
}

export function isNarrativeAttentionLevel(value: unknown): value is NarrativeAttentionLevel {
	return typeof value === 'string' && NARRATIVE_ATTENTION_LEVELS.includes(value as NarrativeAttentionLevel);
}

export function getNarrativeDisplayRef(entry: { source_ref?: string | null; narrative_ref: string }): string {
	return entry.source_ref?.trim() || entry.narrative_ref;
}

function cleanOptionalText(value: string | null | undefined): string | null {
	return value?.trim() || null;
}

export function normaliseProjectNarrativeLinkUrl(value: string | null | undefined): string {
	const url = cleanOptionalText(value);
	if (!url) throw new Error('Link URL is required when adding a link.');

	let parsedUrl: URL;
	try {
		parsedUrl = new URL(url);
	} catch {
		throw new Error('Enter a valid link URL.');
	}

	if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
		throw new Error('Enter a safe link URL that starts with http:// or https://.');
	}

	return parsedUrl.href;
}

export function normaliseProjectNarrativeLinks(
	links: ProjectNarrativeEntryLinkInput[] | null | undefined,
): NormalisedProjectNarrativeLink[] {
	return (links ?? []).map((link) => {
		const label = cleanOptionalText(link.label);
		if (!label) throw new Error('Link label is required when adding a link.');
		return {
			label,
			url: normaliseProjectNarrativeLinkUrl(link.url),
		};
	});
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
			'id, organisation_id, project_id, entry_number, narrative_ref, source_type, source_record_id, source_ref, attention_level, title, details, created_by, updated_by, created_at, updated_at, created_timezone, updated_timezone, creator:profiles!project_narrative_entries_created_by_fkey(display_name, email), updater:profiles!project_narrative_entries_updated_by_fkey(display_name, email), links:project_narrative_entry_links(id, label, url, created_at)',
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
	if (!title) throw new Error('Title is required.');
	if (!details) throw new Error('Details are required.');
	const links = normaliseProjectNarrativeLinks(input.links);

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

	if (links.length > 0) {
		const { data: createdLinks, error: linkError } = await client
			.from('project_narrative_entry_links')
			.insert(
				links.map((link) => ({
					organisation_id: data.organisation_id,
					project_id: data.project_id,
					narrative_entry_id: data.id,
					label: link.label,
					url: link.url,
				})),
			)
			.select('id, organisation_id, project_id, narrative_entry_id, label, url, created_by, created_at');

		if (linkError) throw linkError;
		return { ...data, links: createdLinks ?? [] };
	}

	return { ...data, links: [] };
}
