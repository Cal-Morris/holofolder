import { test } from 'node:test';
import assert from 'node:assert/strict';
import sitemap from '@/app/sitemap';
import { DEVELOPER_OPERATIONS } from '@/lib/developer-api/operations';

test('the sitemap discovers public guides and every generated API reference at their canonical URLs', async () => {
  const entries = await sitemap();
  const urls = entries.map((entry) => entry.url);
  assert.equal(new Set(urls).size, urls.length, 'sitemap URLs must be unique');
  for (const path of ['/docs', '/docs/api-keys', '/docs/bulk-layout', '/docs/set-checklist-drafts']) {
    assert.ok(urls.includes(`https://holofolder.com/app${path}`), `Missing guide: ${path}`);
  }
  const referenceUrls = urls.filter((url) => url.includes('/docs/reference/'));
  assert.equal(referenceUrls.length, DEVELOPER_OPERATIONS.length);
  assert.ok(referenceUrls.some((url) => url === 'https://holofolder.com/app/docs/reference/catalog/get-set'));
  for (const url of urls) {
    assert.match(url, /^https:\/\/holofolder\.com\/app\/docs(?:\/[^?#]+)?$/);
    assert.ok(!url.includes('/app/app/'), url);
  }
});
