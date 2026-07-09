#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const RISK_PROMPT_CSV_HEADERS = [
	'risk_prompt_id',
	'risk_library_key',
	'risk_library_version',
	'risk_area_key',
	'risk_area_title',
	'risk_area_order',
	'risk_prompt_title',
	'risk_prompt_guidance',
	'risk_prompt_order',
	'risk_prompt_is_active',
	'risk_default_status',
	'risk_source_reference',
	'risk_tags',
];

const __dirname = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_RISK_PROMPT_CSV_PATH = resolve(__dirname, '../data/risk-prompts/watchtower_default_risk_prompt_library_v1_0.csv');
export const DEFAULT_RISK_PROMPT_SQL_PATH = resolve(__dirname, '../supabase/seed-risk-prompts.sql');

export function parseCsv(content) {
	const input = content.replace(/^\uFEFF/, '');
	const rows = [];
	let row = [];
	let value = '';
	let inQuotes = false;

	for (let index = 0; index < input.length; index += 1) {
		const char = input[index];
		const next = input[index + 1];

		if (char === '"') {
			if (inQuotes && next === '"') {
				value += '"';
				index += 1;
			} else {
				inQuotes = !inQuotes;
			}
			continue;
		}

		if (char === ',' && !inQuotes) {
			row.push(value);
			value = '';
			continue;
		}

		if ((char === '\n' || char === '\r') && !inQuotes) {
			if (char === '\r' && next === '\n') index += 1;
			row.push(value);
			if (row.some((cell) => cell.length > 0)) rows.push(row);
			row = [];
			value = '';
			continue;
		}

		value += char;
	}

	if (inQuotes) throw new Error('Invalid CSV: quoted field is not closed.');
	if (value.length > 0 || row.length > 0) {
		row.push(value);
		if (row.some((cell) => cell.length > 0)) rows.push(row);
	}

	if (rows.length === 0) throw new Error('Invalid CSV: file is empty.');
	return rows;
}

const parseBoolean = (value, rowNumber) => {
	const normalised = value.trim().toLowerCase();
	if (normalised === 'true') return true;
	if (normalised === 'false') return false;
	throw new Error(`Invalid CSV row ${rowNumber}: risk_prompt_is_active must be true or false.`);
};

const parsePositiveInteger = (value, field, rowNumber) => {
	if (!/^[1-9][0-9]*$/.test(value.trim())) {
		throw new Error(`Invalid CSV row ${rowNumber}: ${field} must be a positive integer.`);
	}
	return Number(value.trim());
};

const requireValue = (row, field, rowNumber) => {
	const value = row[field]?.trim() ?? '';
	if (!value) throw new Error(`Invalid CSV row ${rowNumber}: ${field} is required.`);
	return value;
};

const splitTags = (value) => value
	.split(',')
	.map((tag) => tag.trim())
	.filter(Boolean);

