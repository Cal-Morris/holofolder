import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (name: string) => readFileSync(new URL(`../scripts/${name}`, import.meta.url), 'utf8');

test('migration 039 is additive and keeps old clients working', () => {
  const sql = read('039_binders.sql');
  assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.binders/);
  assert.match(sql, /BEFORE INSERT ON public\.pokemon_collection/);
  assert.doesNotMatch(sql, /DROP CONSTRAINT IF EXISTS pokemon_collection_user_id_pokemon_id_key/);
  assert.doesNotMatch(sql, /SET NOT NULL/);
  assert.match(sql, /CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS pokemon_collection_binder_pokemon_unique/);
});

test('migration 040 only tightens what the binder-aware code relies on', () => {
  const sql = read('040_binders_finalize.sql');
  assert.match(sql, /pokemon_collection ALTER COLUMN binder_id SET NOT NULL/);
  assert.match(sql, /DROP CONSTRAINT IF EXISTS pokemon_collection_user_id_pokemon_id_key/);
  assert.match(sql, /DROP CONSTRAINT IF EXISTS binder_shares_owner_unique/);
  assert.doesNotMatch(sql, /DROP INDEX|DROP TABLE|DELETE FROM/i);
});
