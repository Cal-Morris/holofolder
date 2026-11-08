import test from "node:test"
import assert from "node:assert/strict"
import { existsSync } from "node:fs"
import { join } from "node:path"

const root = process.cwd()

test("native passkeys keep the retired custom credential endpoints removed", () => {
  for (const path of [
    "app/api/auth/passkey",
    "components/passkey-settings.tsx",
    "lib/passkey-credentials.ts",
    "lib/passkey-rp.ts",
    "lib/webauthn.ts",
  ]) {
    assert.equal(existsSync(join(root, path)), false, `${path} should be removed`)
  }
})