export function validateRiskPromptCsv(content) {
	const rows = parseCsv(content);
	const headers = rows[0].map((header) => header.trim());
	const missingHeaders = RISK_PROMPT_CSV_HEADERS.filter((header) => !headers.includes(header));
	if (missingHeaders.length > 0) {
		throw new Error(`Invalid CSV: missing required headers ${missingHeaders.join(', ')}.`);
	}

	const unexpectedShape = rows.slice(1).findIndex((row) => row.length !== headers.length);
	if (unexpectedShape !== -1) {
		throw new Error(`Invalid CSV row ${unexpectedShape + 2}: expected ${headers.length} fields.`);
	}

	const records = rows.slice(1).map((cells, index) => {
		const rowNumber = index + 2;
		const raw = Object.fromEntries(headers.map((header, cellIndex) => [header, cells[cellIndex] ?? '']));
		const record = {
			risk_prompt_id: requireValue(raw, 'risk_prompt_id', rowNumber),
			risk_library_key: requireValue(raw, 'risk_library_key', rowNumber),
			risk_library_version: requireValue(raw, 'risk_library_version', rowNumber),
			risk_area_key: requireValue(raw, 'risk_area_key', rowNumber),
			risk_area_title: requireValue(raw, 'risk_area_title', rowNumber),
			risk_area_order: parsePositiveInteger(raw.risk_area_order ?? '', 'risk_area_order', rowNumber),
			risk_prompt_title: requireValue(raw, 'risk_prompt_title', rowNumber),
			risk_prompt_guidance: requireValue(raw, 'risk_prompt_guidance', rowNumber),
			risk_prompt_order: parsePositiveInteger(raw.risk_prompt_order ?? '', 'risk_prompt_order', rowNumber),
			risk_prompt_is_active: parseBoolean(raw.risk_prompt_is_active ?? '', rowNumber),
			risk_default_status: requireValue(raw, 'risk_default_status', rowNumber),
			risk_source_reference: (raw.risk_source_reference ?? '').trim(),
			risk_tags: splitTags(raw.risk_tags ?? ''),
		};

		if (record.risk_default_status !== 'draft') {
			throw new Error(`Invalid CSV row ${rowNumber}: risk_default_status must be draft for the MVP library.`);
		}

		return record;
	});

	if (records.length === 0) throw new Error('Invalid CSV: no prompt rows found.');

	const promptIds = new Set();
	const libraryKeys = new Set();
	const libraryVersions = new Set();
	const areaByKey = new Map();
	const areaOrderByLibrary = new Map();
	const promptOrderByArea = new Map();

	for (const record of records) {
		if (promptIds.has(record.risk_prompt_id)) {
			throw new Error(`Invalid CSV: duplicate risk_prompt_id ${record.risk_prompt_id}.`);
		}
		promptIds.add(record.risk_prompt_id);
		libraryKeys.add(record.risk_library_key);
		libraryVersions.add(record.risk_library_version);

		const areaIdentity = `${record.risk_library_key}::${record.risk_library_version}::${record.risk_area_key}`;
		const existingArea = areaByKey.get(areaIdentity);
		if (existingArea && (existingArea.title !== record.risk_area_title || existingArea.order !== record.risk_area_order)) {
			throw new Error(`Invalid CSV: risk area ${record.risk_area_key} has inconsistent title or ordering.`);
		}
		areaByKey.set(areaIdentity, { title: record.risk_area_title, order: record.risk_area_order });

		const areaOrderIdentity = `${record.risk_library_key}::${record.risk_library_version}::${record.risk_area_order}`;
		const existingAreaKey = areaOrderByLibrary.get(areaOrderIdentity);
		if (existingAreaKey && existingAreaKey !== record.risk_area_key) {
			throw new Error(`Invalid CSV: duplicate risk_area_order ${record.risk_area_order} in library ${record.risk_library_key} ${record.risk_library_version}.`);
		}
		areaOrderByLibrary.set(areaOrderIdentity, record.risk_area_key);

		const promptOrderIdentity = `${areaIdentity}::${record.risk_prompt_order}`;
		const existingPromptId = promptOrderByArea.get(promptOrderIdentity);
		if (existingPromptId && existingPromptId !== record.risk_prompt_id) {
			throw new Error(`Invalid CSV: duplicate risk_prompt_order ${record.risk_prompt_order} in risk area ${record.risk_area_key}.`);
		}
		promptOrderByArea.set(promptOrderIdentity, record.risk_prompt_id);
	}

	if (libraryKeys.size !== 1 || libraryVersions.size !== 1) {
		throw new Error('Invalid CSV: WT-RISK-GUIDE-001 expects one library key and version per seed file.');
	}

	const areas = [...areaByKey.entries()]
		.map(([identity, area]) => {
			const [, , risk_area_key] = identity.split('::');
			const active = records.some((record) => record.risk_area_key === risk_area_key && record.risk_prompt_is_active);
			return {
				risk_area_key,
				risk_area_title: area.title,
				risk_area_order: area.order,
				is_active: active,
			};
		})
		.sort((a, b) => a.risk_area_order - b.risk_area_order || a.risk_area_key.localeCompare(b.risk_area_key));

	return {
		library: {
			risk_library_key: records[0].risk_library_key,
			risk_library_version: records[0].risk_library_version,
			name: records[0].risk_source_reference || 'Watchtower Default Risk Prompt Library',
			description: 'A structured starter library of common project risk areas and prompts for guided Draft risk creation.',
			is_default: true,
			is_active: true,
		},
		areas,
		prompts: records.sort((a, b) => a.risk_prompt_id.localeCompare(b.risk_prompt_id)),
	};
}

