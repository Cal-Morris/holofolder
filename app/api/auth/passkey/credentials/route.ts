import { NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { createClient } from "@/lib/supabase/server"
import { isValidPasskeyCredentialId, serializePasskeyCredentials } from "@/lib/passkey-credentials"

async function requireUser() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  return user
}

export async function GET() {
  try {
    const user = await requireUser()
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
    }

    const admin = createAdminClient()
    const { data, error } = await admin
      .from("passkey_credentials")
      .select("id, device_type, created_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })

    if (error) {
      console.error("[binderdex] Error loading passkeys:", error)
      return NextResponse.json({ error: "Could not load your passkeys." }, { status: 500 })
    }

    return NextResponse.json({ passkeys: serializePasskeyCredentials(data) })
  } catch (error) {
    console.error("[binderdex] Passkey list failed:", error)
    return NextResponse.json({ error: "Could not load your passkeys." }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const user = await requireUser()
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
    }

    const id = request.nextUrl.searchParams.get("id")
    if (!isValidPasskeyCredentialId(id)) {
      return NextResponse.json({ error: "Passkey id is required" }, { status: 400 })
    }

    const admin = createAdminClient()
    const { error } = await admin
      .from("passkey_credentials")
      .delete()
      .eq("id", id)
      .eq("user_id", user.id)

    if (error) {
      console.error("[binderdex] Error deleting passkey:", error)
      return NextResponse.json({ error: "Could not delete that passkey." }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("[binderdex] Passkey delete failed:", error)
    return NextResponse.json({ error: "Could not delete that passkey." }, { status: 500 })
  }
}
