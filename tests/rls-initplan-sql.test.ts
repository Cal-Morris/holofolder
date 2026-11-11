import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const sql = readFileSync(new URL('../scripts/033_rls_policies_initplan.sql', import.meta.url), 'utf8');
const statements = sql.replace(/--.*$/gm, '');

test('RLS policies evaluate auth.* once per statement', () => {
  // Every auth.uid()/jwt()/role() call is wrapped as (select auth.x()), never called per row.
  const bare = statements.match(/(?<!select )auth\.(uid|jwt|role)\(\)/g) ?? [];
  assert.deepEqual(bare, []);
  assert.ok((statements.match(/\(select auth\.uid\(\)\)/g) ?? []).length > 20);
});

test('RLS rewrite alters policies in place and keeps the partner sharing rule', () => {
  assert.doesNotMatch(statements, /DROP POLICY|CREATE POLICY|DISABLE ROW LEVEL SECURITY/);
  for (const policy of [
    'Users can view own or shared collection',
    'Users can insert into own or shared collection',
    'Users can update own or shared collection',
    'Users can delete from own or shared collection',
  ]) {
    assert.match(statements, new RegExp(`ALTER POLICY "${policy}" ON public\\.pokemon_collection`));
  }
  assert.match(
    statements,
    /SELECT p\.owner_user_id FROM public\.partnerships p\s+WHERE p\.user1_id = \(select auth\.uid\(\)\) OR p\.user2_id = \(select auth\.uid\(\)\)/,
  );
  assert.match(statements, /CREATE INDEX IF NOT EXISTS idx_partnerships_owner_user_id/);
});
