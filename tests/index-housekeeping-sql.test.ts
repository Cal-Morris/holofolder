import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const sql = readFileSync(new URL('../scripts/034_drop_duplicate_and_unused_indexes.sql', import.meta.url), 'utf8');
const statements = sql
  .replace(/--.*$/gm, '')
  .split(';')
  .map((statement) => statement.trim())
  .filter(Boolean);

test('index housekeeping is live-safe and idempotent', () => {
  assert.ok(statements.length > 0);
  for (const statement of statements) {
    assert.match(statement, /^(DROP INDEX CONCURRENTLY IF EXISTS|CREATE INDEX CONCURRENTLY IF NOT EXISTS) /);
  }
  // CONCURRENTLY cannot run inside a transaction block.
  assert.doesNotMatch(sql.replace(/--.*$/gm, ''), /\bBEGIN\b|\bCOMMIT\b/i);
});

test('index housekeeping keeps the unique indexes the app relies on', () => {
  assert.doesNotMatch(sql, /DROP (INDEX|CONSTRAINT)[^;]*(_pkey|_key|unique)/i);
});
