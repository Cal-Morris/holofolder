import test from "node:test"
import assert from "node:assert/strict"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"

const root = process.cwd()

function readProjectFile(path: string) {
  return readFileSync(join(root, path), "utf8")
}

test("passkey support is not exposed while it is disabled", () => {
  const authModal = readProjectFile("components/auth-modal.tsx")
  const settingsModal = readProjectFile("components/settings-modal.tsx")
  const packageJson = JSON.parse(readProjectFile("package.json")) as {
    dependencies?: Record<string, string>
  }

  assert.equal(authModal.includes("Passkey"), false)
  assert.equal(authModal.includes("passkey"), false)
  assert.equal(settingsModal.includes("PasskeySettings"), false)
  assert.equal(Boolean(packageJson.dependencies?.["@simplewebauthn/browser"]), false)
})

test("passkey-only files and endpoints are removed while support is disabled", () => {
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
