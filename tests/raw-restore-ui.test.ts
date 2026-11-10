import { test } from 'node:test'
import { execFileSync } from 'node:child_process'
test('raw restore UI uses actual auth/HTTP/RPC/current-read pipeline and same atomic original-intent queue', () => {
  execFileSync(process.execPath, [new URL('./fixtures/raw-restore-ui.ts', import.meta.url).pathname], { stdio: 'pipe' })
})

test('v3 reordered intent retains exact bytes, lost replies and proof/read/session fences in the same queue', () => {
  execFileSync(process.execPath, [new URL('./fixtures/raw-restore-ui.ts', import.meta.url).pathname, '--reorder'], { stdio: 'pipe' })
})
