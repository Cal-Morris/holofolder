import { test } from 'node:test';
import { execFileSync } from 'node:child_process';

test('production native routes use cookie authority, session/owner fences, exact replay and private reads', () => {
  execFileSync(process.execPath, [new URL('./fixtures/native-production-routes.ts', import.meta.url).pathname], {
    stdio: 'pipe',
  });
});
