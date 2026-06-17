export function slugifyProjectName(name: string): string {
	const slug = name
		.normalize('NFKD')
		.replace(/[\u0300-\u036f]/g, '')
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.replace(/-{2,}/g, '-');

	return slug || 'project';
}

export function buildUniqueSlug(baseSlug: string, existingSlugs: Iterable<string>): string {
	const used = new Set([...existingSlugs]);
	let candidate = baseSlug;
	let suffix = 2;

	while (used.has(candidate)) {
		candidate = `${baseSlug}-${suffix}`;
		suffix += 1;
	}

	return candidate;
}
