import { test } from "node:test"
import { execFileSync } from "node:child_process"

test("catalog printing evidence and exact saved-price identity", () => {
  execFileSync(process.execPath, [new URL("./fixtures/printing-price-check-service.ts", import.meta.url).pathname], { stdio: "pipe" })
})
