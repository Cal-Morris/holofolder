import { test } from 'node:test';
import { execFileSync } from 'node:child_process';

test('signout clears the app notification binding and subscription before an offline revoke', () => {
  execFileSync(process.execPath, [new URL('./fixtures/push-device-cleanup.ts', import.meta.url).pathname], {
    stdio: 'pipe',
  });
});
