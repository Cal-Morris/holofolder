import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { generateChallenge, storeChallenge } from "@/lib/webauthn"
import { getPasskeyRpId } from "@/lib/passkey-rp"

export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
    }

    const challenge = await generateChallenge()
    await storeChallenge(`register:${user.id}`, challenge)
    const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host")

    // Get existing credentials to exclude
    const admin = createAdminClient()
    const { data: existingCreds } = await admin
      .from("passkey_credentials")
      .select("credential_id")
      .eq("user_id", user.id)

    const options = {
      challenge,
      rp: {
        name: "Pokemon Binder",
        id: getPasskeyRpId(host),
      },
      user: {
        id: Buffer.from(user.id).toString("base64url"),
        name: user.email || user.id,
        displayName: user.email?.split("@")[0] || "User",
      },
      pubKeyCredParams: [
        { alg: -7, type: "public-key" as const },   // ES256
        { alg: -257, type: "public-key" as const }, // RS256
      ],
      timeout: 60000,
      attestation: "none" as const,
      excludeCredentials: existingCreds?.map(c => ({
        id: c.credential_id,
        type: "public-key" as const,
      })) || [],
      authenticatorSelection: {
        authenticatorAttachment: "platform" as const,
        requireResidentKey: true,
        residentKey: "required" as const,
        userVerification: "required" as const,
      },
    }

    return NextResponse.json(options)
  } catch (error) {
    console.error("[v0] Error generating registration options:", error)
    return NextResponse.json({ error: "Failed to generate options" }, { status: 500 })
  }
}
