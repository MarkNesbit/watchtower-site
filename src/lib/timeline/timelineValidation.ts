import type { TimelineDateRange, TimelineEvent } from './timelineTypes.ts';

const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function isProjectDateOnly(value: unknown): value is string {
	if (typeof value !== 'string' || !DATE_ONLY_PATTERN.test(value)) return false;
	const date = new Date(`${value}T00:00:00Z`);
	return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function assertProjectDateOnly(value: unknown, fieldLabel: string): asserts value is string {
	if (!isProjectDateOnly(value)) throw new Error(`${fieldLabel} must use YYYY-MM-DD date format.`);
}

export function normaliseTimelineDateRange(range: TimelineDateRange): TimelineDateRange {
	assertProjectDateOnly(range.startDate, 'Visible start date');
	assertProjectDateOnly(range.endDate, 'Visible end date');
	if (range.endDate < range.startDate) throw new Error('Visible end date cannot be before visible start date.');
	return range;
}

export function getTimelineEventEndDate(event: Pick<TimelineEvent, 'startDate' | 'endDate'>): string {
	return event.endDate ?? event.startDate;
}

export function normaliseTimelineEvent(event: TimelineEvent): TimelineEvent {
	assertProjectDateOnly(event.startDate, 'Timeline event start date');
	if (event.endDate !== undefined) assertProjectDateOnly(event.endDate, 'Timeline event end date');

	const endDate = getTimelineEventEndDate(event);
	if (endDate < event.startDate) throw new Error('Timeline event end date cannot be before start date.');

	if (!event.title.trim()) throw new Error('Timeline event title is required.');
	if (!event.id.trim()) throw new Error('Timeline event id is required.');
	if (!event.workspaceId.trim()) throw new Error('Timeline event workspace id is required.');
	if (!event.projectId.trim()) throw new Error('Timeline event project id is required.');
	if (!event.sourceId.trim()) throw new Error('Timeline event source id is required.');
	if (!event.layer.trim()) throw new Error('Timeline event layer is required.');
	if (!event.iconKey.trim()) throw new Error('Timeline event icon key is required.');

	const isSingleDay = endDate === event.startDate;
	if (isSingleDay) {
		const { endDate: _sameDayEndDate, ...pointEvent } = event;
		return { ...pointEvent, presentationType: 'point' };
	}

	if (event.presentationType !== 'range') {
		return { ...event, endDate, presentationType: 'range' };
	}

	return { ...event, endDate };
}
