import assert from 'node:assert/strict';
import test from 'node:test';
import {
	DEFAULT_TIMELINE_LAYERS,
	TIMELINE_POINT_EVENT_LIMIT,
	TIMELINE_RANGE_LANE_LIMIT,
	TIMELINE_WEEKDAYS,
	allocateTimelineRangeLanes,
	addTimelineMonths,
	aggregateTimelineEvents,
	buildTimelineCalendarGrid,
	createTimelineFixtureAdapter,
	createProjectDateTimelineAdapter,
	filterTimelineEventsByLayers,
	getDefaultVisibleTimelineLayerKeys,
	getTimelineMonthFromDate,
	getTimelineEventsActiveOnDate,
	getTimelinePointEventsByDate,
	getTimelinePointOverflowCount,
	getTimelineRangeOverflowCountsByDate,
	getTodayDateOnly,
	groupTimelineEventsByLayer,
	normaliseTimelineEvent,
	mapProjectDateToTimelineEvent,
	projectDateTimelinePresentation,
	segmentTimelineRangeEventsByWeek,
	sortTimelineEventsForDisplay,
	timelineDayAriaLabel,
	timelineDayClassName,
	timelineMonthStartDate,
	timelineMonthValue,
	timelineEventOverlapsRange,
} from '../src/lib/timeline/index.ts';
import { readFile } from 'node:fs/promises';

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

function projectDateRecord(overrides = {}) {
	return {
		id: 'date-1',
		organisation_id: 'workspace-1',
		project_id: 'project-1',
		date_type: 'uat',
		custom_label: null,
		title: 'Planned UAT',
		start_date: '2026-07-13',
		target_date: '2026-07-13',
		end_date: null,
		description: 'Business validation window.',
		status: 'scheduled',
		show_on_timeline: true,
		warning_days: 7,
		is_key_date: true,
		created_at: '2026-07-01T09:00:00Z',
		updated_at: '2026-07-01T09:00:00Z',
		removed_at: null,
		...overrides,
	};
}

function createProjectDateAdapterClient(records) {
	class Query {
		constructor() {
			this.filters = [];
		}

		select() { return this; }
		eq(field, value) {
			this.filters.push({ field, value });
			return this;
		}
		is(field, value) {
			this.filters.push({ field, value });
			return this;
		}
		lte() { return this; }
		or() { return this; }
		order() { return this; }

		then(resolve, reject) {
			const data = records.filter((record) => this.filters.every((filter) => (
				filter.value === null ? record[filter.field] === null : record[filter.field] === filter.value
			)));
			return Promise.resolve({ data, error: null }).then(resolve, reject);
		}
	}
	return {
		from: (table) => {
			assert.equal(table, 'project_dates');
			return new Query();
		},
	};
}

const fixtureAdapter = () => createTimelineFixtureAdapter({ includeProjectDelivery: true, includeRaid: true });

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

test('Timeline fixture adapter uses shared aggregation and default layer visibility', async () => {
	const events = await aggregateTimelineEvents(
		{ ...context, visibleStartDate: '2026-06-01', visibleEndDate: '2026-08-31' },
		[fixtureAdapter()],
	);
	assert.ok(events.length >= 16);
	assert.equal(events.every((event) => event.workspaceId === context.workspaceId && event.projectId === context.projectId), true);
	assert.equal(events.every((event) => event.canEdit === false && event.canMove === false), true);
	const defaultLayers = getDefaultVisibleTimelineLayerKeys(DEFAULT_TIMELINE_LAYERS);
	assert.equal(defaultLayers.includes('actions'), false);
	assert.equal(defaultLayers.includes('dependencies'), true);
	const visibleEvents = filterTimelineEventsByLayers(events, defaultLayers);
	assert.equal(visibleEvents.some((event) => event.layer === 'actions'), false);
	assert.equal(visibleEvents.some((event) => event.sourceReference === 'DEP-WAT-007'), true);
});

