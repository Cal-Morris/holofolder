import { test, expect, emulateStandalone, SAFE_AREA } from './fixtures'

test.beforeEach(async ({ page }, info) => {
  if (info.project.metadata.standalone) await emulateStandalone(page, SAFE_AREA)
})

test('native developer help and generated exports state the current execution and read boundaries', async ({ page, request }, info) => {
  await page.goto('/app/docs/native-storage')
  await expect(page.getByRole('heading', { name: 'Native storage contracts', exact: true })).toBeVisible()
  await expect(page.getByText('Supported native developer operations use the trusted storage executor.', { exact: true })).toBeVisible()
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
  expect(markdown).not.toContain('native_operations_staged')
  expect(markdown).toContain('privateFields')
  expect(markdown).toContain('patchGrading')
  expect(markdown).toContain('expectedPublic')
  expect(markdown).toContain('insertAssign')
  expect(markdown).toContain('8,192')
  await expect(page.getByRole('heading', { name: 'Atomic slot insertion and copy assignment' })).toBeAttached()
  expect(markdown).toContain('private_assets_unverifiable')
  const openapi = await (await request.get('/app/openapi.json')).json()
  const operation = openapi.paths['/storage/slots/commands'].post
  expect(operation['x-admission']).toBeUndefined()
  expect(operation.requestBody.content['application/json'].schema.properties.privateFields.enum).toEqual(['preserve', 'replace'])
  expect(operation.responses['503'].description).not.toContain('native_operations_staged')
  expect(operation.responses['200'].description).toBe('Success')
  const inventory = openapi.paths['/storage/inventory/commands'].post
  expect(JSON.stringify(inventory.requestBody)).toContain('patchGrading')
  expect(JSON.stringify(inventory.requestBody)).toContain('expectedPublic')
  expect(JSON.stringify(inventory.requestBody)).toContain('insertAssign')
  expect(inventory.description).toContain('8192')
  expect(inventory.description).toContain('10s')
  const llms = await request.get('/app/docs/llms.txt')
  expect(await llms.text()).toContain('native-storage')

  await page.goto('/app/docs/reference/collection/execute-inventory-commands')
  await expect(page.getByRole('heading', { name: 'Execute inventory commands', exact: true })).toBeVisible()
  await expect(page.getByText(/Atomic insertAssign/).first()).toBeVisible()
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})
