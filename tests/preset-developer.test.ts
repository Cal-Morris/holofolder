import { test } from "node:test"
import { execFileSync } from "node:child_process"
for (const mode of ["--fixed", "--admitted"]) test(`copied preset shared dispatcher and REST/MCP adapters ${mode}`, () => {
  execFileSync(process.execPath, [new URL("./fixtures/preset-developer.ts", import.meta.url).pathname, mode], { stdio: "pipe" })
})