test('Project Date Timeline adapter maps live single dates ranges categories status and permissions', async () => {
	const adapter = createProjectDateTimelineAdapter({
		client: createProjectDateAdapterClient([
			projectDateRecord({ id: 'point-date', date_type: 'milestone', title: 'Prototype sign-off', start_date: '2026-07-20', target_date: '2026-07-20', description: 'Confirm prototype readiness.', status: 'upcoming' }),
			projectDateRecord({ id: 'range-date', date_type: 'integration', title: 'API integration window', start_date: '2026-07-13', target_date: '2026-07-13', end_date: '2026-07-17', description: 'Supplier and API integration.', status: 'at-risk' }),
			projectDateRecord({ id: 'same-day', date_type: 'deployment', title: 'Deployment checkpoint', start_date: '2026-07-15', target_date: '2026-07-15', end_date: '2026-07-15' }),
		]),
		workspaceRole: 'member',
		canEditProjectDates: true,
		now: new Date('2026-07-01T12:00:00Z'),
	});
	const events = await aggregateTimelineEvents(context, [adapter]);
	const point = events.find((event) => event.sourceId === 'point-date');
	const range = events.find((event) => event.sourceId === 'range-date');
	const sameDay = events.find((event) => event.sourceId === 'same-day');
	assert.equal(point?.presentationType, 'point');
	assert.equal(point?.title, 'Prototype sign-off');
	assert.equal(point?.category, 'Milestone');
	assert.equal(point?.iconKey, 'milestone');
	assert.equal(point?.status, 'Upcoming');
	assert.equal(point?.canEdit, true);
	assert.equal(point?.canMove, false);
	assert.equal(range?.presentationType, 'range');
	assert.equal(range?.endDate, '2026-07-17');
	assert.equal(range?.category, 'Integration');
	assert.equal(range?.attentionTone, 'amber');
	assert.equal(sameDay?.presentationType, 'point');
	assert.equal(sameDay?.endDate, undefined);
	assert.equal(projectDateTimelinePresentation('go-live').shortCode, 'LIVE');
});

test('Project Date Timeline adapter excludes hidden out-of-scope and out-of-range records', async () => {
	const records = [
		projectDateRecord({ id: 'visible-range', title: 'Visible range', start_date: '2026-06-30', target_date: '2026-06-30', end_date: '2026-07-02' }),
		projectDateRecord({ id: 'hidden-date', show_on_timeline: false }),
		projectDateRecord({ id: 'other-project', project_id: 'project-2' }),
		projectDateRecord({ id: 'other-workspace', organisation_id: 'workspace-2' }),
		projectDateRecord({ id: 'outside-range', start_date: '2026-08-10', target_date: '2026-08-10' }),
	];
	const events = await aggregateTimelineEvents(context, [
		createProjectDateTimelineAdapter({
			client: createProjectDateAdapterClient(records),
			workspaceRole: 'viewer',
			canEditProjectDates: false,
			now: new Date('2026-07-01T12:00:00Z'),
		}),
	]);
	assert.deepEqual(events.map((event) => event.sourceId), ['visible-range']);
	assert.equal(events[0]?.canEdit, false);
	assert.equal(getTimelineEventsActiveOnDate(events, '2026-07-01', DEFAULT_TIMELINE_LAYERS).some((event) => event.sourceId === 'visible-range'), true);
});

test('Project Date Timeline adapter returns no records without Project Details view permission', async () => {
	const events = await aggregateTimelineEvents(context, [
		createProjectDateTimelineAdapter({
			client: createProjectDateAdapterClient([projectDateRecord()]),
			workspaceRole: null,
			canEditProjectDates: true,
		}),
	]);
	assert.deepEqual(events, []);
});

test('Timeline point events assign to the correct day with overflow', async () => {
	const events = await aggregateTimelineEvents(
		{ ...context, visibleStartDate: '2026-06-01', visibleEndDate: '2026-08-31' },
		[fixtureAdapter()],
	);
	const weeks = buildTimelineCalendarGrid({ year: 2026, month: 7 }, '2026-07-15');
	const visibleEvents = filterTimelineEventsByLayers(events, getDefaultVisibleTimelineLayerKeys(DEFAULT_TIMELINE_LAYERS));
	const pointEventsByDate = getTimelinePointEventsByDate(weeks, visibleEvents, DEFAULT_TIMELINE_LAYERS);
	const july16Events = pointEventsByDate.get('2026-07-16') ?? [];
	assert.ok(july16Events.some((event) => event.sourceReference === 'RISK-WAT-012'));
	assert.ok(july16Events.some((event) => event.sourceReference === 'DEP-WAT-007'));
	assert.equal(getTimelinePointOverflowCount(july16Events, TIMELINE_POINT_EVENT_LIMIT), 1);
	assert.equal(pointEventsByDate.get('2026-06-30')?.some((event) => event.sourceReference === 'CHK'), true);
});

test('Timeline selected day includes point and inclusive range events', async () => {
	const events = await aggregateTimelineEvents(
		{ ...context, visibleStartDate: '2026-06-01', visibleEndDate: '2026-08-31' },
		[fixtureAdapter()],
	);
	const visibleEvents = filterTimelineEventsByLayers(events, getDefaultVisibleTimelineLayerKeys(DEFAULT_TIMELINE_LAYERS));
	const july17Events = getTimelineEventsActiveOnDate(visibleEvents, '2026-07-17', DEFAULT_TIMELINE_LAYERS);
	assert.ok(july17Events.some((event) => event.title === 'Planned UAT'));
	assert.ok(july17Events.some((event) => event.sourceReference === 'DEC-WAT-009'));
	assert.ok(july17Events.some((event) => event.title === 'Integration window') === false);
});

