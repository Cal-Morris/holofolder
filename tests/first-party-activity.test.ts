import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
test('first-party history uses session RLS, current membership and existing partner policy without developer entitlement', () => {
  execFileSync(process.execPath, [new URL('./fixtures/first-party-activity.ts', import.meta.url).pathname], {
    stdio: 'pipe',
  });
});
