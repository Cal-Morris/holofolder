import { test } from "node:test"
import { execFileSync } from "node:child_process"
test("telemetry enforces trusted names and actor ownership and fails independently of business actions", () => {
  execFileSync(process.execPath,[new URL("./fixtures/collector-funnel.ts",import.meta.url).pathname],{stdio:"pipe"})
})
