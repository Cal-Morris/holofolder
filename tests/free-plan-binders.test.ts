import { test } from 'node:test';
import { execFileSync } from 'node:child_process';

test('binder API enforces owner allowances, preserves the first named binder and maps concurrent cap failures', () => {
  execFileSync(process.execPath, [new URL('./fixtures/free-plan-binders.ts', import.meta.url).pathname], {
    stdio: 'pipe',
  });
});
