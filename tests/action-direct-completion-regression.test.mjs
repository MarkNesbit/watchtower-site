import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const migration = new URL('../supabase/migrations/20260731001500_action_completion_mode_unification.sql', import.meta.url);
const route = new URL('../src/pages/app/workspaces/[workspaceSlug]/projects/[projectId]/actions.astro', import.meta.url);

test('direct completion permits current Actioner from Open or Returned only when no Approver is required', async () => {
	const sql = await readFile(migration, 'utf8');
	assert.match(sql, /if v_action\.approval_required then[\s\S]*status <> 'submitted'/);
	assert.match(sql, /status not in \('open', 'returned_to_actioner'\)/);
	assert.match(sql, /project_action_resolve_stored_responsibility/);
	assert.match(sql, /Only the current Actioner can complete this Action/);
	assert.match(sql, /'completion_route', 'direct'/);
	assert.match(sql, /'completion_route', 'approved'/);
});

test('Action UI offers direct completion only for the same no-Approver Actioner contract', async () => {
	const page = await readFile(route, 'utf8');
	assert.match(page, /canRespondToSelectedAction[\s\S]*\['open', 'returned_to_actioner'\]/);
	assert.match(page, /canDirectCompleteSelectedAction = Boolean\(canRespondToSelectedAction && !selectedAction\?\.approval_required\)/);
	assert.match(page, /intent === 'direct-complete'[\s\S]*completeProjectAction\(serverSupabase, expected\)/);
});
