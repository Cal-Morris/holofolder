import { test } from 'node:test'
import { execFileSync } from 'node:child_process'

test('free shares keep authentication, ownership, disablement and read-only public bootstrap boundaries', () => {
  execFileSync(process.execPath, [new URL('./fixtures/free-sharing.tsx', import.meta.url).pathname], { stdio: 'pipe' })
})
