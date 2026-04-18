import { NextResponse } from "next/server"
import { generateChallenge, storeChallenge } from "@/lib/webauthn"
import { getPasskeyRpId } from "@/lib/passkey-rp"

export async function POST(request: Request) {
  try {
    const challenge = await generateChallenge()
    const sessionId = crypto.randomUUID()
    const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host")
    
    await storeChallenge(`auth:${sessionId}`, challenge)

    const options = {
      challenge,
      sessionId,
      rpId: getPasskeyRpId(host),
      timeout: 60000,
      userVerification: "required" as const,
      // Empty allowCredentials = discoverable credentials (passkeys)
      allowCredentials: [],
    }

    return NextResponse.json(options)
  } catch (error) {
    console.error("[v0] Error generating auth options:", error)
    return NextResponse.json({ error: "Failed to generate options" }, { status: 500 })
  }
}
