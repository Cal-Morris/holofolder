import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
test('free accounts can still manage an existing partnership and received invites', () => {
  execFileSync(process.execPath, [new URL('./fixtures/billing-partner-controls.tsx', import.meta.url).pathname], {
    stdio: 'pipe',
  });
});
