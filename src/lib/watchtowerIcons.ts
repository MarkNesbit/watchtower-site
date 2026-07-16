import type { IconDefinition } from '@fortawesome/fontawesome-svg-core';
import {
	faArchway,
	faChalkboardUser,
	faChartLine,
	faCircleExclamation,
	faCircleQuestion,
	faCloudArrowUp,
	faDiamond,
	faFlagCheckered,
	faGear,
	faGraduationCap,
	faHeartPulse,
	faLink,
	faMicroscope,
	faPenToSquare,
	faPeopleGroup,
	faPersonCircleCheck,
	faPlay,
	faPuzzlePiece,
	faRightLeft,
	faRocket,
	faShield,
	faSignsPost,
	faSquareCheck,
	faTriangleExclamation,
} from '@fortawesome/free-solid-svg-icons';

export const WATCHTOWER_ICON_KEYS = [
	'project-start',
	'project-end',
	'milestone',
	'gateway',
	'governance-review',
	'meeting',
	'workshop',
	'risk',
	'issue',
	'dependency',
	'assumption',
	'action',
	'decision',
	'uat',
	'testing',
	'load-testing',
	'integration',
	'deployment',
	'cutover',
	'training',
	'go-live',
	'hypercare',
	'manual-diary-entry',
	'system-event',
] as const;

export type WatchtowerIconKey = (typeof WATCHTOWER_ICON_KEYS)[number];
export type WatchtowerIconSize = 'full' | 'medium' | 'small';

export type WatchtowerIconDefinition = {
	key: WatchtowerIconKey;
	icon: IconDefinition;
	colour: string;
	label: string;
	usage?: string;
};

export const WATCHTOWER_ICON_SIZES: Record<WatchtowerIconSize, string> = {
	full: '2rem',
	medium: '1.4rem',
	small: '0.95rem',
};

export const WATCHTOWER_ICON_REGISTRY = {
	'project-start': {
		key: 'project-start',
		icon: faPlay,
		colour: '#059669',
		label: 'Project start',
		usage: 'Project delivery start markers.',
	},
	'project-end': {
		key: 'project-end',
		icon: faFlagCheckered,
		colour: '#16A34A',
		label: 'Project end',
		usage: 'Target or actual project end markers.',
	},
	milestone: {
		key: 'milestone',
		icon: faDiamond,
		colour: '#2563EB',
		label: 'Milestone',
		usage: 'Project milestone dates and milestone-led headings.',
	},
	gateway: {
		key: 'gateway',
		icon: faArchway,
		colour: '#7C3AED',
		label: 'Gateway',
		usage: 'Delivery gateway dates.',
	},
	'governance-review': {
		key: 'governance-review',
		icon: faShield,
		colour: '#6D28D9',
		label: 'Governance review',
		usage: 'Project governance review dates and events.',
	},
	meeting: {
		key: 'meeting',
		icon: faPeopleGroup,
		colour: '#EA580C',
		label: 'Meeting',
		usage: 'Meeting events where already modelled.',
	},
	workshop: {
		key: 'workshop',
		icon: faChalkboardUser,
		colour: '#F97316',
		label: 'Workshop',
		usage: 'Workshop events where already modelled.',
	},
	risk: {
		key: 'risk',
		icon: faTriangleExclamation,
		colour: '#DC2626',
		label: 'Risk',
		usage: 'Risk registers, risk records and risk timeline events.',
	},
	issue: {
		key: 'issue',
		icon: faCircleExclamation,
		colour: '#DC2626',
		label: 'Issue',
		usage: 'Issue records and issue timeline events.',
	},
	dependency: {
		key: 'dependency',
		icon: faLink,
		colour: '#A8B3C7',
		label: 'Dependency',
		usage: 'Dependency records and dependency timeline events.',
	},
	assumption: {
		key: 'assumption',
		icon: faCircleQuestion,
		colour: '#A8B3C7',
		label: 'Assumption',
		usage: 'Assumption records and assumption timeline events.',
	},
	action: {
		key: 'action',
		icon: faSquareCheck,
		colour: '#F6C344',
		label: 'Action',
		usage: 'Action registers, action records and action timeline events.',
	},
	decision: {
		key: 'decision',
		icon: faSignsPost,
		colour: '#A8B3C7',
		label: 'Decision',
		usage: 'Decision records and decision timeline events.',
	},
	uat: {
		key: 'uat',
		icon: faPersonCircleCheck,
		colour: '#0899B2',
		label: 'UAT',
		usage: 'User acceptance testing windows or dates.',
	},
	testing: {
		key: 'testing',
		icon: faMicroscope,
		colour: '#06B6D4',
		label: 'Testing',
		usage: 'Testing windows or dates.',
	},
	'load-testing': {
		key: 'load-testing',
		icon: faChartLine,
		colour: '#0E7490',
		label: 'Load testing',
		usage: 'Load or performance testing windows.',
	},
	integration: {
		key: 'integration',
		icon: faPuzzlePiece,
		colour: '#4F46E5',
		label: 'Integration',
		usage: 'Integration windows or dates.',
	},
	deployment: {
		key: 'deployment',
		icon: faCloudArrowUp,
		colour: '#2563EB',
		label: 'Deployment',
		usage: 'Deployment events or windows.',
	},
	cutover: {
		key: 'cutover',
		icon: faRightLeft,
		colour: '#C026D3',
		label: 'Cutover',
		usage: 'Cutover windows, rehearsals or dates.',
	},
	training: {
		key: 'training',
		icon: faGraduationCap,
		colour: '#CA8A04',
		label: 'Training',
		usage: 'Training dates and windows.',
	},
	'go-live': {
		key: 'go-live',
		icon: faRocket,
		colour: '#16A34A',
		label: 'Go-live',
		usage: 'Go-live dates.',
	},
	hypercare: {
		key: 'hypercare',
		icon: faHeartPulse,
		colour: '#10B981',
		label: 'Hypercare',
		usage: 'Hypercare periods and events.',
	},
	'manual-diary-entry': {
		key: 'manual-diary-entry',
		icon: faPenToSquare,
		colour: '#475569',
		label: 'Manual diary entry',
		usage: 'Manual Project Narrative or Diary entries.',
	},
	'system-event': {
		key: 'system-event',
		icon: faGear,
		colour: '#6B7280',
		label: 'System event',
		usage: 'System-generated entries and unknown event fallbacks.',
	},
} satisfies Record<WatchtowerIconKey, WatchtowerIconDefinition>;

