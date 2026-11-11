import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('legacy nullability catch-up preserves existing values and uses guarded app defaults', () => {
  const sql = readFileSync(new URL('../scripts/025_restore_legacy_not_null_contracts.sql', import.meta.url), 'utf8');
  assert.match(sql, /SET status = 'collected'\s+WHERE status IS NULL/);
  for (const column of ['binder_rows', 'binder_cols'])
    assert.match(sql, new RegExp(`${column} = COALESCE\\(${column}, 4\\)`));
  assert.match(sql, /created_at = COALESCE\(created_at, updated_at, now\(\)\)/);
  assert.match(sql, /updated_at = COALESCE\(updated_at, created_at, now\(\)\)/);
  for (const column of ['status', 'binder_rows', 'binder_cols', 'created_at', 'updated_at'])
    assert.match(sql, new RegExp(`ALTER COLUMN ${column} SET NOT NULL`));
  assert.equal((sql.match(/UPDATE public\./g) ?? []).length, 2);
  assert.doesNotMatch(sql, /UPDATE public\.(card_prices|tcg_cards)|DROP /);
});
