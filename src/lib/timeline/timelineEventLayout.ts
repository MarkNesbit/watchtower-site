import { DEFAULT_TIMELINE_LAYERS, timelineLayerOrder, type TimelineLayerDefinition, type TimelineLayerKey } from './timelineLayers.ts';
import type { TimelineEvent } from './timelineTypes.ts';
import { getTimelineEventEndDate } from './timelineValidation.ts';
import type { TimelineCalendarWeek } from './timelineCalendarGrid.ts';

export const TIMELINE_RANGE_LANE_LIMIT = 3;
export const TIMELINE_POINT_EVENT_LIMIT = 4;

export type TimelineRangeSegment = {
	event: TimelineEvent;
	eventId: string;
	weekIndex: number;
	startColumn: number;
	endColumn: number;
	visibleStartDate: string;
	visibleEndDate: string;
	isTrueStart: boolean;
	isTrueEnd: boolean;
	continuesFromPreviousRow: boolean;
	continuesToNextRow: boolean;
	lane?: number;
	isVisible?: boolean;
};

export type TimelinePanelGroup = {
	layer: TimelineLayerDefinition;
	events: TimelineEvent[];
};

const attentionRank: Record<string, number> = {
	red: 0,
	amber: 1,
	green: 2,
	neutral: 3,
};

function compareTimelineDisplayEvents(left: TimelineEvent, right: TimelineEvent, layers: readonly TimelineLayerDefinition[]): number {
	if (left.presentationType !== right.presentationType) return left.presentationType === 'range' ? -1 : 1;
	const toneDifference = (attentionRank[left.attentionTone ?? 'neutral'] ?? 3) - (attentionRank[right.attentionTone ?? 'neutral'] ?? 3);
	if (toneDifference !== 0) return toneDifference;
	if (left.startDate !== right.startDate) return left.startDate.localeCompare(right.startDate);
	const layerDifference = timelineLayerOrder(left.layer, layers) - timelineLayerOrder(right.layer, layers);
	if (layerDifference !== 0) return layerDifference;
	const leftLabel = left.sourceReference || left.title || left.id;
	const rightLabel = right.sourceReference || right.title || right.id;
	const labelDifference = leftLabel.localeCompare(rightLabel);
	if (labelDifference !== 0) return labelDifference;
	return left.id.localeCompare(right.id);
}

function dateRangeContains(event: TimelineEvent, date: string): boolean {
	return event.startDate <= date && getTimelineEventEndDate(event) >= date;
}

function datesForSegment(segment: Pick<TimelineRangeSegment, 'visibleStartDate' | 'visibleEndDate'>): string[] {
	const dates: string[] = [];
	const current = new Date(`${segment.visibleStartDate}T00:00:00Z`);
	const end = new Date(`${segment.visibleEndDate}T00:00:00Z`);
	while (current <= end) {
		dates.push(current.toISOString().slice(0, 10));
		current.setUTCDate(current.getUTCDate() + 1);
	}
	return dates;
}

export function getDefaultVisibleTimelineLayerKeys(layers: readonly TimelineLayerDefinition[] = DEFAULT_TIMELINE_LAYERS): TimelineLayerKey[] {
	return layers.filter((layer) => layer.enabled && layer.defaultVisible).map((layer) => layer.key);
}

export function filterTimelineEventsByLayers(events: readonly TimelineEvent[], visibleLayerKeys: readonly string[]): TimelineEvent[] {
	const visibleLayers = new Set(visibleLayerKeys);
	return events.filter((event) => visibleLayers.has(event.layer));
}

export function sortTimelineEventsForDisplay(
	events: readonly TimelineEvent[],
	layers: readonly TimelineLayerDefinition[] = DEFAULT_TIMELINE_LAYERS,
): TimelineEvent[] {
	return [...events].sort((left, right) => compareTimelineDisplayEvents(left, right, layers));
}

export function getTimelineEventsActiveOnDate(
	events: readonly TimelineEvent[],
	date: string,
	layers: readonly TimelineLayerDefinition[] = DEFAULT_TIMELINE_LAYERS,
): TimelineEvent[] {
	return sortTimelineEventsForDisplay(events.filter((event) => dateRangeContains(event, date)), layers);
}

export function getTimelinePointEventsByDate(
	weeks: readonly TimelineCalendarWeek[],
	events: readonly TimelineEvent[],
	layers: readonly TimelineLayerDefinition[] = DEFAULT_TIMELINE_LAYERS,
): Map<string, TimelineEvent[]> {
	const visibleDates = new Set(weeks.flatMap((week) => week.days.map((day) => day.date)));
	const eventsByDate = new Map<string, TimelineEvent[]>();
	for (const event of events) {
		if (event.presentationType !== 'point' || !visibleDates.has(event.startDate)) continue;
		const dateEvents = eventsByDate.get(event.startDate) ?? [];
		dateEvents.push(event);
		eventsByDate.set(event.startDate, dateEvents);
	}
	for (const [date, dateEvents] of eventsByDate.entries()) {
		eventsByDate.set(date, sortTimelineEventsForDisplay(dateEvents, layers));
	}
	return eventsByDate;
}

