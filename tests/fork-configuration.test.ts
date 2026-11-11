import { test } from 'node:test';
import { execFileSync } from 'node:child_process';

test('forks require explicit analytics and Stripe setup and keep billing returns on their own host', () => {
  execFileSync(process.execPath, [new URL('./fixtures/fork-configuration.tsx', import.meta.url).pathname], {
    stdio: 'pipe',
  });
});
