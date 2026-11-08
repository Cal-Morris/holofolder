import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { getSessionUser, getFirstPartyUser, userFromClaims } from "../lib/supabase/session-user"

const claims = {
  sub: "user-1",
  aud: "authenticated",
  role: "authenticated",
  email: "ash@example.com",
  exp: 2_000_000_000,
  iat: 1_900_000_000,
  iss: "https://example.supabase.co/auth/v1",
  session_id: "s1",
  aal: "aal1" as const,
  app_metadata: { provider: "email" },
  user_metadata: { name: "Ash" },
}

describe("userFromClaims", () => {
  it("maps verified token claims onto the User shape", () => {
    const user = userFromClaims(claims)
    assert.equal(user.id, "user-1")
    assert.equal(user.email, "ash@example.com")
    assert.equal(user.aud, "authenticated")
    assert.deepEqual(user.app_metadata, { provider: "email" })
    assert.deepEqual(user.user_metadata, { name: "Ash" })
  })

  it("takes the first audience when the token has several", () => {
    assert.equal(userFromClaims({ ...claims, aud: ["authenticated", "other"] }).aud, "authenticated")
  })
})

describe("getSessionUser", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const clientWith = (result: unknown) => ({ auth: { getClaims: async () => result } }) as any

  it("returns the user for a verified session", async () => {
    const user = await getSessionUser(clientWith({ data: { claims }, error: null }))
    assert.equal(user?.id, "user-1")
  })

  it("returns null when there is no session or verification fails", async () => {
    assert.equal(await getSessionUser(clientWith({ data: null, error: null })), null)
    assert.equal(await getSessionUser(clientWith({ data: null, error: new Error("bad signature") })), null)
  })
})

describe("first-party OAuth boundary", () => {
  it("rejects an OAuth client token in a website session", async () => {
    const client = { auth: {
      getClaims: async () => ({ data: { claims: { ...claims, client_id: "synthetic-client" } }, error: null }),
      getUser: async () => { throw new Error("OAuth tokens must not reach website user resolution") },
    } }
    assert.equal(await getSessionUser(client as unknown as Parameters<typeof getSessionUser>[0]), null)
    assert.equal((await getFirstPartyUser(client as unknown as Parameters<typeof getFirstPartyUser>[0])).data.user, null)
  })
})
