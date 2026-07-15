export const TIMELINE_SOURCE_TYPES = [
	'project-date',
	'risk',
	'issue',
	'dependency',
	'assumption',
	'decision',
	'action',
	'project-event',
	'delivery-period',
] as const;

export type TimelineSourceType = (typeof TIMELINE_SOURCE_TYPES)[number];

export const TIMELINE_PRESENTATION_TYPES = ['point', 'range'] as const;
export type TimelinePresentationType = (typeof TIMELINE_PRESENTATION_TYPES)[number];

export const TIMELINE_ATTENTION_TONES = ['red', 'amber', 'green', 'neutral'] as const;
export type TimelineAttentionTone = (typeof TIMELINE_ATTENTION_TONES)[number];

export type TimelineEvent = {
	id: string;
	workspaceId: string;
	projectId: string;
	sourceType: TimelineSourceType;
	sourceId: string;
	sourceReference?: string;
	title: string;
	summary?: string;
	category?: string;
	startDate: string;
	endDate?: string;
	allDay: boolean;
	presentationType: TimelinePresentationType;
	status?: string;
	attentionTone?: TimelineAttentionTone;
	layer: string;
	iconKey: string;
	modalKey?: string;
	route?: string;
	canView: boolean;
	canEdit: boolean;
	canMove: boolean;
	lockedReason?: string;
	seriesId?: string;
	occurrenceId?: string;
	originalOccurrenceDate?: string;
};

export type TimelineDateRange = {
	startDate: string;
	endDate: string;
};

export function isTimelineSourceType(value: unknown): value is TimelineSourceType {
	return typeof value === 'string' && TIMELINE_SOURCE_TYPES.includes(value as TimelineSourceType);
}

export function isTimelinePresentationType(value: unknown): value is TimelinePresentationType {
	return typeof value === 'string' && TIMELINE_PRESENTATION_TYPES.includes(value as TimelinePresentationType);
}

export function isTimelineAttentionTone(value: unknown): value is TimelineAttentionTone {
	return typeof value === 'string' && TIMELINE_ATTENTION_TONES.includes(value as TimelineAttentionTone);
}
