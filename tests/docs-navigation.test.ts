import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loader } from 'fumadocs-core/source';
import { flattenTree } from 'fumadocs-core/page-tree';
import type { Folder } from 'fumadocs-core/page-tree';
import { docsOpenAPI } from '@/lib/docs-openapi';
import { groupReferenceNavigation } from '@/lib/docs-navigation';

async function loadReference() {
  const reference = await docsOpenAPI.staticSource({
    per: 'operation',
    baseDir: 'reference',
    groupBy: 'tag',
    meta: true,
    name(entry) {
      return entry.type === 'operation'
        ? this.document.paths![entry.item.path]![entry.item.method]!.operationId!.replaceAll('_', '-')
        : entry.item.name;
    },
  });
  const original = loader({ baseUrl: '/docs', source: reference, plugins: [docsOpenAPI.loaderPlugin()] });
  const grouped = loader({
    baseUrl: '/docs',
    source: reference,
    plugins: [docsOpenAPI.loaderPlugin(), { transformPageTree: { folder: groupReferenceNavigation } }],
  });
  return { original, grouped, groups: (grouped.pageTree.children[0] as Folder).children as Folder[] };
}
const referencePromise = loadReference();

test('reference groups preserve every operation exactly once with the same URL and content', async () => {
  const { original, grouped } = await referencePromise;
  const before = flattenTree(original.pageTree.children);
  const after = flattenTree(grouped.pageTree.children);
  assert.equal(after.length, before.length);
  assert.equal(new Set(after.map((page) => page.url)).size, before.length);
  assert.deepEqual(
    after.toSorted((a, b) => a.url.localeCompare(b.url)),
    before.toSorted((a, b) => a.url.localeCompare(b.url)),
  );
  for (const page of after) assert.ok(grouped.getPage(page.url.replace('/docs/', '').split('/')), page.url);
});

test('long reference sections become one level of small, collapsed subject groups', async () => {
  const { groups } = await referencePromise;
  const counts = Object.fromEntries(groups.map((group) => [group.name, group.children.length]));
  assert.deepEqual(counts, {
    Binders: 5,
    'History & recovery': 2,
    'Sharing & appearance': 8,
    'Show purchases': 3,
    Inventory: 2,
    Presets: 2,
    'Native storage': 12,
    Catalog: 13,
    Account: 9,
    Prices: 5,
    Comparisons: 4,
    'Deal checks': 2,
  });
  for (const group of groups) {
    assert.ok(group.children.every((child) => child.type === 'page'));
    if (group.name !== 'Catalog' && group.name !== 'Account') assert.equal(group.defaultOpen, false);
  }
  assert.deepEqual(
    groups
      .find((group) => group.name === 'Inventory')!
      .children.map((child) => (child.type === 'page' ? child.url.split('/').at(-1) : ''))
      .sort(),
    ['get-inventory-item', 'list-inventory-items'],
  );
  assert.equal(groups.find((group) => group.name === 'Binders')!.children[0].type, 'page');
  assert.ok(
    groups
      .find((group) => group.name === 'Binders')!
      .children.some((child) => child.type === 'page' && child.url === '/docs/reference/collection/create-binder'),
  );
  assert.ok(
    groups
      .find((group) => group.name === 'Prices')!
      .children.some(
        (child) => child.type === 'page' && child.url === '/docs/reference/prices-and-insights/get-prices',
      ),
  );
});

test('unassigned operations remain visible and guide folders are untouched', () => {
  const future = {
    type: 'page' as const,
    name: 'Future operation',
    url: '/docs/reference/collection/future-operation',
  };
  const folder: Folder = {
    type: 'folder',
    name: 'Reference',
    children: [{ type: 'folder', name: 'Collection', $ref: { folder: 'reference/collection' }, children: [future] }],
  };
  const result = groupReferenceNavigation(folder, 'reference');
  assert.deepEqual(result.children, [{ ...folder.children[0], name: 'Other operations', children: [future] }]);
  assert.equal(groupReferenceNavigation(folder, 'agents'), folder);
});
