import { test } from "node:test"
import { execFileSync } from "node:child_process"
test("shared analytics denies native, mixed and unknown authority before reading frozen history, preserves legacy", () => {
  execFileSync(process.execPath, [new URL("./fixtures/native-analytics-api.ts", import.meta.url).pathname], { stdio: "pipe" })
})