test('Timeline range segmentation handles week and month boundaries', async () => {
	const events = await aggregateTimelineEvents(
		{ ...context, visibleStartDate: '2026-06-01', visibleEndDate: '2026-08-31' },
		[fixtureAdapter()],
	);
	const julyWeeks = buildTimelineCalendarGrid({ year: 2026, month: 7 }, '2026-07-15');
	const segments = segmentTimelineRangeEventsByWeek(julyWeeks, events, DEFAULT_TIMELINE_LAYERS);
	const uatSegment = segments.find((segment) => segment.event.title === 'Planned UAT');
	assert.equal(uatSegment?.startColumn, 0);
	assert.equal(uatSegment?.endColumn, 4);
	assert.equal(uatSegment?.isTrueStart, true);
	assert.equal(uatSegment?.isTrueEnd, true);

	const weekendSegments = segments.filter((segment) => segment.event.title === 'Weekend release rehearsal');
	assert.equal(weekendSegments.length, 1);
	assert.deepEqual(
		weekendSegments.map((segment) => [segment.visibleStartDate, segment.visibleEndDate, segment.isTrueStart, segment.isTrueEnd]),
		[['2026-08-01', '2026-08-02', true, true]],
	);

	const multiWeek = segmentTimelineRangeEventsByWeek(
		buildTimelineCalendarGrid({ year: 2026, month: 8 }, '2026-08-01'),
		[timelineEvent({ id: 'multi-week', title: 'Multi-week range', startDate: '2026-07-30', endDate: '2026-08-05', presentationType: 'range' })],
	);
	assert.deepEqual(
		multiWeek.map((segment) => [segment.weekIndex, segment.visibleStartDate, segment.visibleEndDate, segment.isTrueStart, segment.isTrueEnd]),
		[
			[0, '2026-07-30', '2026-08-02', true, false],
			[1, '2026-08-03', '2026-08-05', false, true],
		],
	);
});

test('Timeline range lane allocation is stable and reports overflow', async () => {
	const events = await aggregateTimelineEvents(
		{ ...context, visibleStartDate: '2026-06-01', visibleEndDate: '2026-08-31' },
		[fixtureAdapter()],
	);
	const weeks = buildTimelineCalendarGrid({ year: 2026, month: 7 }, '2026-07-15');
	const visibleEvents = filterTimelineEventsByLayers(events, getDefaultVisibleTimelineLayerKeys(DEFAULT_TIMELINE_LAYERS));
	const allocated = allocateTimelineRangeLanes(
		segmentTimelineRangeEventsByWeek(weeks, visibleEvents, DEFAULT_TIMELINE_LAYERS),
		TIMELINE_RANGE_LANE_LIMIT,
	);
	const july16Segments = allocated.filter((segment) => segment.visibleStartDate <= '2026-07-16' && segment.visibleEndDate >= '2026-07-16');
	const visibleLanes = july16Segments.filter((segment) => segment.isVisible).map((segment) => segment.lane);
	assert.deepEqual([...new Set(visibleLanes)].sort(), [0, 1, 2]);
	assert.ok(july16Segments.some((segment) => segment.isVisible === false));
	assert.equal(getTimelineRangeOverflowCountsByDate(allocated).get('2026-07-16'), 2);
});

test('Timeline panel grouping and ordering follow layer and attention rules', async () => {
	const events = await aggregateTimelineEvents(
		{ ...context, visibleStartDate: '2026-06-01', visibleEndDate: '2026-08-31' },
		[fixtureAdapter()],
	);
	const visibleEvents = filterTimelineEventsByLayers(events, getDefaultVisibleTimelineLayerKeys(DEFAULT_TIMELINE_LAYERS));
	const selectedEvents = getTimelineEventsActiveOnDate(visibleEvents, '2026-07-16', DEFAULT_TIMELINE_LAYERS);
	const groups = groupTimelineEventsByLayer(selectedEvents, DEFAULT_TIMELINE_LAYERS);
	assert.deepEqual(groups.map((group) => group.layer.key), ['project-delivery', 'risks', 'issues', 'dependencies']);
	assert.equal(groups[0].events.every((event) => event.presentationType === 'range'), true);
	assert.equal(groups.find((group) => group.layer.key === 'risks')?.events[0]?.attentionTone, 'red');
	assert.equal(sortTimelineEventsForDisplay(selectedEvents, DEFAULT_TIMELINE_LAYERS)[0].presentationType, 'range');
});

