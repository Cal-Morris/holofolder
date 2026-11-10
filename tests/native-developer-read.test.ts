import { test } from "node:test"
import { execFileSync } from "node:child_process"
test(`native read actual adapters/transports `, () => {
  execFileSync(process.execPath, [new URL("./fixtures/native-developer-read.ts", import.meta.url).pathname], { stdio: "pipe" })
})
