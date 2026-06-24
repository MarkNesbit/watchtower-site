export const PROJECT_RELATIONSHIP_TYPES = [
	'relates_to',
	'dependent_on',
	'required_for',
	'programme',
	'portfolio',
] as const;

export type ProjectRelationshipType = (typeof PROJECT_RELATIONSHIP_TYPES)[number];

export const PROJECT_RELATIONSHIP_TYPE_LABELS: Readonly<Record<ProjectRelationshipType, string>> = {
	relates_to: 'Relates to',
	dependent_on: 'Dependent on',
	required_for: 'Required for',
	programme: 'Programme',
	portfolio: 'Portfolio',
};

export function isProjectRelationshipType(value: unknown): value is ProjectRelationshipType {
	return typeof value === 'string' && PROJECT_RELATIONSHIP_TYPES.includes(value as ProjectRelationshipType);
}

/**
 * A non-specific relationship is available to future health/risk evaluation as
 * an ambiguity signal. WT-US-0208 deliberately does not create a risk from it.
 */
export function isAmbiguousProjectRelationshipType(value: unknown): value is 'relates_to' {
	return value === 'relates_to';
}
