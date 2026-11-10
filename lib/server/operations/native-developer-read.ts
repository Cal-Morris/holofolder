import "server-only"
import { createHash, createHmac, timingSafeEqual } from "node:crypto"
import type { OperationContext } from "@/lib/developer-api/types"
import { DeveloperAccessError, requirePermissions } from "@/lib/developer-api/permissions"
import { decodePage } from "@/lib/developer-api/pagination"
import { COLLECTION_CREATION_LIMITS } from "@/lib/domain/storage-creation"
import { NATIVE_READ_OPERATIONS } from "@/lib/developer-api/native-read"
import { developerReadAuthority } from "@/lib/server/developer-access/native-read"
import { readTrustedInventoryState, InventoryReadError } from "@/lib/server/inventory-read-core"

const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex")
const conflict = (): never => { throw new DeveloperAccessError("stale_native_cursor", "Collection state changed. Restart pagination without a cursor.", 409) }
const invalid = (): never => { throw new DeveloperAccessError("invalid_pagination", "Use an unchanged cursor from this credential and query.", 400) }
const maxResponseBytes = 1024 * 1024

/** Declared authenticated projection, not the private planner transport or a complete/fresh-read ACK. */
function project(state: Awaited<ReturnType<typeof readTrustedInventoryState>>) {
  const { snapshot: s } = state
  const placements = new Map(s.placements.map(p => [p.inventoryItemId, p]))
  const items = s.items.map(i => ({ id: i.id, version: i.version, identity: i.identity, acquiredAt: i.acquiredAt,
    grading: i.grading ? { provider: i.grading.provider, grade: i.grading.grade, scale: i.grading.scale,
      designation: i.grading.designation, holder: i.grading.holder, subgrades: i.grading.subgrades, labelVariant: i.grading.label.variant } : null,
    placement: placements.get(i.id) ?? null }))
  const itemVersions = new Map(s.items.map(i => [i.id, i.version]))
  const collections = s.collections.map(c => {
    const b = s.binders.find(b => b.collectionId === c.id)!, grid = state.navigation.layouts.find(l => l.collectionId === c.id)
    return { ...state.collectionMetadata[c.id], presetManifest: b.presetManifest, id: c.id, name: c.name, kind: c.kind, defaultPresentation: c.defaultPresentation, version: c.version,
      ...(c.location !== undefined ? { location: c.location } : {}), layoutRevision: b.layoutRevision, slotCount: b.slots.length,
      grid: grid ? { rows: grid.rows, cols: grid.cols } : null }
  })
  const collectionVersions = new Map(s.collections.map(c => [c.id, c.version]))
  const slots = s.binders.flatMap(b => b.slots.map(slot => ({ id: slot.id, collectionId: slot.collectionId,
    position: state.slotPositions[slot.id], version: slot.version, collectionVersion: collectionVersions.get(b.collectionId)!,
    layoutRevision: b.layoutRevision, inventoryItemId: slot.inventoryItemId,
    itemVersion: slot.inventoryItemId === null ? null : itemVersions.get(slot.inventoryItemId)!,
    placementVersion: slot.inventoryItemId === null ? null : placements.get(slot.inventoryItemId)!.version,
    target: slot.target, status: slot.status,
    wantedCards: slot.wantedCards.map(w => ({ card_id: w.card_id, card_name: w.card_name, added_at: w.added_at,
      ...(w.card_language ? { card_language: w.card_language } : {}), ...(w.card_finish ? { card_finish: w.card_finish } : {}),
      ...(w.card_set !== undefined ? { card_set: w.card_set } : {}), ...(w.rarity !== undefined ? { rarity: w.rarity } : {}),
      ...(w.local_id !== undefined ? { local_id: w.local_id } : {}), ...(w.illustrator !== undefined ? { illustrator: w.illustrator } : {}),
      ...(w.set_total !== undefined ? { set_total: w.set_total } : {}) })),
  })))
  return { items, collections, slots }
}

