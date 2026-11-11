import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const sql = readFileSync(new URL('../scripts/036_passkey_credentials_owner_only.sql', import.meta.url), 'utf8').replace(
  /--.*$/gm,
  '',
);

test('passkey credentials are no longer readable by everyone', () => {
  assert.match(sql, /DROP POLICY IF EXISTS "Service can lookup credentials by id" ON public\.passkey_credentials;/);
  assert.match(sql, /REVOKE ALL ON public\.passkey_credentials FROM anon;/);
  assert.doesNotMatch(sql, /USING\s*\(\s*true\s*\)/i);
  assert.doesNotMatch(sql, /CREATE POLICY/i);
});
