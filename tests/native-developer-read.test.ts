import { test } from "node:test"
import { execFileSync } from "node:child_process"
for (const mode of ["--fixed", "--admitted"]) test(`native read actual adapters/transports ${mode}`, () => {
  execFileSync(process.execPath, [new URL("./fixtures/native-developer-read.ts", import.meta.url).pathname, mode], { stdio: "pipe" })
})
