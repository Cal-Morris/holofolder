import { test } from 'node:test'
import { execFileSync } from 'node:child_process'

test('Show mode updates only the signed-in device with a server-controlled expiry', () => {
  execFileSync(process.execPath, [new URL('./fixtures/push-show-mode.ts', import.meta.url).pathname], { stdio: 'pipe' })
})

test('partner delivery skips off and expired devices and rechecks before sending', () => {
  execFileSync(process.execPath, [new URL('./fixtures/partner-push-show-mode.ts', import.meta.url).pathname], { stdio: 'pipe' })
})
