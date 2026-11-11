import { test } from 'node:test';
import { execFileSync } from 'node:child_process';

test('comparison completion pushes and previews belong only to the authenticated initiator', () => {
  execFileSync(process.execPath, [new URL('./fixtures/comparison-push.ts', import.meta.url).pathname], {
    stdio: 'pipe',
  });
});

test('background checks finish before notifying, and notification failures preserve completed results', () => {
  execFileSync(process.execPath, [new URL('./fixtures/comparison-workflow.ts', import.meta.url).pathname], {
    stdio: 'pipe',
  });
});
