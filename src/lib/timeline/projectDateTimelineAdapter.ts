import { can, type WorkspaceRole } from '../permissions.ts';
import {
	deriveProjectDateStatus,
	normaliseProjectDateType,
	projectDateStatusLabel,
	projectDateTypeLabel,
	projectDateWarningDays,
	type ProjectDateRecord,
	type ProjectDateType,
} from '../projectDates.ts';
import type { TimelineAdapterContext, TimelineSourceAdapter } from './timelineAdapter.ts';
import type { TimelineAttentionTone, TimelineEvent } from './timelineTypes.ts';
import { getTimelineEventEndDate, normaliseTimelineEvent } from './timelineValidation.ts';

export type ProjectDateTimelinePresentation = {
	label: string;
	shortCode: string;
	iconKey: string;
};

export const PROJECT_DATE_TIMELINE_PRESENTATION: Record<ProjectDateType, ProjectDateTimelinePresentation> = {
	'project-start': { label: 'Project start', shortCode: 'START', iconKey: 'project-start' },
	'target-end': { label: 'Target end', shortCode: 'END', iconKey: 'target-end' },
	review: { label: 'Review', shortCode: 'REV', iconKey: 'review' },
	gateway: { label: 'Gateway', shortCode: 'GATE', iconKey: 'gateway' },
	milestone: { label: 'Milestone', shortCode: 'MILE', iconKey: 'milestone' },
	uat: { label: 'UAT', shortCode: 'UAT', iconKey: 'uat' },
	testing: { label: 'Testing', shortCode: 'TEST', iconKey: 'testing' },
	'load-testing': { label: 'Load testing', shortCode: 'LOAD', iconKey: 'load-testing' },
	integration: { label: 'Integration', shortCode: 'INT', iconKey: 'integration' },
	deployment: { label: 'Deployment', shortCode: 'DEPLOY', iconKey: 'deployment' },
	cutover: { label: 'Cutover', shortCode: 'CUT', iconKey: 'cutover' },
	training: { label: 'Training', shortCode: 'TRN', iconKey: 'training' },
	'go-live': { label: 'Go-live', shortCode: 'LIVE', iconKey: 'go-live' },
	hypercare: { label: 'Hypercare', shortCode: 'HYP', iconKey: 'hypercare' },
	other: { label: 'Other', shortCode: 'DATE', iconKey: 'project-date' },
};

const PROJECT_DATE_TIMELINE_SELECT = [
	'id',
	'organisation_id',
	'project_id',
	'date_type',
	'custom_label',
	'title',
	'start_date',
	'target_date',
	'end_date',
	'description',
	'status',
	'show_on_timeline',
	'warning_days',
	'is_key_date',
	'created_by',
	'updated_by',
	'created_at',
	'updated_at',
	'removed_at',
].join(', ');

function projectDateStartDate(record: Pick<ProjectDateRecord, 'start_date' | 'target_date'>): string | null {
	return record.start_date ?? record.target_date ?? null;
}

function projectDateOverlapsVisibleRange(record: ProjectDateRecord, visibleStartDate: string, visibleEndDate: string): boolean {
	const startDate = projectDateStartDate(record);
	if (!startDate) return false;
	const endDate = record.end_date ?? startDate;
	return startDate <= visibleEndDate && endDate >= visibleStartDate;
}

export function projectDateTimelinePresentation(dateType: unknown, customLabel?: string | null): ProjectDateTimelinePresentation {
	const category = normaliseProjectDateType(dateType) ?? 'other';
	const presentation = PROJECT_DATE_TIMELINE_PRESENTATION[category];
	if (category === 'other' && customLabel?.trim()) return { ...presentation, label: customLabel.trim() };
	return presentation;
}

export function projectDateTimelineAttention(record: ProjectDateRecord, now = new Date()): TimelineAttentionTone {
	const category = normaliseProjectDateType(record.date_type) ?? 'other';
	if (record.status === 'delayed') return 'red';
	if (record.status === 'at-risk') return 'amber';
	if (record.status === 'cancelled' || record.status === 'complete') return 'neutral';

	const startDate = projectDateStartDate(record);
	const readiness = deriveProjectDateStatus(startDate, projectDateWarningDays(category), now, category);
	if (readiness.tone === 'red' || readiness.tone === 'amber') return readiness.tone;
	if (readiness.text === 'Green - started' || readiness.text === 'Green - starting today') return 'green';
	return 'neutral';
}

export function mapProjectDateToTimelineEvent(
	record: ProjectDateRecord,
	context: Pick<TimelineAdapterContext, 'workspaceId' | 'projectId'>,
	options: { canEdit: boolean; now?: Date } = { canEdit: false },
): TimelineEvent | null {
	const category = normaliseProjectDateType(record.date_type);
	const startDate = projectDateStartDate(record);
	if (!category || !startDate || record.removed_at || record.show_on_timeline === false) return null;
	const presentation = projectDateTimelinePresentation(category, record.custom_label);
	const title = record.title?.trim() || projectDateTypeLabel(category, record.custom_label);
	const event = normaliseTimelineEvent({
		id: `project-date:${record.id}`,
		workspaceId: record.organisation_id,
		projectId: record.project_id,
		sourceType: 'project-date',
		sourceId: record.id,
		title,
		summary: record.description?.trim() || undefined,
		category: presentation.label,
		startDate,
		endDate: record.end_date ?? undefined,
		allDay: true,
		presentationType: record.end_date && record.end_date > startDate ? 'range' : 'point',
		status: projectDateStatusLabel(record.status),
		attentionTone: projectDateTimelineAttention(record, options.now),
		layer: 'project-delivery',
		iconKey: presentation.iconKey,
		modalKey: 'project-date',
		canView: record.organisation_id === context.workspaceId && record.project_id === context.projectId,
		canEdit: options.canEdit,
		canMove: false,
		lockedReason: 'Project Dates remain the source of truth. Rescheduling from Timeline is not available in this slice.',
	});
	return event;
}

export function createProjectDateTimelineAdapter(options: {
	client: any;
	workspaceRole?: WorkspaceRole | string | null;
	canEditProjectDates?: boolean;
	now?: Date;
}): TimelineSourceAdapter {
	return {
		sourceType: 'project-date',
		getEvents: async (context) => {
			if (!can(options.workspaceRole, 'project.view')) return [];
			const { data, error } = await options.client
				.from('project_dates')
				.select(PROJECT_DATE_TIMELINE_SELECT)
				.eq('organisation_id', context.workspaceId)
				.eq('project_id', context.projectId)
				.is('removed_at', null)
				.eq('show_on_timeline', true)
				.lte('start_date', context.visibleEndDate)
				.or(`end_date.gte.${context.visibleStartDate},and(end_date.is.null,start_date.gte.${context.visibleStartDate})`)
				.order('start_date', { ascending: true, nullsFirst: false })
				.order('created_at', { ascending: true });
			if (error) throw error;
			return ((data ?? []) as ProjectDateRecord[])
				.filter((record) => projectDateOverlapsVisibleRange(record, context.visibleStartDate, context.visibleEndDate))
				.map((record) => mapProjectDateToTimelineEvent(record, context, {
					canEdit: Boolean(options.canEditProjectDates),
					now: options.now,
				}))
				.filter((event): event is TimelineEvent => Boolean(event))
				.filter((event) => getTimelineEventEndDate(event) >= context.visibleStartDate && event.startDate <= context.visibleEndDate);
		},
	};
}
