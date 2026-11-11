import { test, expect } from '@playwright/test';
import schema from '../public/openapi.json';

const operations = Object.values(schema.paths).flatMap((methods) => Object.values(methods));

test('LLM index points to public Markdown guides and every API operation', async ({ request }) => {
  const response = await request.get('/app/docs/llms.txt');
  expect(response.ok()).toBe(true);
  expect(response.headers()['content-type']).toContain('text/plain');
  const text = await response.text();
  expect(text).toContain('https://holofolder.com/app/openapi.json');
  expect(text).toContain('https://holofolder.com/app/docs/markdown/agents/claude');
  const endpoints = text.match(/https:\/\/holofolder.com\/app\/docs\/markdown\/reference\/[^)]+/g) ?? [];
  expect(endpoints).toHaveLength(operations.length);
  const alias = await request.get('/app/llms.txt');
  expect(await alias.text()).toBe(text);
});

test('full agent docs contain guides and exact endpoint contracts without JSX', async ({ request }) => {
  const response = await request.get('/app/docs/llms-full.txt');
  expect(response.ok()).toBe(true);
  const text = await response.text();
  expect(text).toContain('claude mcp add --transport http');
  expect(text).toContain('codex mcp login holofolder');
  expect(text).toContain('Authorization: Bearer hf_YOUR_KEY_ID.YOUR_SECRET');
  expect(text).toContain('Choose your connection');
  expect(text).toContain('- [AI & agents](https://holofolder.com/app/docs/markdown/mcp)');
  expect(text).not.toMatch(/<\/?(?:Card|Cards|Callout|DocsLink|DocsApiKeys|div|p)\b|import .*from|\[object Object\]/);
  for (const operation of operations) expect(text).toContain(`"operationId": "${operation.operationId}"`);
  const alias = await request.get('/app/llms-full.txt');
  expect(await alias.text()).toBe(text);
});

test('each docs page advertises a matching Markdown alternate, including API schemas', async ({ page, request }) => {
  await page.goto('/app/docs/api-keys');
  await expect(page.getByRole('link', { name: 'View as Markdown', exact: true })).toHaveAttribute(
    'href',
    '/app/docs/markdown/api-keys',
  );
  await expect(page.locator('link[rel="alternate"][type="text/markdown"]')).toHaveAttribute(
    'href',
    'https://holofolder.com/app/docs/markdown/api-keys',
  );
  const guide = await request.get('/app/docs/markdown/api-keys');
  expect(guide.headers()['content-type']).toContain('text/markdown');
  expect(await guide.text()).toContain('## Authentication');
  const endpoint = await request.get('/app/docs/markdown/reference/catalog/list-cards');
  const text = await endpoint.text();
  expect(text).toContain(`GET ${schema.servers[0].url}/cards`);
  const operation = JSON.parse(text.split('```json\n')[1].split('\n```')[0]);
  expect(operation).toEqual(schema.paths['/cards'].get);
  expect((await request.get('/app/docs/markdown/not-a-real-page')).status()).toBe(404);
});
