import { test } from 'node:test'
import { execFileSync } from 'node:child_process'

test('test pushes require sign-in and target only the current user’s registered device', () => {
  execFileSync(process.execPath, [new URL('./fixtures/push-test.ts', import.meta.url).pathname], { stdio: 'pipe' })
})
