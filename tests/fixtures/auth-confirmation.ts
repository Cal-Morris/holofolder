import assert from "node:assert/strict"
import { NextRequest } from "next/server"

async function run() {
  // @ts-expect-error Bun module mocks are confined to this subprocess.
  const { mock } = await import("bun:test")
  let verified = 0
  let expired = false
  mock.module("../../lib/supabase/server", () => ({
    createClient: async () => ({ auth: {
      exchangeCodeForSession: async () => { throw new Error("A second device has no PKCE verifier") },
      verifyOtp: async (input: unknown) => {
        assert.deepEqual(input, { token_hash: "synthetic-email-token", type: "email" })
        verified++
        return { error: expired ? new Error("Expired token") : null }
      },
    } }),
  }))
  for (const route of [await import("../../app/auth/callback/route"), await import("../../app/auth/confirm/route")]) {
    const url = "https://holofolder.com/app/auth/callback?token_hash=synthetic-email-token&type=email"
    expired = false
    assert.equal((await route.GET(new NextRequest(url))).headers.get("location"), "https://holofolder.com/app")
    expired = true
    assert.equal((await route.GET(new NextRequest(url))).headers.get("location"), "https://holofolder.com/app/auth/error")
  }
  assert.equal(verified, 4)
  mock.restore()
}
void run().catch(error => { console.error(error); process.exitCode = 1 })
