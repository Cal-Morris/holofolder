import { test } from "node:test"

test("actual /app server boot opens own storage for a denied partner and never rejects on a failed check", async () => {
  const { execFileSync } = await import("node:child_process")
  execFileSync(process.execPath, [new URL("./fixtures/app-page-boot.ts", import.meta.url).pathname], { stdio: "pipe" })
})
