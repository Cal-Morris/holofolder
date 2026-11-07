import { createHash } from "node:crypto"
import { verifyEbayNotification } from "@/lib/server/ebay-notifications"

const endpoint = "https://holofolder.com/api/ebay/account-deletion"
const headers = { "Cache-Control": "no-store" }

export async function GET(request: Request) {
  const challenge = new URL(request.url).searchParams.get("challenge_code")
  if (!challenge) return Response.json({ error: "Missing challenge_code" }, { status: 400, headers })
  const token = process.env.EBAY_ACCOUNT_DELETION_VERIFICATION_TOKEN
  if (!token || !/^[A-Za-z0-9_-]{32,80}$/.test(token)) {
    return Response.json({ error: "eBay verification is not configured" }, { status: 503, headers })
  }
  const challengeResponse = createHash("sha256").update(challenge).update(token).update(endpoint).digest("hex")
  return Response.json({ challengeResponse }, { headers })
}

export async function POST(request: Request) {
  if (!process.env.EBAY_CLIENT_ID || !process.env.EBAY_CLIENT_SECRET) {
    return Response.json({ error: "eBay notifications are not configured" }, { status: 503, headers })
  }
  const body = await request.text()
  if (Buffer.byteLength(body) > 65_536) return Response.json({ error: "Notification too large" }, { status: 413, headers })
  let payload
  try {
    payload = JSON.parse(body)
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400, headers })
  }
  if (payload?.metadata?.topic !== "MARKETPLACE_ACCOUNT_DELETION"
    || typeof payload?.notification?.notificationId !== "string" || !payload.notification.notificationId
    || typeof payload?.notification?.data?.userId !== "string" || !payload.notification.data.userId) {
    return Response.json({ error: "Invalid account deletion notification" }, { status: 400, headers })
  }
  try {
    if (!await verifyEbayNotification(payload, request.headers.get("x-ebay-signature") ?? "")) {
      return Response.json({ error: "Invalid eBay signature" }, { status: 412, headers })
    }
  } catch (error) {
    console.warn("[holofolder] eBay notification verification unavailable:", error instanceof Error ? error.message : "Unknown error")
    return Response.json({ error: "eBay signature verification unavailable" }, { status: 503, headers })
  }
  // shortcut: no eBay account data is stored, add verified data deletion before introducing eBay persistence.
  return new Response(null, { status: 204, headers })
}