const WATCHTOWER_ICON_ALIASES: Record<string, WatchtowerIconKey> = {
	manual: 'manual-diary-entry',
	system: 'system-event',
	'project-event': 'system-event',
	'target-end': 'project-end',
	review: 'governance-review',
};

const warnedUnknownIconValues = new Set<string>();

function isDevelopmentRuntime(): boolean {
	return Boolean(import.meta.env?.DEV);
}

export function isWatchtowerIconKey(value: unknown): value is WatchtowerIconKey {
	return typeof value === 'string' && WATCHTOWER_ICON_KEYS.includes(value as WatchtowerIconKey);
}

export function resolveWatchtowerIconKey(
	value: unknown,
	options: { warnUnknown?: boolean; context?: string } = {},
): WatchtowerIconKey {
	if (isWatchtowerIconKey(value)) return value;
	if (typeof value === 'string' && WATCHTOWER_ICON_ALIASES[value]) return WATCHTOWER_ICON_ALIASES[value];

	if (options.warnUnknown && isDevelopmentRuntime()) {
		const warningKey = `${options.context ?? 'watchtower-icon'}:${String(value)}`;
		if (!warnedUnknownIconValues.has(warningKey)) {
			warnedUnknownIconValues.add(warningKey);
			console.warn(`Unknown Watchtower icon "${String(value)}" in ${options.context ?? 'semantic icon mapping'}; using system-event.`);
		}
	}

	return 'system-event';
}

export function getWatchtowerIconDefinition(value: unknown): WatchtowerIconDefinition {
	return WATCHTOWER_ICON_REGISTRY[resolveWatchtowerIconKey(value)];
}

export function getWatchtowerIconSvgData(
	value: unknown,
	options: { warnUnknown?: boolean; context?: string } = {},
) {
	const key = resolveWatchtowerIconKey(value, options);
	const definition = WATCHTOWER_ICON_REGISTRY[key];
	const [width, height, , , pathData] = definition.icon.icon;
	return {
		key,
		iconName: definition.icon.iconName,
		colour: definition.colour,
		label: definition.label,
		viewBox: `0 0 ${width} ${height}`,
		pathData: Array.isArray(pathData) ? pathData : [pathData],
	};
}
