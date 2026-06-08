export type Product = {
	name: string;
	slug: string;
	logo: string;
	positioning: string;
	summary: string;
	status: string;
	problem: string;
	vision: string;
	approach: string[];
	future: string[];
};

export const products: Product[] = [
	{
		name: 'Jektor',
		slug: 'jektor',
		logo: '/images/jektor-logo.png',
		positioning: 'Forecast using evidence, not opinion.',
		summary:
			'Evidence-based delivery forecasting that helps teams and leaders understand likely outcomes using delivery signals, not optimism or pressure.',
		status: 'Concept and MVP planning',
		problem:
			'Delivery forecasts are often shaped by confidence, status pressure and disconnected reporting cycles. Jektor exists to make forecasting more objective, traceable and useful for decision-making.',
		vision:
			'Jektor will help delivery organisations create transparent forecasts grounded in evidence, allowing teams to discuss risk earlier and leaders to make decisions with greater confidence.',
		approach: [
			'Use delivery evidence as the basis for forecast conversations.',
			'Surface assumptions, uncertainty and confidence clearly.',
			'Create a shared language between teams, programmes and portfolios.',
		],
		future: [
			'MVP exploration for evidence models and forecast communication.',
			'Practical views for delivery teams and leadership audiences.',
			'Integration opportunities with existing delivery data sources.',
		],
	},
	{
		name: 'Sentinel',
		slug: 'sentinel',
		logo: '/images/sentinel-logo.png',
		positioning: 'Visibility, governance and confidence at every level of delivery.',
		summary:
			'Governance intelligence for delivery environments where visibility, consistency and confidence matter across teams, programmes and portfolios.',
		status: 'Product direction defined',
		problem:
			'Governance can become fragmented across tools, meetings and reports. Sentinel is intended to support clearer oversight without adding unnecessary process burden.',
		vision:
			'Sentinel will provide a practical governance intelligence layer that helps delivery leaders understand where attention is needed and why it matters.',
		approach: [
			'Focus governance conversations on evidence, risk and outcomes.',
			'Provide portfolio-level visibility without losing delivery context.',
			'Support consistent decision-making across levels of delivery.',
		],
		future: [
			'Define governance intelligence patterns for programmes and portfolios.',
			'Explore lightweight oversight models for delivery leadership.',
			'Connect governance signals with forecasting and narrative intelligence.',
		],
	},
	{
		name: 'TorchLite',
		slug: 'torchlite',
		logo: '/images/torchlite-logo.png',
		positioning: 'Delivery clarity without the complexity.',
		summary:
			'Narrative intelligence that helps delivery teams communicate progress, risk and confidence in language that is clear, consistent and useful.',
		status: 'MVP candidate',
		problem:
			'Delivery reporting can be time-consuming, inconsistent and difficult to interpret. TorchLite is intended to help teams communicate what matters without creating more reporting overhead.',
		vision:
			'TorchLite will help turn delivery signals into clear narratives that support alignment between teams, stakeholders and leadership.',
		approach: [
			'Prioritise plain-language delivery communication.',
			'Help teams explain progress, risk and confidence consistently.',
			'Support narrative clarity without replacing delivery judgement.',
		],
		future: [
			'MVP exploration for delivery narrative workflows.',
			'Guidance for consistent progress and risk communication.',
			'Connections to evidence and governance intelligence over time.',
		],
	},
];

export const roadmapPhases = [
	{
		phase: 'Phase 1',
		title: 'Platform Website',
		description:
			'Establish the WatchTower public presence, product positioning and foundational marketing structure.',
		status: 'Current foundation',
	},
	{
		phase: 'Phase 2',
		title: 'Jektor MVP',
		description:
			'Explore an evidence-based delivery forecasting MVP focused on clear assumptions, confidence and forecast conversations.',
		status: 'Directional',
	},
	{
		phase: 'Phase 3',
		title: 'TorchLite MVP',
		description:
			'Develop narrative intelligence concepts that help teams communicate delivery progress and risk with clarity.',
		status: 'Directional',
	},
	{
		phase: 'Phase 4',
		title: 'Sentinel MVP',
		description:
			'Shape governance intelligence capabilities for teams, programmes and portfolios.',
		status: 'Directional',
	},
];
