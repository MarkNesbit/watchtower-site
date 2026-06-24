import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
	PROJECT_RELATIONSHIP_TYPES,
	PROJECT_RELATIONSHIP_TYPE_LABELS,
	isAmbiguousProjectRelationshipType,
	isProjectRelationshipType,
} from '../src/lib/projectRelationships.ts';

const migrationUrl = new URL(
	'../supabase/migrations/20260624000300_project_relationship_foundation.sql',
	import.meta.url,
);
const migrationSql = async () => readFile(migrationUrl, 'utf8');

test('Project relationship helper exposes only the agreed future relationship types', () => {
	assert.deepEqual(PROJECT_RELATIONSHIP_TYPES, [
		'relates_to',
		'dependent_on',
		'required_for',
		'programme',
		'portfolio',
	]);
	for (const relationshipType of PROJECT_RELATIONSHIP_TYPES) {
		assert.equal(isProjectRelationshipType(relationshipType), true);
		assert.equal(typeof PROJECT_RELATIONSHIP_TYPE_LABELS[relationshipType], 'string');
	}
	assert.equal(isProjectRelationshipType('blocks'), false);
	assert.equal(isProjectRelationshipType(null), false);
});

test('Only relates_to is marked as an ambiguous future risk signal', () => {
	assert.equal(isAmbiguousProjectRelationshipType('relates_to'), true);
	for (const relationshipType of PROJECT_RELATIONSHIP_TYPES.filter((value) => value !== 'relates_to')) {
		assert.equal(isAmbiguousProjectRelationshipType(relationshipType), false);
	}
});

test('Relationship migration creates the expected workspace-owned model and type constraint', async () => {
	const sql = await migrationSql();
	assert.match(sql, /create table public\.project_relationships \(/);
	assert.match(sql, /id uuid primary key default gen_random_uuid\(\)/);
	assert.match(sql, /organisation_id uuid not null references public\.organisations\(id\)/);
	assert.match(sql, /source_project_id uuid not null/);
	assert.match(sql, /target_project_id uuid not null/);
	assert.match(sql, /relationship_type text not null/);
	assert.match(sql, /description text/);
	assert.match(sql, /is_active boolean not null default true/);
	assert.match(sql, /created_by uuid not null references public\.profiles\(id\)/);
	assert.match(sql, /updated_by uuid references public\.profiles\(id\)/);
	assert.match(
		sql,
		/check \(relationship_type in \('relates_to', 'dependent_on', 'required_for', 'programme', 'portfolio'\)\)/,
	);
});

test('Relationship migration rejects self-links and duplicate active directed relationships', async () => {
	const sql = await migrationSql();
	assert.match(sql, /check \(source_project_id <> target_project_id\)/);
	assert.match(sql, /create unique index project_relationships_active_unique_key/);
	assert.match(sql, /\(organisation_id, source_project_id, target_project_id, relationship_type\)/);
	assert.match(sql, /where is_active = true/);
});

test('Composite project foreign keys enforce workspace isolation for both endpoints', async () => {
	const sql = await migrationSql();
	assert.match(sql, /foreign key \(source_project_id, organisation_id\)[\s\S]*?references public\.projects\(id, organisation_id\)/);
	assert.match(sql, /foreign key \(target_project_id, organisation_id\)[\s\S]*?references public\.projects\(id, organisation_id\)/);
	assert.doesNotMatch(sql, /foreign key \(source_project_id\)\s+references public\.projects/);
	assert.doesNotMatch(sql, /foreign key \(target_project_id\)\s+references public\.projects/);
});

test('Relationship RLS follows project read and edit roles without granting viewer writes', async () => {
	const sql = await migrationSql();
	assert.match(sql, /alter table public\.project_relationships enable row level security/);
	assert.match(sql, /is_active_organisation_member\(project_relationships\.organisation_id\)/);
	for (const action of ['create', 'update', 'delete']) {
		assert.match(sql, new RegExp(`Owners admins and members can ${action} project relationships`));
	}
	assert.match(sql, /has_active_organisation_role\(project_relationships\.organisation_id, array\['owner', 'admin', 'member'\]\)/);
	assert.doesNotMatch(sql, /array\['owner', 'admin', 'member', 'viewer'\]/);
});

test('Relationship audit fields are server-bound and scope ownership cannot be moved', async () => {
	const sql = await migrationSql();
	assert.match(sql, /create or replace function public\.set_project_relationship_audit_fields\(\)/);
	assert.match(sql, /new\.created_by = auth\.uid\(\)/);
	assert.match(sql, /new\.updated_by = auth\.uid\(\)/);
	assert.match(sql, /old\.organisation_id is distinct from new\.organisation_id/);
	assert.match(sql, /old\.created_by is distinct from new\.created_by/);
	assert.match(sql, /create trigger set_project_relationships_updated_at/);
});
