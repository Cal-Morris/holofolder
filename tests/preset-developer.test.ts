import { test } from "node:test"
import { execFileSync } from "node:child_process"
test(`copied preset shared dispatcher and REST/MCP adapters `, () => {
  execFileSync(process.execPath, [new URL("./fixtures/preset-developer.ts", import.meta.url).pathname], { stdio: "pipe" })
})
