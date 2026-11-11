import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
test('signed subscription lifecycle isolates the app, retains paid time, rejects stale grants and avoids repeat billing', () => {
  execFileSync(process.execPath, [new URL('./fixtures/billing-lifecycle.ts', import.meta.url).pathname], {
    stdio: 'pipe',
  });
});
