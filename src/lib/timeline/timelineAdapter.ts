import type { TimelineEvent, TimelineSourceType } from './timelineTypes.ts';

export type TimelinePermissionContext = {
	viewerId: string;
	workspaceRole?: string | null;
};

export type TimelineAdapterContext = {
	workspaceId: string;
	projectId: string;
	visibleStartDate: string;
	visibleEndDate: string;
	viewerId: string;
	permissionContext?: TimelinePermissionContext;
};

export type TimelineSourceAdapter = {
	sourceType: TimelineSourceType;
	getEvents(context: TimelineAdapterContext): Promise<TimelineEvent[]>;
};
