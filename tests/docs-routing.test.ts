import { test } from 'node:test';
import assert from 'node:assert/strict';
import { docsHref } from '@/lib/docs-routing';
test('docs links preserve public proxy paths and support direct Next entry', () => {
  assert.equal(docsHref('/docs/api-keys', '/docs'), '/docs/api-keys');
  assert.equal(docsHref('/docs/api-keys', '/app/docs'), '/app/docs/api-keys');
  assert.equal(docsHref('/docs/api-keys#expiry', '/app/docs/mcp'), '/app/docs/api-keys#expiry');
  assert.equal(docsHref('/app', '/docs'), '/app');
  assert.equal(docsHref('https://example.test', '/app/docs'), 'https://example.test');
});
