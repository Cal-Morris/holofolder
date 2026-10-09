import { NextRequest, NextResponse } from "next/server"
import { runCardImageBackfill } from "@/lib/card-db-sync"
import { getSyncSecret, isAuthorizedSyncRequest } from "@/lib/card-db-sync-targets"
import { getDefaultCardImageMirror } from "@/lib/card-image-blob"
import { InvalidBackfillRequestError, parseCardImageBackfillRequest } from "@/lib/card-image-backfill"

export const maxDuration = 300
const TIME_BUDGET_MS = (maxDuration - 60) * 1000

/**
 * POST /api/admin/mirror-card-images  (Authorization: Bearer <SYNC_SECRET or CRON_SECRET>)
 *
 * Copies TCGdex card images for every mirrored set into Vercel Blob, set by set (ordered by set id).
 * Resumable: repeat with `?cursor=<nextCursor>` until `"done": true`. Already-copied images are skipped.
 *   ?set=me05,30th   only these sets
 *   ?lang=en,fr      languages (default en)
 *   ?quality=high,low (default both)
 *   ?maxSets=10 &maxUploads=1500  per-call limits
 */
export async function POST(request: NextRequest) {
  if (!getSyncSecret(process.env)) {
    return NextResponse.json(
      { error: "Not configured. Set SYNC_SECRET (or CRON_SECRET) in the environment." },
      { status: 503 },
    )
  }

  if (!isAuthorizedSyncRequest(request.headers.get("authorization"), process.env)) {
    return NextResponse.json({ error: "Not authorized" }, { status: 401 })
  }

  const mirror = getDefaultCardImageMirror()
  if (!mirror) {
    return NextResponse.json(
      { error: "Card image Blob mirror is not configured. Connect a Vercel Blob store (BLOB_READ_WRITE_TOKEN)." },
      { status: 503 },
    )
  }

  let backfillRequest
  try {
    backfillRequest = parseCardImageBackfillRequest(request.nextUrl.searchParams)
  } catch (error) {
    if (error instanceof InvalidBackfillRequestError) {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }
    throw error
  }

  try {
    const result = await runCardImageBackfill({
      request: backfillRequest,
      mirror,
      timeBudgetMs: TIME_BUDGET_MS,
      logger: (message) => console.log(`[card-image-backfill] ${message}`),
    })
    return NextResponse.json({ backfill: result, nextCursor: result.nextCursor, done: result.done })
  } catch (error) {
    console.error("[binderdex] Card image backfill failed:", error)
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 })
  }
}
