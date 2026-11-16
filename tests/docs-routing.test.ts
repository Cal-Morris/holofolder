import { test } from 'node:test';
import assert from 'node:assert/strict';
import { docsHref } from '@/lib/docs-routing';

test('docs and help links get the /app prefix', () => {
  assert.equal(docsHref('/docs'), '/app/docs');
  assert.equal(docsHref('/docs/api-keys#expiry'), '/app/docs/api-keys#expiry');
  assert.equal(docsHref('/help/scanning'), '/app/help/scanning');
  assert.equal(docsHref('/help?q=x'), '/app/help?q=x');
});

test('other links are left alone', () => {
  assert.equal(docsHref('/app'), '/app');
  assert.equal(docsHref('/app/openapi.json'), '/app/openapi.json');
  assert.equal(docsHref('/helpful'), '/helpful');
  assert.equal(docsHref('https://example.test'), 'https://example.test');
});
