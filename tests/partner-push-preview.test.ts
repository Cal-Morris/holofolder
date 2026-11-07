import { test } from 'node:test'
import { execFileSync } from 'node:child_process'

test('partner notification previews stay recipient-only, require the active partnership and identify the binder', () => {
  execFileSync(process.execPath, [new URL('./fixtures/partner-push-preview.ts', import.meta.url).pathname], { stdio: 'pipe' })
})
