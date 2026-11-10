import { test } from 'node:test'
import { execFileSync } from 'node:child_process'
test('raw restore UI uses actual auth/HTTP/RPC/current-read pipeline and same atomic original-intent queue', () => {
  execFileSync(process.execPath, [new URL('./fixtures/raw-restore-ui.ts', import.meta.url).pathname], { stdio: 'pipe' })
})
