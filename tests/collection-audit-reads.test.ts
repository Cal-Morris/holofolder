import { test } from 'node:test';
import { execFileSync } from 'node:child_process';

test('private audit REST/MCP registry reads paginate beyond 1000 without private fields', () => {
  execFileSync(process.execPath, [new URL('./fixtures/collection-audit-reads.ts', import.meta.url).pathname], {
    stdio: 'pipe',
  });
});
