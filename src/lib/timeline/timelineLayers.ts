import type { TimelineSourceType } from './timelineTypes.ts';

export const TIMELINE_LAYER_KEYS = [
	'project-delivery',
	'risks',
	'issues',
	'dependencies',
	'assumptions',
	'decisions',
	'actions',
	'project-events',
	'delivery-periods',
] as const;

export type TimelineLayerKey = (typeof TIMELINE_LAYER_KEYS)[number];

export type TimelineLayerDefinition = {
	key: TimelineLayerKey;
	label: string;
	sourceTypes: TimelineSourceType[];
	defaultVisible: boolean;
	enabled: boolean;
	order: number;
	iconKey?: string;
};

export const DEFAULT_TIMELINE_LAYERS: TimelineLayerDefinition[] = [
	{
		key: 'project-delivery',
		label: 'Project delivery',
		sourceTypes: ['project-date'],
		defaultVisible: true,
		enabled: true,
		order: 10,
		iconKey: 'milestone',
	},
	{
		key: 'risks',
		label: 'Risks',
		sourceTypes: ['risk'],
		defaultVisible: true,
		enabled: true,
		order: 20,
		iconKey: 'risk',
	},
	{
		key: 'issues',
		label: 'Issues',
		sourceTypes: ['issue'],
		defaultVisible: true,
		enabled: true,
		order: 30,
		iconKey: 'issue',
	},
	{
		key: 'dependencies',
		label: 'Dependencies',
		sourceTypes: ['dependency'],
		defaultVisible: true,
		enabled: true,
		order: 40,
		iconKey: 'dependency',
	},
	{
		key: 'assumptions',
		label: 'Assumptions',
		sourceTypes: ['assumption'],
		defaultVisible: false,
		enabled: false,
		order: 60,
		iconKey: 'assumption',
	},
	{
		key: 'decisions',
		label: 'Decisions',
		sourceTypes: ['decision'],
		defaultVisible: true,
		enabled: true,
		order: 50,
		iconKey: 'decision',
	},
	{
		key: 'actions',
		label: 'Actions',
		sourceTypes: ['action'],
		defaultVisible: false,
		enabled: true,
		order: 70,
		iconKey: 'action',
	},
	{
		key: 'project-events',
		label: 'Project events',
		sourceTypes: ['project-event'],
		defaultVisible: false,
		enabled: false,
		order: 80,
		iconKey: 'system-event',
	},
	{
		key: 'delivery-periods',
		label: 'Delivery periods',
		sourceTypes: ['delivery-period'],
		defaultVisible: false,
		enabled: false,
		order: 90,
		iconKey: 'system-event',
	},
];

export function timelineLayerOrder(layer: string, layers: readonly TimelineLayerDefinition[] = DEFAULT_TIMELINE_LAYERS): number {
	return layers.find((definition) => definition.key === layer)?.order ?? Number.MAX_SAFE_INTEGER;
}
