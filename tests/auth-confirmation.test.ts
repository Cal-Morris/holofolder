import { test } from "node:test"
import { execFileSync } from "node:child_process"

test("email confirmation accepts token hashes on a device without a PKCE verifier", () => {
  execFileSync(process.execPath, [new URL("./fixtures/auth-confirmation.ts", import.meta.url).pathname], { stdio: "pipe" })
})
