import { NextResponse } from "next/server"
import { generateChallenge, storeChallenge } from "@/lib/webauthn"

export async function POST() {
  try {
    const challenge = await generateChallenge()
    const sessionId = crypto.randomUUID()
    
    await storeChallenge(`auth:${sessionId}`, challenge)

    const options = {
      challenge,
      sessionId,
      rpId: process.env.NODE_ENV === "production" ? "binder.cal.gg" : "localhost",
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
