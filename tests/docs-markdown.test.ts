import { test } from 'node:test';
import assert from 'node:assert/strict';
import schema from '@/public/openapi.json';
import { docsMarkdownHref, formatEndpointMarkdown, rewriteDocsLinks } from '@/lib/docs-markdown';

test('agent links use the supported app prefix and preserve endpoint anchors', () => {
  assert.equal(docsMarkdownHref('/docs'), 'https://holofolder.com/app/docs/markdown');
  assert.equal(
    docsMarkdownHref('/docs/contracts#pagination'),
    'https://holofolder.com/app/docs/markdown/contracts#pagination',
  );
  assert.equal(docsMarkdownHref('/app/openapi.json'), 'https://holofolder.com/app/openapi.json');
  assert.equal(docsMarkdownHref('https://example.test/setup'), 'https://example.test/setup');
  assert.equal(
    rewriteDocsLinks('[Guide](/docs/api-keys) and [spec](/app/openapi.json)'),
    '[Guide](https://holofolder.com/app/docs/markdown/api-keys) and [spec](https://holofolder.com/app/openapi.json)',
  );
});

test('endpoint Markdown keeps the exact machine-readable request contract', () => {
  const operation = {
    operationId: 'synthetic_read',
    security: [{ apiKey: [] }],
    parameters: [{ name: 'limit', in: 'query', schema: { type: 'integer', maximum: 100 } }],
  };
  const text = formatEndpointMarkdown({
    title: 'Synthetic endpoint',
    url: '/docs/reference/catalog/read',
    method: 'get',
    path: '/cards',
    operation,
  });
  assert.match(text, /^# Synthetic endpoint/m);
  assert.ok(text.includes(`GET ${schema.servers[0].url}/cards`));
  assert.deepEqual(JSON.parse(text.split('```json\n')[1].split('\n```')[0]), operation);
  assert.doesNotMatch(text, /<APIPage|<Card/);
});
