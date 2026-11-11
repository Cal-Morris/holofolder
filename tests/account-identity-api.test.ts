import { test } from 'node:test';
import { execFileSync } from 'node:child_process';

test('account username API validates input, scopes identity to the session and reports conflicts or missing schema', () => {
  execFileSync(process.execPath, [new URL('./fixtures/account-identity-api.ts', import.meta.url).pathname], {
    stdio: 'pipe',
  });
});
