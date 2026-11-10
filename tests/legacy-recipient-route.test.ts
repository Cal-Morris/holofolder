import { test } from "node:test"
import { execFileSync } from "node:child_process"
test("first-party POST/PATCH/DELETE authenticate independently and retain missing or changed recipients without default/schema fallbacks", () => {
  execFileSync(process.execPath, [new URL("./fixtures/legacy-recipient-route.ts", import.meta.url).pathname], { stdio: "pipe" })
})
test("first-party exact binder writes cannot fall back when storage authority schema is missing; converted authority stays #495 compatibility 409", () => {
  execFileSync(process.execPath, [new URL("./fixtures/legacy-recipient-authority.ts", import.meta.url).pathname], { stdio: "pipe" })
})
test("first-party save/status/delete use existing exact-row atomic kernels and never fall back to direct writes", () => {
  execFileSync(process.execPath, [new URL("./fixtures/legacy-recipient-atomic.ts", import.meta.url).pathname], { stdio: "pipe" })
})
