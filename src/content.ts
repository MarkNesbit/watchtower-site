export type Product = {
	name: string;
	slug: string;
	logo?: string;
	label: string;
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
		name: 'WatchTower Forecast',
		slug: 'forecast',
		logo: 'public/images/watchtower-logo.svg',
		label: 'Core product',
		positioning: 'Monte Carlo forecasting based on delivery-period throughput.',
		summary:
			'Forecast delivery windows using real team throughput data, confidence ranges and clear assumptions rather than guesswork or status theatre.',
		status: 'Forecasting MVP focus',
		problem:
			'Delivery teams are often asked for dates before there is enough evidence to support a single answer. WatchTower Forecast is focused on helping leaders communicate likely delivery windows, confidence and risk using throughput data.',
		vision:
			'WatchTower Forecast will provide a calm, evidence-led forecasting experience for teams and leaders who need to understand delivery probability without turning forecasting into a heavy governance exercise.',
		approach: [
			'Use delivery-period throughput as the primary forecasting input.',
			'Present forecast windows, confidence levels and assumptions clearly.',
			'Help delivery leaders explain uncertainty without losing stakeholder trust.',
		],
		future: [
			'Monte Carlo forecast views for team-level delivery windows.',
			'Confidence and risk summaries that can be used in delivery conversations.',
			'Workspace foundations for teams managing scope, throughput and reliability.',
		],
	},
	{
		name: 'WatchTower Narrative',
		slug: 'narrative',
		label: 'Future product',
		positioning: 'Evidence-based delivery narrative for clearer stakeholder communication.',
		summary:
			'Future narrative intelligence to help teams explain progress, risk and confidence in plain language grounded in delivery evidence.',
		status: 'Future direction',
		problem:
			'Delivery updates often drift into subjective commentary. WatchTower Narrative is intended to help teams communicate delivery reality in a consistent, evidence-led way.',
		vision:
			'WatchTower Narrative will support clearer reporting and stakeholder communication by turning delivery signals into concise, understandable narratives.',
		approach: [
			'Keep communication grounded in delivery evidence.',
			'Help teams explain risk and confidence without ambiguity.',
			'Create reusable language for delivery updates and decision forums.',
		],
		future: [
			'Delivery update drafting support.',
			'Risk and confidence narrative patterns.',
			'Connections to forecasting and portfolio signals.',
		],
	},
	{
		name: 'WatchTower Signals',
		slug: 'signals',
		label: 'Future product',
		positioning: 'Early-warning indicators for delivery risk and reliability.',
		summary:
			'Future signal intelligence to highlight changes in volatility, reliability and delivery risk before they become delivery surprises.',
		status: 'Future direction',
		problem:
			'Delivery risk is often recognised too late. WatchTower Signals is intended to surface early indicators that deserve attention before a forecast becomes unreliable.',
		vision:
			'WatchTower Signals will act as an early-warning layer for delivery teams and leaders, making risk patterns easier to identify and discuss.',
		approach: [
			'Monitor delivery indicators that affect forecast confidence.',
			'Show risk signals in a calm, prioritised way.',
			'Connect signal trends to practical delivery conversations.',
		],
		future: [
			'Scope volatility and throughput stability indicators.',
			'Reliability and confidence trend summaries.',
			'Portfolio-level risk signal aggregation.',
		],
	},
	{
		name: 'WatchTower Portfolio',
		slug: 'portfolio',
		label: 'Future product',
		positioning: 'Portfolio-level delivery intelligence for senior leaders.',
		summary:
			'Future portfolio intelligence to help senior delivery leaders compare confidence, risk and reliability across teams and initiatives.',
		status: 'Future direction',
		problem:
			'Portfolio conversations often depend on inconsistent reporting from multiple teams. WatchTower Portfolio is intended to create a clearer view of delivery confidence across initiatives.',
		vision:
			'WatchTower Portfolio will help delivery and technology leaders understand where confidence is strong, where risk is rising and where support is needed.',
		approach: [
			'Aggregate delivery intelligence without hiding team context.',
			'Prioritise confidence, risk and reliability over vanity reporting.',
			'Support portfolio decisions with comparable evidence.',
		],
		future: [
			'Portfolio confidence and risk summaries.',
			'Cross-team reliability and volatility views.',
			'Leadership-ready delivery intelligence snapshots.',
		],
	},
];

export const roadmapPhases = [
	{
		phase: 'Phase 1',
		title: 'Forecasting MVP',
		description:
			'Build the first WatchTower Forecast experience around delivery-period throughput, Monte Carlo forecast windows and confidence communication.',
		status: 'Current focus',
	},
	{
		phase: 'Phase 2',
		title: 'Team Workspace',
		description:
			'Create workspace foundations for teams to manage delivery data, assumptions, scope movement and forecast conversations in one place.',
		status: 'Next direction',
	},
	{
		phase: 'Phase 3',
		title: 'Delivery Intelligence Platform',
		description:
			'Expand WatchTower into a broader delivery intelligence platform spanning forecasting, signals, narrative and portfolio insight.',
		status: 'Future direction',
	},
];
