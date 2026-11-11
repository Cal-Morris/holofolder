import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
test('catalogue import endpoint enforces origin and bounded identity-only payloads', () => {
  execFileSync(process.execPath, [new URL('./fixtures/collection-import-route.ts', import.meta.url).pathname], {
    stdio: 'pipe',
  });
});