const sqlString = (value) => value === null || value === undefined || value === ''
	? 'null'
	: `'${String(value).replaceAll("'", "''")}'`;

const sqlBoolean = (value) => value ? 'true' : 'false';
const sqlArray = (values) => `array[${values.map(sqlString).join(', ')}]::text[]`;

export function buildRiskPromptSeedSql(seed) {
	const library = seed.library;
	const areaRows = seed.areas
		.map((area) => `    (${sqlString(area.risk_area_key)}, ${sqlString(area.risk_area_title)}, ${area.risk_area_order}, ${sqlBoolean(area.is_active)})`)
		.join(',\n');
	const promptRows = seed.prompts
		.map((prompt) => `    (${sqlString(prompt.risk_prompt_id)}, ${sqlString(prompt.risk_area_key)}, ${sqlString(prompt.risk_prompt_title)}, ${sqlString(prompt.risk_prompt_guidance)}, ${prompt.risk_prompt_order}, ${sqlBoolean(prompt.risk_prompt_is_active)}, ${sqlString(prompt.risk_default_status)}, ${sqlString(prompt.risk_source_reference)}, ${sqlArray(prompt.risk_tags)})`)
		.join(',\n');
	const promptIds = seed.prompts.map((prompt) => sqlString(prompt.risk_prompt_id)).join(', ');

	return `-- Generated by scripts/seed-risk-prompts.mjs from data/risk-prompts/watchtower_default_risk_prompt_library_v1_0.csv.
-- Safe to rerun. Removed CSV rows are intentionally not deleted from the database.

begin;

with upsert_library as (
  insert into public.risk_prompt_libraries (
    risk_library_key,
    risk_library_version,
    name,
    description,
    is_default,
    is_active
  )
  values (
    ${sqlString(library.risk_library_key)},
    ${sqlString(library.risk_library_version)},
    ${sqlString(library.name)},
    ${sqlString(library.description)},
    ${sqlBoolean(library.is_default)},
    ${sqlBoolean(library.is_active)}
  )
  on conflict (risk_library_key, risk_library_version) do update
    set name = excluded.name,
        description = excluded.description,
        is_default = excluded.is_default,
        is_active = excluded.is_active,
        updated_at = now()
  returning id
),
area_source (risk_area_key, risk_area_title, risk_area_order, is_active) as (
  values
${areaRows}
),
upsert_areas as (
  insert into public.risk_prompt_areas (
    risk_prompt_library_id,
    risk_area_key,
    risk_area_title,
    risk_area_order,
    is_active
  )
  select
    upsert_library.id,
    area_source.risk_area_key,
    area_source.risk_area_title,
    area_source.risk_area_order,
    area_source.is_active
  from upsert_library
  cross join area_source
  on conflict (risk_prompt_library_id, risk_area_key) do update
    set risk_area_title = excluded.risk_area_title,
        risk_area_order = excluded.risk_area_order,
        is_active = excluded.is_active,
        updated_at = now()
  returning id, risk_area_key
)
select count(*) from upsert_areas;

do $$
declare
  target_library_id uuid;
  conflicting_prompt_id text;
begin
  select id into target_library_id
  from public.risk_prompt_libraries
  where risk_library_key = ${sqlString(library.risk_library_key)}
    and risk_library_version = ${sqlString(library.risk_library_version)};

  select risk_prompt_id into conflicting_prompt_id
  from public.risk_prompts
  where risk_prompt_id in (${promptIds})
    and risk_prompt_library_id <> target_library_id
  limit 1;

  if conflicting_prompt_id is not null then
    raise exception 'risk_prompt_id % already belongs to a different library version', conflicting_prompt_id;
  end if;
end $$;

with target_library as (
  select id
  from public.risk_prompt_libraries
  where risk_library_key = ${sqlString(library.risk_library_key)}
    and risk_library_version = ${sqlString(library.risk_library_version)}
),
prompt_source (
  risk_prompt_id,
  risk_area_key,
  risk_prompt_title,
  risk_prompt_guidance,
  risk_prompt_order,
  risk_prompt_is_active,
  risk_default_status,
  risk_source_reference,
  risk_tags
) as (
  values
${promptRows}
)
insert into public.risk_prompts (
  risk_prompt_library_id,
  risk_prompt_area_id,
  risk_prompt_id,
  risk_prompt_title,
  risk_prompt_guidance,
  risk_prompt_order,
  risk_prompt_is_active,
  risk_default_status,
  risk_source_reference,
  risk_tags
)
select
  target_library.id,
  risk_prompt_areas.id,
  prompt_source.risk_prompt_id,
  prompt_source.risk_prompt_title,
  prompt_source.risk_prompt_guidance,
  prompt_source.risk_prompt_order,
  prompt_source.risk_prompt_is_active,
  prompt_source.risk_default_status,
  prompt_source.risk_source_reference,
  prompt_source.risk_tags
from target_library
join prompt_source on true
join public.risk_prompt_areas
  on risk_prompt_areas.risk_prompt_library_id = target_library.id
 and risk_prompt_areas.risk_area_key = prompt_source.risk_area_key
on conflict (risk_prompt_id) do update
  set risk_prompt_title = excluded.risk_prompt_title,
      risk_prompt_guidance = excluded.risk_prompt_guidance,
      risk_prompt_order = excluded.risk_prompt_order,
      risk_prompt_is_active = excluded.risk_prompt_is_active,
      risk_default_status = excluded.risk_default_status,
      risk_source_reference = excluded.risk_source_reference,
      risk_tags = excluded.risk_tags,
      risk_prompt_area_id = excluded.risk_prompt_area_id,
      updated_at = now();

commit;
`;
}