export function getTimelinePointOverflowCount(events: readonly TimelineEvent[], limit = TIMELINE_POINT_EVENT_LIMIT): number {
	return Math.max(0, events.length - limit);
}

export function segmentTimelineRangeEventsByWeek(
	weeks: readonly TimelineCalendarWeek[],
	events: readonly TimelineEvent[],
	layers: readonly TimelineLayerDefinition[] = DEFAULT_TIMELINE_LAYERS,
): TimelineRangeSegment[] {
	const rangeEvents = sortTimelineEventsForDisplay(events.filter((event) => event.presentationType === 'range'), layers);
	const segments: TimelineRangeSegment[] = [];

	for (const event of rangeEvents) {
		const eventEndDate = getTimelineEventEndDate(event);
		weeks.forEach((week, weekIndex) => {
			const weekStartDate = week.days[0]?.date;
			const weekEndDate = week.days.at(-1)?.date;
			if (!weekStartDate || !weekEndDate || event.startDate > weekEndDate || eventEndDate < weekStartDate) return;

			const visibleStartDate = event.startDate > weekStartDate ? event.startDate : weekStartDate;
			const visibleEndDate = eventEndDate < weekEndDate ? eventEndDate : weekEndDate;
			const startColumn = week.days.findIndex((day) => day.date === visibleStartDate);
			const endColumn = week.days.findIndex((day) => day.date === visibleEndDate);
			if (startColumn < 0 || endColumn < 0) return;

			segments.push({
				event,
				eventId: event.id,
				weekIndex,
				startColumn,
				endColumn,
				visibleStartDate,
				visibleEndDate,
				isTrueStart: visibleStartDate === event.startDate,
				isTrueEnd: visibleEndDate === eventEndDate,
				continuesFromPreviousRow: visibleStartDate > event.startDate,
				continuesToNextRow: visibleEndDate < eventEndDate,
			});
		});
	}

	return segments;
}

function segmentsOverlap(left: TimelineRangeSegment, right: TimelineRangeSegment): boolean {
	return left.startColumn <= right.endColumn && right.startColumn <= left.endColumn;
}

export function allocateTimelineRangeLanes(
	segments: readonly TimelineRangeSegment[],
	visibleLaneLimit = TIMELINE_RANGE_LANE_LIMIT,
): TimelineRangeSegment[] {
	const preferredLaneByEvent = new Map<string, number>();
	const allocated: TimelineRangeSegment[] = [];
	const byWeek = new Map<number, TimelineRangeSegment[]>();

	for (const segment of segments) {
		const weekSegments = byWeek.get(segment.weekIndex) ?? [];
		const preferredLane = preferredLaneByEvent.get(segment.eventId);
		let lane = typeof preferredLane === 'number' && !weekSegments.some((candidate) => candidate.lane === preferredLane && segmentsOverlap(candidate, segment))
			? preferredLane
			: 0;

		while (weekSegments.some((candidate) => candidate.lane === lane && segmentsOverlap(candidate, segment))) lane += 1;
		preferredLaneByEvent.set(segment.eventId, lane);

		const allocatedSegment = {
			...segment,
			lane,
			isVisible: lane < visibleLaneLimit,
		};
		weekSegments.push(allocatedSegment);
		byWeek.set(segment.weekIndex, weekSegments);
		allocated.push(allocatedSegment);
	}

	return allocated;
}

export function getTimelineRangeOverflowCountsByDate(segments: readonly TimelineRangeSegment[]): Map<string, number> {
	const overflowByDate = new Map<string, number>();
	for (const segment of segments) {
		if (segment.isVisible !== false) continue;
		for (const date of datesForSegment(segment)) {
			overflowByDate.set(date, (overflowByDate.get(date) ?? 0) + 1);
		}
	}
	return overflowByDate;
}

export function groupTimelineEventsByLayer(
	events: readonly TimelineEvent[],
	layers: readonly TimelineLayerDefinition[] = DEFAULT_TIMELINE_LAYERS,
): TimelinePanelGroup[] {
	const layerDefinitions = [...layers].sort((left, right) => left.order - right.order);
	return layerDefinitions
		.map((layer) => ({
			layer,
			events: sortTimelineEventsForDisplay(events.filter((event) => event.layer === layer.key), layers),
		}))
		.filter((group) => group.events.length > 0);
}
