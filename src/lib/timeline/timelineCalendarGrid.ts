export const TIMELINE_WEEKDAYS = [
	{ key: 'monday', label: 'Monday', shortLabel: 'Mon' },
	{ key: 'tuesday', label: 'Tuesday', shortLabel: 'Tue' },
	{ key: 'wednesday', label: 'Wednesday', shortLabel: 'Wed' },
	{ key: 'thursday', label: 'Thursday', shortLabel: 'Thu' },
	{ key: 'friday', label: 'Friday', shortLabel: 'Fri' },
	{ key: 'saturday', label: 'Saturday', shortLabel: 'Sat', isWeekend: true },
	{ key: 'sunday', label: 'Sunday', shortLabel: 'Sun', isWeekend: true },
] as const;

export type TimelineCalendarDay = {
	date: string;
	dayNumber: number;
	isCurrentMonth: boolean;
	isWeekend: boolean;
	isToday: boolean;
};

export type TimelineCalendarWeek = {
	days: TimelineCalendarDay[];
};

export type TimelineMonth = {
	year: number;
	month: number;
};

const dateFormatter = new Intl.DateTimeFormat('en-GB', { dateStyle: 'full', timeZone: 'UTC' });
const monthFormatter = new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });

function padDatePart(value: number): string {
	return String(value).padStart(2, '0');
}

function dateOnlyFromUtcDate(date: Date): string {
	return `${date.getUTCFullYear()}-${padDatePart(date.getUTCMonth() + 1)}-${padDatePart(date.getUTCDate())}`;
}

function utcDateFromDateOnly(value: string): Date {
	return new Date(`${value}T00:00:00Z`);
}

function addUtcDays(date: Date, days: number): Date {
	const next = new Date(date);
	next.setUTCDate(next.getUTCDate() + days);
	return next;
}

function mondayFirstDayIndex(date: Date): number {
	return (date.getUTCDay() + 6) % 7;
}

export function getTodayDateOnly(now = new Date()): string {
	return `${now.getFullYear()}-${padDatePart(now.getMonth() + 1)}-${padDatePart(now.getDate())}`;
}

export function getTimelineMonthFromDate(dateOnly: string): TimelineMonth {
	return {
		year: Number(dateOnly.slice(0, 4)),
		month: Number(dateOnly.slice(5, 7)),
	};
}

export function addTimelineMonths(month: TimelineMonth, offset: number): TimelineMonth {
	const date = new Date(Date.UTC(month.year, month.month - 1 + offset, 1));
	return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1 };
}

export function timelineMonthValue(month: TimelineMonth): string {
	return `${month.year}-${padDatePart(month.month)}`;
}

export function formatTimelineMonthHeading(month: TimelineMonth): string {
	return monthFormatter.format(new Date(Date.UTC(month.year, month.month - 1, 1)));
}

export function formatTimelineDateLong(dateOnly: string): string {
	return dateFormatter.format(utcDateFromDateOnly(dateOnly));
}

export function buildTimelineCalendarGrid(month: TimelineMonth, todayDate = getTodayDateOnly()): TimelineCalendarWeek[] {
	const firstOfMonth = new Date(Date.UTC(month.year, month.month - 1, 1));
	const lastOfMonth = new Date(Date.UTC(month.year, month.month, 0));
	const gridStart = addUtcDays(firstOfMonth, -mondayFirstDayIndex(firstOfMonth));
	const gridEnd = addUtcDays(lastOfMonth, 6 - mondayFirstDayIndex(lastOfMonth));
	const weeks: TimelineCalendarWeek[] = [];
	let cursor = gridStart;

	while (cursor <= gridEnd) {
		const days: TimelineCalendarDay[] = [];
		for (let dayIndex = 0; dayIndex < 7; dayIndex += 1) {
			const date = dateOnlyFromUtcDate(cursor);
			days.push({
				date,
				dayNumber: cursor.getUTCDate(),
				isCurrentMonth: cursor.getUTCFullYear() === month.year && cursor.getUTCMonth() === month.month - 1,
				isWeekend: cursor.getUTCDay() === 0 || cursor.getUTCDay() === 6,
				isToday: date === todayDate,
			});
			cursor = addUtcDays(cursor, 1);
		}
		weeks.push({ days });
	}

	return weeks;
}
