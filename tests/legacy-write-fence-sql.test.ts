import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const sql = readFileSync(new URL('../scripts/096_legacy_write_fence.sql', import.meta.url), 'utf8')

test('096 installs an inactive monotonic shared DML fence without changing admission/grants', () => {
  assert.match(sql, /LOCK TABLE public\.pokemon_collection IN SHARE ROW EXCLUSIVE MODE/)
  assert.match(sql, /IF to_regclass\('collection_audit_private\.legacy_write_fence'\) IS NULL THEN[\s\S]*VALUES\(true,false\)/)
  assert.doesNotMatch(sql, /ON CONFLICT|GRANT |pg_trigger_depth|pg_advisory/)
  assert.match(sql, /WHERE id FOR SHARE/)
  assert.match(sql, /WHEN serialization_failure OR lock_not_available/)
  assert.match(sql, /ERRCODE='PT503'/)
  assert.match(sql, /retainOnDevice=true/)
  assert.match(sql, /NOT OLD\.enforced OR NEW\.enforced/)
  assert.match(sql, /BEFORE INSERT OR UPDATE OR DELETE ON public\.pokemon_collection\s+FOR EACH STATEMENT/)
  assert.match(sql, /BEFORE INSERT OR UPDATE OR DELETE ON public\.pokemon_collection\s+FOR EACH ROW/)
  assert.equal((sql.match(/ENABLE ALWAYS TRIGGER/g) ?? []).length, 2)
})

test('trusted context distinguishes queue purpose, developer authority and exact recovery', () => {
  assert.match(sql, /current_setting\('role',true\)='service_role'/)
  assert.match(sql, /collection_audit_private\.context\(target_owner\)/)
  assert.match(sql, /raw_context->>'purpose'='legacy\.queue'/)
  assert.match(sql, /raw_context->'legacyQueueGeneration'='2'::jsonb/)
  assert.match(sql, /ctx->>'source' IN \('rest','mcp'\)/)
  assert.match(sql, /p\.transaction_id=txid_current\(\)/)
  assert.match(sql, /nullif\(d->'after','null'\) IS NOT DISTINCT FROM before_row/)
  assert.match(sql, /nullif\(d->'before','null'\) IS NOT DISTINCT FROM after_row/)
  assert.match(sql, /frozen_restore_v1\(NEW\)/)
  assert.match(sql, /TG_OP='DELETE'[\s\S]*NOT EXISTS\(SELECT 1 FROM public\.binders/)
  assert.match(sql, /096 exact inverse authority, after all existing preview\/token\/lock checks/)
})
