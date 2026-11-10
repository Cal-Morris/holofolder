import { NextResponse } from "next/server"

function retainedQueueResponse(): Response {
  return NextResponse.json({
    error: "Collection uploads are paused. Keep this change on this device and reload the app before reviewing it.",
    code: "collection_queue_upgrade_required", retainOnDevice: true,
  }, { status: 503, headers: { "Cache-Control": "private, no-store" } })
}

/** Missing protocol remains compatible and untagged until the database fence is activated. */
export function legacyQueueProtocolResponse(headers: Headers): Response | null {
  const protocol = headers.get("X-Holo-Legacy-Queue")
  return protocol !== null && protocol !== "2" ? retainedQueueResponse() : null
}

/** Recognize only the installed pause error, including wrappers from atomic save helpers. */
export function legacyWritePausedResponse(error: unknown): Response | null {
  const seen = new Set<object>()
  while (error && typeof error === "object" && !seen.has(error)) {
    seen.add(error)
    if ("code" in error && error.code === "PT503" && "message" in error && error.message === "legacy_collection_write_paused")
      return retainedQueueResponse()
    error = "cause" in error ? error.cause : null
  }
  return null
}
