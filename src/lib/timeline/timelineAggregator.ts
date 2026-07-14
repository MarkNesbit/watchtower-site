import type { TimelineAdapterContext, TimelineSourceAdapter } from './timelineAdapter.ts';
import { DEFAULT_TIMELINE_LAYERS, timelineLayerOrder, type TimelineLayerDefinition } from './timelineLayers.ts';
import type { TimelineEvent } from './timelineTypes.ts';
import { getTimelineEventEndDate, normaliseTimelineDateRange, normaliseTimelineEvent } from './timelineValidation.ts';

export type TimelineAggregationOptions = {
	layerDefinitions?: readonly TimelineLayerDefinition[];
};

function duplicateKey(event: TimelineEvent): string {
	return [
		event.workspaceId,
		event.projectId,
		event.sourceType,
		event.sourceId,
		event.startDate,
		getTimelineEventEndDate(event),
		event.layer,
		event.title,
		event.sourceReference ?? '',
	].join('|');
}

function compareTimelineEvents(
	left: TimelineEvent,
	right: TimelineEvent,
	layers: readonly TimelineLayerDefinition[],
): number {
	if (left.startDate !== right.startDate) return left.startDate.localeCompare(right.startDate);
	if (left.presentationType !== right.presentationType) return left.presentationType === 'range' ? -1 : 1;
	const layerDifference = timelineLayerOrder(left.layer, layers) - timelineLayerOrder(right.layer, layers);
	if (layerDifference !== 0) return layerDifference;
	const leftLabel = left.title || left.sourceReference || left.id;
	const rightLabel = right.title || right.sourceReference || right.id;
	const labelDifference = leftLabel.localeCompare(rightLabel);
	if (labelDifference !== 0) return labelDifference;
	return left.id.localeCompare(right.id);
}

export async function aggregateTimelineEvents(
	context: TimelineAdapterContext,
	adapters: readonly TimelineSourceAdapter[],
	options: TimelineAggregationOptions = {},
): Promise<TimelineEvent[]> {
	normaliseTimelineDateRange({ startDate: context.visibleStartDate, endDate: context.visibleEndDate });
	const layerDefinitions = options.layerDefinitions ?? DEFAULT_TIMELINE_LAYERS;
	const eventsByDuplicateKey = new Map<string, TimelineEvent>();

	for (const adapter of adapters) {
		const adapterEvents = await adapter.getEvents(context);
		for (const event of adapterEvents) {
			if (!event.canView) continue;
			if (event.workspaceId !== context.workspaceId || event.projectId !== context.projectId) continue;

			const normalisedEvent = normaliseTimelineEvent(event);
			const eventEndDate = getTimelineEventEndDate(normalisedEvent);
			if (normalisedEvent.startDate > context.visibleEndDate || eventEndDate < context.visibleStartDate) continue;

			const key = duplicateKey(normalisedEvent);
			if (!eventsByDuplicateKey.has(key)) eventsByDuplicateKey.set(key, normalisedEvent);
		}
	}

	return [...eventsByDuplicateKey.values()].sort((left, right) => compareTimelineEvents(left, right, layerDefinitions));
}
