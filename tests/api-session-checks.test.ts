import { describe, test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

// Read-only API handlers verify the session token locally (getSessionUser/getClaims); writes keep
// getUser() so a session revoked on the server is rejected immediately.
const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8")
const handler = (source: string, method: string) => {
  const start = source.indexOf(`export async function ${method}(`)
  assert.notEqual(start, -1, `${method} handler exists`)
  const next = source.indexOf("export async function", start + 1)
  return source.slice(start, next === -1 ? undefined : next)
}

describe("API session checks", () => {
  test("read-only GET handlers use the local session check", () => {
    assert.match(handler(read("app/api/settings/route.ts"), "GET"), /getSessionUser\(client\)/)
    assert.match(handler(read("app/api/binder-share/route.ts"), "GET"), /requireSessionUser\(\)/)
    assert.match(handler(read("app/api/collection-analytics/route.ts"), "GET"), /getSessionUser\(client\)/)
    assert.match(handler(read("app/api/binder-appearance/route.ts"), "GET"), /readOnly: true/)
    assert.match(handler(read("app/api/binder-appearance/artwork/route.ts"), "GET"), /readOnly: true/)
  })

  test("write handlers still verify the session with Supabase Auth", () => {
    assert.match(handler(read("app/api/settings/route.ts"), "PUT"), /getFirstPartyUser\(client\)/)
    for (const method of ["POST", "DELETE"]) assert.match(handler(read("app/api/binder-share/route.ts"), method), /requireUser\(\)/)
    for (const method of ["POST", "PATCH", "DELETE"]) assert.match(handler(read("app/api/collection/route.ts"), method), /getFirstPartyUser\(client\)/)
    assert.doesNotMatch(handler(read("app/api/binder-appearance/route.ts"), "PUT"), /readOnly/)
    assert.doesNotMatch(read("app/api/binder-appearance/upload/route.ts"), /readOnly/)
    assert.match(read("lib/server/binder-appearance.ts"), /readOnly \? await getSessionUser\(client\) : \(await getFirstPartyUser\(client\)\)/)
  })
})
