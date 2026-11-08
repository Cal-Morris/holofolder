import { readClientFunnelEvent } from "@/lib/collector-funnel"
import { collectorFunnelEnabled, observeCollectorAccount, recordCollectorEvent } from "@/lib/server/collector-funnel"
import { identityJson, identitySession, IdentityError, requireIdentityOrigin } from "@/lib/server/public-binder-identity"
import { resolveCollectionOwnerUserId } from "@/lib/server/collection-owner"
import { createAdminClient } from "@/lib/supabase/admin"

export async function POST(request: Request) {
  try {
    requireIdentityOrigin(request)
    const { user } = await identitySession()
    const text = await request.text()
    if (text.length > 1024) return identityJson({ error: "Event is too large." }, 413)
    let event
    try { event = readClientFunnelEvent(JSON.parse(text)) } catch { return identityJson({ error: "Invalid client event." }, 400) }
    if (!collectorFunnelEnabled()) return identityJson({ recorded: false })
    const ownerId = await resolveCollectionOwnerUserId(createAdminClient(), user.id)
    const at = new Date().toISOString()
    const observed = await observeCollectorAccount(user.id, user.id === ownerId, at, event.attribution)
    const recorded = await recordCollectorEvent({ actorId: user.id, ownerId, name: event.event, key: `${event.event}:${user.id}:${at.slice(0,10)}`, at })
    return identityJson({ recorded: observed && recorded })
  } catch (error) {
    if (error instanceof IdentityError) return identityJson({ error: error.message }, error.status)
    return identityJson({ recorded: false })
  }
}