test('Timeline layer filtering updates selected-day totals and can clear selected event state', async () => {
	const events = await aggregateTimelineEvents(
		{ ...context, visibleStartDate: '2026-06-01', visibleEndDate: '2026-08-31' },
		[fixtureAdapter()],
	);
	const defaultLayers = getDefaultVisibleTimelineLayerKeys(DEFAULT_TIMELINE_LAYERS);
	const withRisks = getTimelineEventsActiveOnDate(filterTimelineEventsByLayers(events, defaultLayers), '2026-07-16', DEFAULT_TIMELINE_LAYERS);
	const withoutRisks = getTimelineEventsActiveOnDate(filterTimelineEventsByLayers(events, defaultLayers.filter((layer) => layer !== 'risks')), '2026-07-16', DEFAULT_TIMELINE_LAYERS);
	assert.ok(withRisks.length > withoutRisks.length);
	const selectedRisk = withRisks.find((event) => event.layer === 'risks');
	assert.equal(Boolean(selectedRisk && !defaultLayers.filter((layer) => layer !== 'risks').includes(selectedRisk.layer)), true);
});

test('Timeline calendar weekday order starts Monday and ends Sunday', () => {
	assert.deepEqual(TIMELINE_WEEKDAYS.map((weekday) => weekday.label), [
		'Monday',
		'Tuesday',
		'Wednesday',
		'Thursday',
		'Friday',
		'Saturday',
		'Sunday',
	]);
});

test('Timeline calendar includes previous-month dates for a month beginning midweek', () => {
	const weeks = buildTimelineCalendarGrid({ year: 2026, month: 7 }, '2026-07-14');
	assert.equal(weeks[0].days[0].date, '2026-06-29');
	assert.equal(weeks[0].days[1].date, '2026-06-30');
	assert.equal(weeks[0].days[2].date, '2026-07-01');
	assert.equal(weeks[0].days[0].isCurrentMonth, false);
	assert.equal(weeks[0].days[2].isCurrentMonth, true);
});

test('Timeline calendar includes following-month dates when the month ends midweek', () => {
	const weeks = buildTimelineCalendarGrid({ year: 2026, month: 4 }, '2026-04-14');
	const finalWeek = weeks.at(-1);
	assert.equal(finalWeek?.days.at(-1)?.date, '2026-05-03');
	assert.equal(finalWeek?.days.at(-1)?.isCurrentMonth, false);
});

test('Timeline calendar handles leap-year February', () => {
	const days = buildTimelineCalendarGrid({ year: 2028, month: 2 }, '2028-02-14').flatMap((week) => week.days);
	const leapDay = days.find((day) => day.date === '2028-02-29');
	assert.equal(leapDay?.dayNumber, 29);
	assert.equal(leapDay?.isCurrentMonth, true);
});

test('Timeline calendar handles non-leap-year February', () => {
	const days = buildTimelineCalendarGrid({ year: 2026, month: 2 }, '2026-02-14').flatMap((week) => week.days);
	assert.equal(days.some((day) => day.date === '2026-02-29'), false);
	assert.equal(days.some((day) => day.date === '2026-03-01'), true);
});

test('Timeline calendar supports five-row months', () => {
	const weeks = buildTimelineCalendarGrid({ year: 2026, month: 7 }, '2026-07-14');
	assert.equal(weeks.length, 5);
	assert.equal(weeks[0].days[0].date, '2026-06-29');
	assert.equal(weeks.at(-1)?.days.at(-1)?.date, '2026-08-02');
});

test('Timeline calendar supports six-row months', () => {
	const weeks = buildTimelineCalendarGrid({ year: 2026, month: 8 }, '2026-08-14');
	assert.equal(weeks.length, 6);
	assert.equal(weeks[0].days[0].date, '2026-07-27');
	assert.equal(weeks.at(-1)?.days.at(-1)?.date, '2026-09-06');
});

test('Timeline month navigation moves from January to December', () => {
	assert.deepEqual(addTimelineMonths({ year: 2026, month: 1 }, -1), { year: 2025, month: 12 });
});

test('Timeline month navigation moves from December to January', () => {
	assert.deepEqual(addTimelineMonths({ year: 2026, month: 12 }, 1), { year: 2027, month: 1 });
});

test('Timeline month navigation selects the first day of the newly displayed month', () => {
	const previousMonth = addTimelineMonths({ year: 2026, month: 7 }, -1);
	const nextMonth = addTimelineMonths({ year: 2026, month: 7 }, 1);
	assert.equal(timelineMonthStartDate(previousMonth), '2026-06-01');
	assert.equal(timelineMonthStartDate(nextMonth), '2026-08-01');
});

test('Timeline Today behaviour resolves the current month from today', () => {
	const today = getTodayDateOnly(new Date('2026-07-14T12:00:00'));
	assert.equal(today, '2026-07-14');
	assert.equal(timelineMonthValue(getTimelineMonthFromDate(today)), '2026-07');
});

