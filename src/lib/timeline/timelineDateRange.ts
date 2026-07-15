import type { TimelineDateRange, TimelineEvent } from './timelineTypes.ts';
import { getTimelineEventEndDate, normaliseTimelineDateRange, normaliseTimelineEvent } from './timelineValidation.ts';

export function timelineEventOverlapsRange(event: TimelineEvent, visibleRange: TimelineDateRange): boolean {
	const normalisedEvent = normaliseTimelineEvent(event);
	const normalisedRange = normaliseTimelineDateRange(visibleRange);
	const eventEndDate = getTimelineEventEndDate(normalisedEvent);
	return normalisedEvent.startDate <= normalisedRange.endDate && eventEndDate >= normalisedRange.startDate;
}