/** Entry point is shared by the real dispatcher and both transports. Admission has no override. */
export async function executeNativeDeveloperRead(context: OperationContext, name: string, input: unknown) {
  const operation = NATIVE_READ_OPERATIONS.find(op => op.name === name)
  if (!operation) throw new DeveloperAccessError("not_found", "Native read not found.", 404)
  requirePermissions(context.principal.permissions, operation.permissions)
  const parsed = operation.schema.safeParse(input)
  if (!parsed.success) throw new DeveloperAccessError("invalid_input", "Invalid native read query.", 400)
  const query = parsed.data as Record<string, unknown>
  try {
    const { createAdminClient } = await import("@/lib/supabase/admin")
    const db = createAdminClient()
    // One attempt: changes fail closed, clients restart. Never retain private planning state.
    const state = await readTrustedInventoryState(db, developerReadAuthority(db, context), { attempts: 1, timeoutMs: 15000, maxRequests: 512 })
    const data = project(state)
    // Fences include independent metadata/counts, not only the owner inventory revision.
    const readRevision = hash({ inventoryRevision: state.snapshot.inventoryRevision, evidence: state.evidence, data })
    const envelope = { projection: "developer-native-v1" as const, completeSnapshot: false as const,
      inventoryRevision: state.snapshot.inventoryRevision, readRevision }
    const params = new URLSearchParams(Object.entries(query).filter(([key]) => key !== "cursor").map(([key, value]) => [key, String(value)]))
    const { limit } = decodePage(params)
    const secret = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!secret) throw new Error("Cursor signing unavailable")
    const oauth = context.principal.oauth
    const scope = createHmac("sha256", secret).update("native-read-scope-v1:").update(JSON.stringify({ actor: context.principal.actorId, owner: context.ownerUserId, members: [...context.memberIds].sort(),
      credential: context.principal.credentialId, transport: context.principal.transport, permissions: [...context.principal.permissions].sort(),
      oauth: oauth ? { sessionId: oauth.sessionId, clientId: oauth.clientId, expiresAt: oauth.expiresAt } : null,
      name, query: [...params].sort() })).digest("hex")
    const sign = (body: string) => createHmac("sha256", secret).update(`native-read-v1:${body}`).digest("base64url")
    let after: string | null = null
    if (query.cursor !== undefined) {
      const raw = String(query.cursor)
      if (!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/.test(raw)) return invalid()
      const [body, signature] = raw.split(".")
      if (!timingSafeEqual(Buffer.from(signature), Buffer.from(sign(body)))) return invalid()
      let cursor: unknown
      try { cursor = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) } catch { return invalid() }
      if (!cursor || typeof cursor !== "object" || Array.isArray(cursor)) return invalid()
      const c = cursor as Record<string, unknown>
      if (Object.keys(c).sort().join() !== "after,revision,scope" || c.scope !== scope || typeof c.after !== "string") return invalid()
      if (c.revision !== readRevision) return conflict()
      after = c.after
    }
    const collectionId = query.collectionId
    if (collectionId && !data.collections.some(c => c.id === collectionId)) throw new DeveloperAccessError("not_found", "Collection not found.", 404)
    const cardId = query.cardId
    const itemRows = data.items.filter(i => (!collectionId || i.placement?.collectionId === collectionId)
      && (!cardId || i.identity.kind === "card" && i.identity.cardId === cardId)
      && (!query.assignment || (query.assignment === "assigned") === (i.placement !== null)))
    const slotRows = data.slots.filter(s => s.collectionId === collectionId && (!query.status || s.status === query.status)
      && (!cardId || s.target?.kind === "card" && s.target.cardId === cardId || s.wantedCards.some(w => w.card_id === cardId)
        || data.items.some(i => i.id === s.inventoryItemId && i.identity.kind === "card" && i.identity.cardId === cardId)))
    let result: unknown
    if (name === "get_inventory_item" || name === "get_storage_slot") {
      const row = name === "get_inventory_item" ? data.items.find(i => i.id === query.id) : slotRows.find(s => s.id === query.id)
      if (!row) throw new DeveloperAccessError("not_found", "Native record not found.", 404)
      result = { ...envelope, data: row }
    } else {
      const rows = name === "list_inventory_items" ? itemRows : name === "list_storage_collections" ? data.collections : slotRows
      // Codepoint order is independent of database collation. Slot order uses real persisted position.
      const key = (row: typeof rows[number]) => "position" in row ? `${String(row.position).padStart(16, "0")}:${row.id}` : row.id
      const ordered = rows.toSorted((a, b) => key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0)
      if (after !== null && !ordered.some(row => key(row) === after)) return invalid()
      const start = after === null ? 0 : ordered.findIndex(row => key(row) === after) + 1
      const visible = ordered.slice(start, start + limit)
      const body = Buffer.from(JSON.stringify({ after: visible.length ? key(visible.at(-1)!) : "", revision: readRevision, scope })).toString("base64url")
      result = { ...envelope, data: visible, total: rows.length, nextCursor: start + visible.length < rows.length ? `${body}.${sign(body)}` : null }
    }
    // Strict response validation rejects accidental private fields, including future domain additions.
    const output = operation.responseSchema!.parse(result)
    const responseLimit = name === "list_storage_collections" ? COLLECTION_CREATION_LIMITS.bytes + 16 * 1024 : maxResponseBytes
    if (Buffer.byteLength(JSON.stringify(output)) > responseLimit) throw new DeveloperAccessError("native_read_too_large", "Read a smaller page. This projection exceeds its response byte limit.", 413)
    return output
  } catch (error) {
    if (error instanceof InventoryReadError) throw new DeveloperAccessError(error.code, "Native inventory could not be read consistently. Restart the read.", error.status)
    throw error
  }
}