test('Timeline calendar marks today and supports arbitrary selected dates', () => {
	const days = buildTimelineCalendarGrid({ year: 2026, month: 7 }, '2026-07-14').flatMap((week) => week.days);
	const today = days.find((day) => day.date === '2026-07-14');
	const selectedDate = '2026-07-22';
	assert.equal(today?.isToday, true);
	assert.equal(days.some((day) => day.date === selectedDate), true);
});

test('Timeline calendar keeps adjacent-month days selectable in the model', () => {
	const days = buildTimelineCalendarGrid({ year: 2026, month: 7 }, '2026-07-14').flatMap((week) => week.days);
	const adjacentDay = days.find((day) => day.date === '2026-08-01');
	assert.equal(adjacentDay?.isCurrentMonth, false);
	assert.equal(adjacentDay?.dayNumber, 1);
});

test('Timeline calendar identifies weekends separately from current-month state', () => {
	const days = buildTimelineCalendarGrid({ year: 2026, month: 7 }, '2026-07-14').flatMap((week) => week.days);
	const saturday = days.find((day) => day.date === '2026-07-04');
	const monday = days.find((day) => day.date === '2026-07-06');
	assert.equal(saturday?.isWeekend, true);
	assert.equal(monday?.isWeekend, false);
	assert.equal(saturday?.isCurrentMonth, true);
});

test('Timeline day cell class and aria helpers preserve the full state contract', () => {
	const day = {
		date: '2026-08-01',
		dayNumber: 1,
		isCurrentMonth: false,
		isWeekend: true,
		isToday: true,
	};
	assert.equal(
		timelineDayClassName(day, '2026-08-01'),
		'timeline-day timeline-day--adjacent timeline-day--weekend timeline-day--today timeline-day--selected',
	);
	assert.match(timelineDayAriaLabel(day, '2026-08-01'), /Saturday, 1 August 2026, today, selected, adjacent month, weekend/);
});

