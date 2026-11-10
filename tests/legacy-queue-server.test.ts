import { test } from "node:test"
import { execFileSync } from "node:child_process"
import assert from "node:assert/strict"
import { legacyWritePausedResponse } from "../lib/server/legacy-write-fence"

test("legacy queue ingress validates protocol after recipient binding and isolates trusted audit context", () => {
  execFileSync(process.execPath, [new URL("./fixtures/legacy-queue-server.ts", import.meta.url).pathname], { stdio: "pipe" })
})

test("only the exact installed SQLSTATE and message pair maps to a retained queue pause", async () => {
  for (const error of [null, "legacy_collection_write_paused", { code: "PT503", message: "other" },
    { code: "55000", message: "legacy_collection_write_paused" }, { code: "PT503", message: "prefix legacy_collection_write_paused" }]) {
    assert.equal(legacyWritePausedResponse(error), null)
  }
  const cyclic: { cause?: unknown } = {}; cyclic.cause = cyclic
  assert.equal(legacyWritePausedResponse(cyclic), null)
  const pause = { code: "PT503", message: "legacy_collection_write_paused", details: "private", hint: "private" }
  const response = legacyWritePausedResponse({ cause: { cause: pause } })!
  assert.equal(response.status, 503)
  assert.equal((await response.json()).retainOnDevice, true)
})
