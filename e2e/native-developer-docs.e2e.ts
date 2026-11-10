import { test, expect, emulateStandalone, SAFE_AREA } from './fixtures'

test.beforeEach(async ({ page }, info) => {
  if (info.project.metadata.standalone) await emulateStandalone(page, SAFE_AREA)
})

test('native developer help and generated exports state the current staging and read boundaries', async ({ page, request }, info) => {
  await page.goto('/app/docs/native-storage')
  await expect(page.getByRole('heading', { name: 'Native storage contracts', exact: true })).toBeVisible()
  await expect(page.getByText('Native developer operations are staged and unavailable.', { exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: /^Preserve private fields/ })).toBeAttached()
  await expect(page.getByText('privateFields', { exact: true }).first()).toBeAttached()
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.evaluate(() => window.scrollTo(0, 500))
  const search = page.getByRole('button', { name: 'Open Search', exact: true })
  await expect(search).toBeVisible()
  expect((await search.boundingBox())!.y).toBeGreaterThanOrEqual(info.project.metadata.standalone ? SAFE_AREA.top : 0)

  const exported = await request.get('/app/docs/markdown/native-storage')
  expect(exported.ok()).toBe(true)
  const markdown = await exported.text()
  expect(markdown).toContain('native_operations_staged')
  expect(markdown).toContain('privateFields')
  expect(markdown).toContain('transactional executor support')
  const openapi = await (await request.get('/app/openapi.json')).json()
  const operation = openapi.paths['/storage/slots/commands'].post
  expect(operation['x-admission']).toBe('staged')
  expect(operation.requestBody.content['application/json'].schema.properties.privateFields.enum).toEqual(['preserve', 'replace'])
  expect(operation.responses['503'].description).toContain('native_operations_staged')
  expect(operation.responses['200'].description).toContain('Currently returns 503')
  const llms = await request.get('/app/docs/llms.txt')
  expect(await llms.text()).toContain('native-storage')

  await page.goto('/app/docs/reference/collection/execute-slot-commands')
  await expect(page.getByRole('heading', { name: 'Execute slot commands', exact: true })).toBeVisible()
  await expect(page.getByText(/STAGED, not admitted/).first()).toBeVisible()
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})
