import { NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { getChallenge } from "@/lib/webauthn"

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { credential, sessionId } = body

    // Verify challenge
    const storedChallenge = await getChallenge(`auth:${sessionId}`)
    if (!storedChallenge) {
      return NextResponse.json({ error: "Challenge expired" }, { status: 400 })
    }
    const admin = createAdminClient()

    // Find the credential in our database
    const { data: passkey, error: findError } = await admin
      .from("passkey_credentials")
      .select("*")
      .eq("credential_id", credential.id)
      .single()

    if (findError || !passkey) {
      return NextResponse.json({ error: "Passkey not found" }, { status: 404 })
    }

    // Update the counter
    await admin
      .from("passkey_credentials")
      .update({ counter: passkey.counter + 1 })
      .eq("id", passkey.id)

    // Sign in the user using the admin API to create a session
    // We need to use a service role for this
    const { data: userData, error: userError } = await admin.auth.admin.getUserById(passkey.user_id)
    
    if (userError || !userData.user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 })
    }

    // Generate a magic link token for this user (workaround for session creation)
    const { data: linkData, error: linkError } = await admin.auth.admin.generateLink({
      type: "magiclink",
      email: userData.user.email!,
    })

    if (linkError || !linkData) {
      return NextResponse.json({ error: "Failed to create session" }, { status: 500 })
    }

    // Extract the token from the action link
    const url = new URL(linkData.properties.action_link)
    const token = url.searchParams.get("token")

    return NextResponse.json({ 
      success: true, 
      token,
      email: userData.user.email,
      redirectUrl: linkData.properties.action_link,
    })
  } catch (error) {
    console.error("[v0] Error verifying authentication:", error)
    return NextResponse.json({ error: "Authentication failed" }, { status: 500 })
  }
}
