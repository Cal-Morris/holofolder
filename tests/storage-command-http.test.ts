import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
test('real HTTP handler and trusted bridge fence session/owner/origin/body, replay receipt, then actual complete read', () => {
  execFileSync(process.execPath, [new URL('./fixtures/storage-command-http.ts', import.meta.url).pathname], {
    stdio: 'pipe',
  });
});
