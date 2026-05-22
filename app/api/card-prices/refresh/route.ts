import { NextResponse } from "next/server"
import { start } from "workflow/api"
import { createAdminClient } from "@/lib/supabase/admin"
import { createClient } from "@/lib/supabase/server"
import { refreshCardPricesWorkflow } from "@/workflows/card-price-refresh"

export const runtime = "nodejs"

async function resolveCollectionOwnerUserId(userId: string) {
  const admin = createAdminClient()
  const { data: partnership, error } = await admin
    .from("partnerships")
    .select("owner_user_id")
    .or(`user1_id.eq.${userId},user2_id.eq.${userId}`)
    .limit(1)
    .maybeSingle()

  if (error) {
    throw error
  }

  return partnership?.owner_user_id || userId
}

export async function POST() {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
    }

    const ownerUserId = await resolveCollectionOwnerUserId(user.id)
    const run = await start(refreshCardPricesWorkflow, [ownerUserId])

    return NextResponse.json({
      refresh: {
        status: "started",
        runId: run.runId,
      },
    })
  } catch (error) {
    console.error("[binderdex] Failed to start card price refresh workflow:", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to start price refresh." },
      { status: 500 },
    )
  }
}
