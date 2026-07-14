import type { TimelinePermissionContext } from './timelineAdapter.ts';
import type { TimelineSourceType } from './timelineTypes.ts';

export type TimelineModalRequest = {
	modalKey: string;
	sourceType: TimelineSourceType;
	sourceId: string;
	permissionContext: TimelinePermissionContext;
};

export type TimelineModalResolution = {
	modalKey: string;
	sourceType: TimelineSourceType;
	sourceId: string;
	canView: boolean;
	canEdit: boolean;
	refreshSourceOnClose: boolean;
};

export type TimelineModalRegistry = {
	resolve(request: TimelineModalRequest): TimelineModalResolution | null;
};
