import { revalidateTag } from "next/cache"
import { NextRequest, NextResponse } from "next/server"
import { runIncrementalCardDbSync } from "@/lib/card-db-sync"
import { getDefaultCardImageMirror } from "@/lib/card-image-blob"
import {
  getSyncSecret,
  InvalidSyncRequestError,
  isAuthorizedSyncRequest,
  parseIncrementalSyncRequest,
} from "@/lib/card-db-sync-targets"

// Vercel function limit for this route. Each call stops starting new sets ~60s before this and
// returns `remainingSetIds`, so callers can simply repeat the request until it is empty.
export const maxDuration = 300
const TIME_BUDGET_MS = (maxDuration - 60) * 1000

/**
 * POST /api/admin/sync-card-db
 *   Authorization: Bearer <CARD_DB_SYNC_SECRET, SYNC_SECRET or CRON_SECRET>
 *
 * Query:
 *   ?set=me05,30th,30th-c   sync specific TCGdex set ids
 *   ?recent=3               sync the newest N sets (by release date)
 *   (default) / ?missing=1  sync sets missing from the mirror or with fewer cards than TCGdex
 *   ?maxSets=4              sets per call (max 12); leftovers are returned in remainingSetIds
 *   ?dryRun=1               fetch and parse only, no writes
 *   ?images=0               skip copying the synced sets' card images into Vercel Blob
 *                           (on by default when BLOB_READ_WRITE_TOKEN is configured)
 */
export async function POST(request: NextRequest) {
  if (!getSyncSecret(process.env)) {
    return NextResponse.json(
      { error: "Card DB sync is not configured. Set CARD_DB_SYNC_SECRET (or SYNC_SECRET / CRON_SECRET) in the environment." },
      { status: 503 },
    )
  }

  if (!isAuthorizedSyncRequest(request.headers.get("authorization"), process.env, request.headers.get("x-card-db-sync-secret"))) {
    return NextResponse.json({ error: "Not authorized" }, { status: 401 })
  }

  let syncRequest
  try {
    syncRequest = parseIncrementalSyncRequest(request.nextUrl.searchParams)
  } catch (error) {
    if (error instanceof InvalidSyncRequestError) {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }
    throw error
  }

  const log: string[] = []
  try {
    const result = await runIncrementalCardDbSync({
      request: syncRequest,
      timeBudgetMs: TIME_BUDGET_MS,
      imageMirror: request.nextUrl.searchParams.get("images") === "0" ? null : getDefaultCardImageMirror(),
      logger: (message) => {
        log.push(message)
        console.log(`[card-db-sync] ${message}`)
      },
    })

    if (!result.dryRun && result.syncedSets.length > 0) {
      revalidateTag("tcg-mirror", { expire: 0 })
    }

    return NextResponse.json({ sync: result, done: result.remainingSetIds.length === 0 })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error("[binderdex] Card DB sync failed:", error)
    const status = message.includes("already running") ? 409 : 500
    return NextResponse.json({ error: message, log: log.slice(-20) }, { status })
  }
}
