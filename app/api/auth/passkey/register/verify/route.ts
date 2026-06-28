import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { getChallenge } from "@/lib/webauthn"

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
    }

    const body = await request.json()
    const { credential } = body

    // Verify challenge
    const storedChallenge = await getChallenge(`register:${user.id}`)
    if (!storedChallenge) {
      return NextResponse.json({ error: "Challenge expired" }, { status: 400 })
    }

    // Extract credential data
    const { id, response: credResponse, authenticatorAttachment } = credential
    
    // Store the credential
    const admin = createAdminClient()
    const { error } = await admin
      .from("passkey_credentials")
      .insert({
        user_id: user.id,
        credential_id: id,
        public_key: credResponse.publicKey,
        counter: 0,
        device_type: authenticatorAttachment || "platform",
        backed_up: false,
        transports: credResponse.transports || [],
      })

    if (error) {
      console.error("[v0] Error storing credential:", error)
      return NextResponse.json({ error: "Failed to store credential" }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("[v0] Error verifying registration:", error)
    return NextResponse.json({ error: "Verification failed" }, { status: 500 })
  }
}
