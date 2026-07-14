import assert from 'node:assert/strict';
import test from 'node:test';
import {
	DEFAULT_TIMELINE_LAYERS,
	aggregateTimelineEvents,
	normaliseTimelineEvent,
	timelineEventOverlapsRange,
} from '../src/lib/timeline/index.ts';

const context = {
	workspaceId: 'workspace-1',
	projectId: 'project-1',
	visibleStartDate: '2026-07-01',
	visibleEndDate: '2026-07-31',
	viewerId: 'user-1',
};

function timelineEvent(overrides = {}) {
	return {
		id: 'event-1',
		workspaceId: 'workspace-1',
		projectId: 'project-1',
		sourceType: 'project-date',
		sourceId: 'source-1',
		sourceReference: 'PD-001',
		title: 'Project milestone',
		startDate: '2026-07-10',
		allDay: true,
		presentationType: 'point',
		layer: 'project-delivery',
		iconKey: 'milestone',
		canView: true,
		canEdit: false,
		canMove: false,
		...overrides,
	};
}

function adapter(events, sourceType = 'project-date') {
	return {
		sourceType,
		getEvents: async () => events,
	};
}

test('Timeline event normalisation treats missing end date as a point event', () => {
	const event = normaliseTimelineEvent(timelineEvent({ endDate: undefined, presentationType: 'point' }));
	assert.equal(event.presentationType, 'point');
	assert.equal(event.endDate, undefined);
});

test('Timeline event normalisation treats same-day start and end as a point event', () => {
	const event = normaliseTimelineEvent(timelineEvent({ startDate: '2026-07-10', endDate: '2026-07-10', presentationType: 'range' }));
	assert.equal(event.presentationType, 'point');
	assert.equal(event.endDate, undefined);
});

test('Timeline event normalisation preserves valid inclusive ranges', () => {
	const event = normaliseTimelineEvent(timelineEvent({ startDate: '2026-07-10', endDate: '2026-07-12', presentationType: 'point' }));
	assert.equal(event.presentationType, 'range');
	assert.equal(event.endDate, '2026-07-12');
});

test('Timeline event normalisation rejects an end date before the start date', () => {
	assert.throws(
		() => normaliseTimelineEvent(timelineEvent({ startDate: '2026-07-10', endDate: '2026-07-09', presentationType: 'range' })),
		/Timeline event end date cannot be before start date/,
	);
});

test('Timeline overlap includes the visible start boundary', () => {
	assert.equal(
		timelineEventOverlapsRange(
			timelineEvent({ startDate: '2026-06-20', endDate: '2026-07-01', presentationType: 'range' }),
			{ startDate: '2026-07-01', endDate: '2026-07-31' },
		),
		true,
	);
});

test('Timeline overlap includes the visible end boundary', () => {
	assert.equal(
		timelineEventOverlapsRange(
			timelineEvent({ startDate: '2026-07-31' }),
			{ startDate: '2026-07-01', endDate: '2026-07-31' },
		),
		true,
	);
});

test('Timeline overlap includes an event spanning the whole visible range', () => {
	assert.equal(
		timelineEventOverlapsRange(
			timelineEvent({ startDate: '2026-06-01', endDate: '2026-08-31', presentationType: 'range' }),
			{ startDate: '2026-07-01', endDate: '2026-07-31' },
		),
		true,
	);
});

test('Timeline overlap excludes events outside the visible range', () => {
	assert.equal(
		timelineEventOverlapsRange(
			timelineEvent({ startDate: '2026-08-01' }),
			{ startDate: '2026-07-01', endDate: '2026-07-31' },
		),
		false,
	);
});

test('Timeline aggregation removes exact duplicate events', async () => {
	const duplicate = timelineEvent({ id: 'event-duplicate' });
	const events = await aggregateTimelineEvents(context, [adapter([timelineEvent(), duplicate])]);
	assert.equal(events.length, 1);
	assert.equal(events[0].id, 'event-1');
});

test('Timeline aggregation excludes events the source says the viewer cannot see', async () => {
	const events = await aggregateTimelineEvents(context, [adapter([
		timelineEvent({ id: 'hidden-event', canView: false }),
		timelineEvent({ id: 'visible-event', sourceId: 'source-2', title: 'Visible milestone' }),
	])]);
	assert.deepEqual(events.map((event) => event.id), ['visible-event']);
});

test('Timeline aggregation excludes events outside the requested project scope', async () => {
	const events = await aggregateTimelineEvents(context, [adapter([
		timelineEvent({ id: 'other-project', projectId: 'project-2' }),
		timelineEvent({ id: 'current-project', sourceId: 'source-2', title: 'Current project' }),
	])]);
	assert.deepEqual(events.map((event) => event.id), ['current-project']);
});

test('Timeline aggregation excludes events outside the requested workspace scope', async () => {
	const events = await aggregateTimelineEvents(context, [adapter([
		timelineEvent({ id: 'other-workspace', workspaceId: 'workspace-2' }),
		timelineEvent({ id: 'current-workspace', sourceId: 'source-2', title: 'Current workspace' }),
	])]);
	assert.deepEqual(events.map((event) => event.id), ['current-workspace']);
});

test('Timeline aggregation excludes events outside the visible date range', async () => {
	const events = await aggregateTimelineEvents(context, [adapter([
		timelineEvent({ id: 'outside-range', startDate: '2026-08-01' }),
		timelineEvent({ id: 'inside-range', sourceId: 'source-2', title: 'Inside range', startDate: '2026-07-31' }),
	])]);
	assert.deepEqual(events.map((event) => event.id), ['inside-range']);
});

test('Timeline aggregation sorts deterministically', async () => {
	const events = await aggregateTimelineEvents(context, [adapter([
		timelineEvent({
			id: 'point-same-day',
			sourceId: 'source-3',
			title: 'A point',
			startDate: '2026-07-10',
			presentationType: 'point',
		}),
		timelineEvent({
			id: 'risk-range',
			sourceType: 'risk',
			sourceId: 'source-2',
			title: 'B risk',
			startDate: '2026-07-10',
			endDate: '2026-07-11',
			presentationType: 'range',
			layer: 'risks',
			iconKey: 'risk',
		}),
		timelineEvent({
			id: 'earlier',
			sourceId: 'source-1',
			title: 'C earlier',
			startDate: '2026-07-01',
		}),
		timelineEvent({
			id: 'delivery-range',
			sourceId: 'source-4',
			title: 'A delivery',
			startDate: '2026-07-10',
			endDate: '2026-07-12',
			presentationType: 'range',
		}),
	])]);
	assert.deepEqual(events.map((event) => event.id), ['earlier', 'delivery-range', 'risk-range', 'point-same-day']);
});

test('Timeline layer defaults keep Actions hidden', () => {
	const actionsLayer = DEFAULT_TIMELINE_LAYERS.find((layer) => layer.key === 'actions');
	assert.equal(actionsLayer?.enabled, true);
	assert.equal(actionsLayer?.defaultVisible, false);
});
