import { test } from 'node:test';
import { execFileSync } from 'node:child_process';

test("settings API validates layouts, scopes writes to the owner's binder, and enforces premium", () => {
  execFileSync(process.execPath, [new URL('./fixtures/settings-layout-api.ts', import.meta.url).pathname], {
    stdio: 'pipe',
  });
});