test('Timeline page uses the shared shell route and live Project Date adapter path', async () => {
	const page = await readFile(new URL('../src/pages/app/workspaces/[workspaceSlug]/projects/[projectId]/timeline.astro', import.meta.url), 'utf8');
	assert.match(page, /<AuthenticatedLayout/);
	assert.match(page, /<ProjectPageHero/);
	assert.match(page, /title="Timeline"/);
	assert.match(page, /View significant project delivery dates and assurance events across the month\./);
	assert.match(page, /getWorkspaceBySlug\(serverSupabase, workspaceSlug \?\? '', accessToken\)/);
	assert.match(page, /\.eq\('slug', projectSlug\)/);
	assert.match(page, /\.eq\('organisation_id', organisation\.id\)/);
	assert.match(page, /can\(workspace\.role, 'project\.viewDashboard'\)/);
	assert.match(page, /aggregateTimelineEvents\(/);
	assert.match(page, /createProjectDateTimelineAdapter\(\{[\s\S]*?client: serverSupabase,[\s\S]*?workspaceRole: workspace\.role,[\s\S]*?canEditProjectDates,/);
	assert.match(page, /initialVisibleStartDate = calendarWeeks\[0\]\?\.days\[0\]\?\.date/);
	assert.match(page, /initialVisibleEndDate = calendarWeeks\.at\(-1\)\?\.days\.at\(-1\)\?\.date/);
	assert.match(page, /visibleStartDate: initialVisibleStartDate/);
	assert.match(page, /visibleEndDate: initialVisibleEndDate/);
	assert.match(page, /PUBLIC_WATCHTOWER_TIMELINE_FIXTURES === 'true'/);
	assert.match(page, /createTimelineFixtureAdapter\(\{ includeRaid: true, includeProjectDelivery: false \}\)/);
	assert.doesNotMatch(page, /from\('project_dates'\)|from\('project_risks'\)|listProjectDates|listProjectRisks|createProjectAction/);
});

test('Timeline page includes accessible month controls states and selected-day panel', async () => {
	const page = await readFile(new URL('../src/pages/app/workspaces/[workspaceSlug]/projects/[projectId]/timeline.astro', import.meta.url), 'utf8');
	assert.match(page, /data-timeline-previous aria-label="Show previous month"/);
	assert.match(page, /data-timeline-next aria-label="Show next month"/);
	assert.match(page, /data-timeline-today-control/);
	assert.match(page, /role="grid"/);
	assert.match(page, /role="columnheader"/);
	assert.match(page, /role="gridcell"/);
	assert.match(page, /aria-pressed=\{day\.date === initialSelectedDate \? 'true' : 'false'\}/);
	assert.match(page, /aria-selected=\{day\.date === initialSelectedDate \? 'true' : 'false'\}/);
	assert.match(page, /aria-current=\{day\.isToday \? 'date' : undefined\}/);
	assert.match(page, /data-timeline-selected-heading/);
	assert.match(page, /No project activity is currently shown for this date\./);
	assert.match(page, /data-timeline-loading hidden/);
	assert.match(page, /data-timeline-error-state/);
	assert.match(page, /\.timeline-layout \{[\s\S]*?grid-template-columns: minmax\(0, 2\.6fr\) minmax\(17rem, 1fr\);/);
	assert.match(page, /@media \(max-width: 980px\) \{[\s\S]*?grid-template-columns: 1fr;/);
});

test('Timeline client month render clones the full server day-cell contract', async () => {
	const page = await readFile(new URL('../src/pages/app/workspaces/[workspaceSlug]/projects/[projectId]/timeline.astro', import.meta.url), 'utf8');
	assert.match(page, /<template data-timeline-week-template>[\s\S]*?class="timeline-week" role="row"/);
	assert.match(page, /<template data-timeline-day-template>[\s\S]*?data-timeline-day-contract="timeline-day-v1"[\s\S]*?data-timeline-day-number[\s\S]*?data-timeline-today-marker[\s\S]*?data-timeline-weekend-marker[\s\S]*?timeline-day__range-lanes[\s\S]*?timeline-day__point-area[\s\S]*?timeline-day__overflow/);
	assert.match(page, /const row = createWeekRow\(\)/);
	assert.match(page, /week\.days\.forEach\(\(day, index\) => \{[\s\S]*?const button = createDayButton\(day\);[\s\S]*?button\.style\.gridColumn = String\(index \+ 1\);[\s\S]*?row\.append\(button\);/);
	assert.match(page, /templateContent\?\.cloneNode\(true\)/);
	assert.match(page, /applyDayState\(resolvedButton, day\)/);
	assert.doesNotMatch(page, /button\.innerHTML\s*=/);
	assert.doesNotMatch(page, /const button = document\.createElement\('button'\);[\s\S]*?button\.className = \[/);
});

test('Timeline page exposes fixture event rendering layer controls and panel templates', async () => {
	const page = await readFile(new URL('../src/pages/app/workspaces/[workspaceSlug]/projects/[projectId]/timeline.astro', import.meta.url), 'utf8');
	assert.match(page, /data-timeline-layer-control/);
	assert.match(page, /data-timeline-layer-toggle=\{layer\.key\}/);
	assert.match(page, /<template data-timeline-range-template>/);
	assert.match(page, /<template data-timeline-point-template>/);
	assert.match(page, /<template data-timeline-range-overflow-template>/);
	assert.match(page, /<template data-timeline-point-overflow-template>/);
	assert.match(page, /<template data-timeline-panel-group-template>/);
	assert.match(page, /<template data-timeline-panel-row-template>/);
	assert.match(page, /data-timeline-legend/);
	assert.match(page, /selectedEventId = ''/);
	assert.match(page, /if \(selectedEvent && !visibleLayerKeys\.has\(selectedEvent\.layer\)\) selectedEventId = ''/);
});

test('Timeline selected-day panel uses calendar-height sync with fixed header and internal scroll region', async () => {
	const page = await readFile(new URL('../src/pages/app/workspaces/[workspaceSlug]/projects/[projectId]/timeline.astro', import.meta.url), 'utf8');
	const calendarCardCss = page.match(/\.timeline-calendar-card \{(?<body>[\s\S]*?)\n\t\}/)?.groups?.body ?? '';
	assert.match(page, /<aside class="content-card timeline-day-panel"[\s\S]*?<div class="timeline-day-panel__header" data-timeline-day-panel-header>[\s\S]*?data-timeline-selected-heading[\s\S]*?data-timeline-selected-copy[\s\S]*?<\/div>\s*<div class="timeline-day-panel__groups" data-timeline-day-groups tabindex="0" aria-label="Selected day Timeline entries">/);
	assert.match(page, /<section class="content-card timeline-calendar-card" aria-labelledby="timeline-month-heading" data-timeline-calendar-card>/);
	assert.match(page, /const calendarCard = document\.querySelector\('\[data-timeline-calendar-card\]'\)/);
	assert.match(page, /const dayPanel = document\.querySelector\('\[data-timeline-day-panel\]'\)/);
	assert.match(page, /function syncPanelHeightToCalendar\(\) \{[\s\S]*?const calendarHeight = Math\.ceil\(calendarCard\.getBoundingClientRect\(\)\.height\);[\s\S]*?dayPanel\.style\.setProperty\('--timeline-calendar-card-height', `\$\{calendarHeight\}px`\);/);
	assert.match(page, /new ResizeObserver\(\(\) => schedulePanelHeightSync\(\)\)/);
	assert.match(page, /desktopPanelHeightQuery\.addEventListener\('change', \(\) => schedulePanelHeightSync\(\)\)/);
	assert.match(page, /\.timeline-layout \{[\s\S]*?align-items: start;/);
	assert.doesNotMatch(page, /\.timeline-layout \{[\s\S]*?align-items: stretch;/);
	assert.doesNotMatch(calendarCardCss, /height:\s*100%/);
	assert.doesNotMatch(calendarCardCss, /min-height:/);
	assert.match(page, /\.timeline-calendar-card \{[\s\S]*?align-self: start;/);
	assert.match(page, /\.timeline-day-panel \{[\s\S]*?grid-template-rows: auto minmax\(0, 1fr\);[\s\S]*?height: var\(--timeline-calendar-card-height, auto\);[\s\S]*?max-height: var\(--timeline-calendar-card-height, none\);[\s\S]*?overflow: hidden;/);
	assert.match(page, /\.timeline-day-panel__groups \{[\s\S]*?min-height: 0;[\s\S]*?overflow-y: auto;[\s\S]*?scrollbar-gutter: stable;/);
	assert.match(page, /@media \(max-width: 980px\) \{[\s\S]*?\.timeline-day-panel \{[\s\S]*?position: static;[\s\S]*?height: auto;[\s\S]*?max-height: none;[\s\S]*?\.timeline-day-panel__groups \{[\s\S]*?max-height: 28rem;/);
});

test('Timeline panel reference pills carry tone and remove redundant RAID pills', async () => {
	const events = await aggregateTimelineEvents(
		{ ...context, visibleStartDate: '2026-06-01', visibleEndDate: '2026-08-31' },
		[fixtureAdapter()],
	);
	const visibleEvents = filterTimelineEventsByLayers(events, getDefaultVisibleTimelineLayerKeys(DEFAULT_TIMELINE_LAYERS));
	const selectedEvents = getTimelineEventsActiveOnDate(visibleEvents, '2026-07-16', DEFAULT_TIMELINE_LAYERS);
	const redRisk = selectedEvents.find((event) => event.sourceReference === 'RISK-WAT-012');
	const amberRisk = selectedEvents.find((event) => event.sourceReference === 'RISK-WAT-018');
	const scheduledRisk = selectedEvents.find((event) => event.sourceReference === 'RISK-WAT-010');
	const dependency = selectedEvents.find((event) => event.sourceReference === 'DEP-WAT-007');
	const issue = selectedEvents.find((event) => event.sourceReference === 'ISSUE-WAT-009');
	assert.equal(redRisk?.attentionTone, 'red');
	assert.equal(redRisk?.status, 'Red');
	assert.equal(amberRisk?.attentionTone, 'amber');
	assert.equal(amberRisk?.status, 'Amber');
	assert.equal(scheduledRisk?.attentionTone, 'neutral');
	assert.equal(scheduledRisk?.status, 'Scheduled');
	assert.equal(dependency?.attentionTone, 'amber');
	assert.equal(dependency?.status, 'Amber');
	assert.equal(issue?.attentionTone, 'amber');
	assert.equal(issue?.status, 'Open');

	const page = await readFile(new URL('../src/pages/app/workspaces/[workspaceSlug]/projects/[projectId]/timeline.astro', import.meta.url), 'utf8');
	assert.match(page, /function panelPresentationForEvent\(event\) \{[\s\S]*?referenceTone: eventTone\(event\),[\s\S]*?showTypePill: \(!event\.sourceReference && !event\.category\) \|\| \(!eventReferenceIdentifiesSource\(event\) && event\.sourceType !== 'project-date'\),[\s\S]*?showStatusPill: Boolean\(event\.status\) && !eventStatusDuplicatesTone\(event\),/);
	assert.match(page, /reference\.className = `timeline-panel-event__reference timeline-panel-event__reference--\$\{presentation\.referenceTone\}`/);
	assert.match(page, /type\.toggleAttribute\('hidden', !presentation\.showTypePill\)/);
	assert.match(page, /status\.toggleAttribute\('hidden', !presentation\.showStatusPill\)/);
	assert.match(page, /\.timeline-panel-event__reference--red \{ color: var\(--rag-red-accent\);/);
	assert.match(page, /\.timeline-panel-event__reference--amber \{ color: var\(--rag-amber-accent\);/);
});

test('Timeline panel keeps project delivery category and distinct status presentation', async () => {
	const events = await aggregateTimelineEvents(
		{ ...context, visibleStartDate: '2026-06-01', visibleEndDate: '2026-08-31' },
		[fixtureAdapter()],
	);
	const plannedUat = events.find((event) => event.title === 'Planned UAT');
	const integration = events.find((event) => event.title === 'Integration window');
	assert.equal(plannedUat?.sourceReference, 'UAT');
	assert.equal(plannedUat?.status, 'On track');
	assert.equal(plannedUat?.attentionTone, 'green');
	assert.equal(integration?.sourceReference, 'INT');
	assert.equal(integration?.status, 'Amber');
	assert.equal(integration?.attentionTone, 'amber');
});

test('Timeline event summaries use one shared overlay without native duplicate tooltips', async () => {
	const page = await readFile(new URL('../src/pages/app/workspaces/[workspaceSlug]/projects/[projectId]/timeline.astro', import.meta.url), 'utf8');
	assert.equal((page.match(/data-timeline-event-summary-overlay/g) ?? []).length, 2);
	assert.match(page, /<div class="timeline-event-summary-overlay" id="timeline-event-summary-overlay" role="tooltip" data-timeline-event-summary-overlay hidden>/);
	assert.match(page, /position: fixed;[\s\S]*?z-index: 1000;/);
	assert.match(page, /control\.removeAttribute\('title'\)/);
	assert.doesNotMatch(page, /setAttribute\('title'/);
	assert.doesNotMatch(page, /data-timeline-event-tooltip|timeline-event-tooltip/);
	assert.match(page, /control\.addEventListener\('pointerenter', \(\) => showEventSummary\(control, event, activeDate\)\)/);
	assert.match(page, /control\.addEventListener\('focus', \(\) => showEventSummary\(control, event, activeDate\)\)/);
	assert.match(page, /control\.addEventListener\('pointerleave', \(\) => hideEventSummary\(control\)\)/);
	assert.match(page, /control\.addEventListener\('blur', \(\) => hideEventSummary\(control\)\)/);
	assert.match(page, /trigger\.setAttribute\('aria-describedby', eventSummaryOverlay\.id\)/);
	assert.match(page, /hideEventSummary\(\);[\s\S]*?if \(layerControl instanceof HTMLDetailsElement\) layerControl\.open = false;/);
});

test('Timeline event summary content includes reference title type date and status once', async () => {
	const page = await readFile(new URL('../src/pages/app/workspaces/[workspaceSlug]/projects/[projectId]/timeline.astro', import.meta.url), 'utf8');
	assert.match(page, /reference: event\.sourceReference \|\| ''/);
	assert.match(page, /title: event\.title/);
	assert.match(page, /const typeLabel = event\.category \? `\$\{eventTypeLabel\(event\)\} · \$\{event\.category\}` : eventTypeLabel\(event\)/);
	assert.match(page, /meta: `\$\{typeLabel\} · \$\{event\.status \|\| event\.attentionTone \|\| 'No status'\}`/);
	assert.match(page, /date: eventSummaryDateLabel\(event, activeDate\)/);
	assert.match(page, /summary: event\.summary \|\| ''/);
	assert.match(page, /setSummaryText\(summaryReference, summary\.reference, true\)/);
	assert.match(page, /setSummaryText\(summaryTitle, summary\.title\)/);
	assert.match(page, /setSummaryText\(summaryMeta, summary\.meta\)/);
	assert.match(page, /setSummaryText\(summaryDate, summary\.date\)/);
	assert.match(page, /setSummaryText\(summaryCopy, summary\.summary, true\)/);
});

test('Timeline client navigation keeps selected date and panel consistent with the displayed month', async () => {
	const page = await readFile(new URL('../src/pages/app/workspaces/[workspaceSlug]/projects/[projectId]/timeline.astro', import.meta.url), 'utf8');
	assert.match(page, /function navigateMonth\(offset\) \{[\s\S]*?const nextMonth = addTimelineMonths\(activeMonth, offset\);[\s\S]*?selectedDate = timelineMonthStartDate\(nextMonth\);[\s\S]*?renderMonth\(nextMonth\);/);
	assert.match(page, /previousButton\?\.addEventListener\('click', \(\) => navigateMonth\(-1\)\)/);
	assert.match(page, /nextButton\?\.addEventListener\('click', \(\) => navigateMonth\(1\)\)/);
	assert.match(page, /todayButton\?\.addEventListener\('click', \(\) => \{[\s\S]*?selectedDate = todayDate;[\s\S]*?renderMonth\(getTimelineMonthFromDate\(todayDate\)\);/);
	assert.match(page, /if \(selectedHeading\) selectedHeading\.textContent = `\$\{formatTimelineDateLong\(selectedDate\)\} · \$\{selectedEvents\.length\} \$\{selectedEvents\.length === 1 \? 'entry' : 'entries'\}`/);
	assert.match(page, /page\?\.setAttribute\('data-timeline-selected-date', selectedDate\)/);
});