export async function loadRiskPromptSeed(csvPath = DEFAULT_RISK_PROMPT_CSV_PATH) {
	const content = await readFile(csvPath, 'utf8');
	return validateRiskPromptCsv(content);
}

async function main(argv) {
	const args = new Set(argv);
	const csvArgIndex = argv.indexOf('--csv');
	const outArgIndex = argv.indexOf('--write-sql');
	const csvPath = csvArgIndex === -1 ? DEFAULT_RISK_PROMPT_CSV_PATH : resolve(argv[csvArgIndex + 1] ?? '');
	const sqlPath = outArgIndex === -1
		? DEFAULT_RISK_PROMPT_SQL_PATH
		: argv[outArgIndex + 1]
			? resolve(argv[outArgIndex + 1])
			: DEFAULT_RISK_PROMPT_SQL_PATH;
	const seed = await loadRiskPromptSeed(csvPath);
	const sql = buildRiskPromptSeedSql(seed);

	if (args.has('--write-sql')) {
		await mkdir(dirname(sqlPath), { recursive: true });
		await writeFile(sqlPath, sql, 'utf8');
		console.log(`Wrote ${sqlPath}`);
	}

	if (args.has('--apply')) {
		const databaseUrl = process.env.DATABASE_URL;
		if (!databaseUrl) throw new Error('DATABASE_URL is required when using --apply.');
		const result = spawnSync('psql', [databaseUrl, '--set', 'ON_ERROR_STOP=1'], {
			input: sql,
			stdio: ['pipe', 'inherit', 'inherit'],
			encoding: 'utf8',
		});
		if (result.status !== 0) throw new Error(`psql failed with exit code ${result.status}.`);
	}

	if (!args.has('--write-sql') && !args.has('--apply')) {
		console.log(`Validated ${seed.prompts.length} risk prompts across ${seed.areas.length} risk areas.`);
	}
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
	main(process.argv.slice(2)).catch((error) => {
		console.error(error instanceof Error ? error.message : error);
		process.exit(1);
	});
}
