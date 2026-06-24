const GENERIC_REFERENCE_TERMS = new Set([
	'CRM','APP','WEB','API','MVP','CMS','ERP','INT','MIG','SUPPORT','DISCOVERY','PORTAL','WEBSITE','REBUILD','MIGRATION','INTEGRATION','PLATFORM','PROJECT','PROGRAMME','PHASE',
]);

function wordsFromName(name: string): string[] {
	return name
		.normalize('NFKD')
		.replace(/[\u0300-\u036f]/g, '')
		.toUpperCase()
		.replace(/[^A-Z0-9]+/g, ' ')
		.trim()
		.split(/\s+/)
		.filter(Boolean);
}

export function normaliseProjectRef(value: string): string {
	return value.trim().toUpperCase();
}

export function isValidProjectRef(value: string): boolean {
	return /^[A-Z][A-Z0-9]{2,3}$/.test(normaliseProjectRef(value));
}

export function projectRefValidationMessage(value: string): string | null {
	if (isValidProjectRef(value)) return null;
	if (!normaliseProjectRef(value)) return 'Project reference is required.';
	return 'Project reference must be 3–4 uppercase letters or numbers and start with a letter.';
}

export function suggestProjectRef(name: string): string {
	const words = wordsFromName(name);
	if (words.length === 0) return '';

	const distinctiveWords = words.filter((word) => !GENERIC_REFERENCE_TERMS.has(word));
	const firstDistinctiveIndex = words.findIndex((word) => !GENERIC_REFERENCE_TERMS.has(word) && /^[A-Z]/.test(word));
	const acronymWords = firstDistinctiveIndex >= 0 ? words.slice(firstDistinctiveIndex).filter((word) => /^[A-Z]/.test(word)) : [];
	if (acronymWords.length >= 3) return acronymWords.slice(0, 4).map((word) => word[0]).join('').slice(0, 4);

	const sourceWords = distinctiveWords.length > 0 ? distinctiveWords : words;
	const letterWords = sourceWords.filter((word) => /^[A-Z]/.test(word));
	const usableWords = letterWords.length > 0 ? letterWords : sourceWords;

	if (usableWords.length === 2) {
		const [first, second] = usableWords;
		return `${first[0]}${second[0]}${second[1] ?? first[1] ?? 'X'}`.slice(0, 4);
	}

	const compact = usableWords[0].replace(/[^A-Z0-9]/g, '');
	if (/^[A-Z]/.test(compact)) return compact.slice(0, 4).padEnd(3, compact[0] || 'X');
	return '';
}

export function buildUniqueProjectRef(preferredRef: string, existingRefs: string[]): string {
	const existing = new Set(existingRefs.map(normaliseProjectRef));
	const preferred = normaliseProjectRef(preferredRef);
	if (isValidProjectRef(preferred) && !existing.has(preferred)) return preferred;

	const base = preferred.replace(/[^A-Z0-9]/g, '').replace(/^[^A-Z]+/, '').slice(0, 4);
	for (const rootLength of [3, 2]) {
		const root = base.slice(0, rootLength);
		if (!/^[A-Z][A-Z0-9]{1,2}$/.test(root)) continue;
		for (let suffix = 1; suffix <= 99; suffix += 1) {
			const candidate = `${root}${suffix}`.slice(0, 4);
			if (isValidProjectRef(candidate) && !existing.has(candidate)) return candidate;
		}
	}
	return preferred;
}
