import type { SupabaseClient } from "@supabase/supabase-js"
import { isSlotContractId, isSlotRevision, normalizeBinderSlot, normalizeBinderSnapshot } from "@/lib/domain/binder-slots"
import { normalizeInventoryItem, normalizePlacement, normalizeStorageCollection } from "@/lib/domain/inventory"
import {
  readAllSlotPages, readCompleteInventorySnapshot, readCompleteSnapshotRows,
  type CompleteInventorySnapshot, type SnapshotPage,
} from "@/lib/collection/slot-snapshot"

/** Private first-party state only. Never serialize this through share/REST/MCP. */
export class InventoryReadError extends Error {
  constructor(readonly code: "inventory_sign_in_required" | "inventory_read_forbidden" | "inventory_read_unavailable"
    | "inventory_not_initialized" | "legacy_inventory_incomplete" | "inventory_read_conflict" | "inventory_read_deadline",
  readonly status: 401 | 403 | 409 | 503) { super(code) }
}
type Row = Record<string, unknown>
const PAGE = 500
const STATE = "collection_id,owner_user_id,kind,default_presentation,version,layout_revision,preset_manifest,authority"
const SLOT = "id,owner_user_id,collection_id,position,target,status,wanted_cards,preset_origin,version"
const fail = (code: InventoryReadError["code"], status: InventoryReadError["status"]): never => { throw new InventoryReadError(code, status) }
const conflict = (): never => fail("inventory_read_conflict", 409)
const unavailable = (): never => fail("inventory_read_unavailable", 503)
function rows(value: unknown): Row[] {
  if (!Array.isArray(value) || value.some(r => !r || typeof r !== "object" || Array.isArray(r))) return unavailable()
  return value as Row[]
}
function valid<T>(value: T | undefined): T { return value === undefined ? unavailable() : value }

export interface InventoryReadOptions {
  /** Trusted server budget, never pass HTTP input here. At most three whole-snapshot attempts. */
  attempts?: number
  timeoutMs?: number
  maxRequests?: number
}

/** Supply the request's cookie/RLS client, never an admin client or caller-supplied owner/actor.
 * With no client, creates the standard server session client. Each invocation reads current state;
 * queue integration must invoke AFTER successful ledger replay, never use the retained SQL result. */
export async function readOwnerInventorySnapshot(client?: SupabaseClient, options: InventoryReadOptions = {}): Promise<CompleteInventorySnapshot> {
  const attempts = options.attempts ?? 2, timeoutMs = options.timeoutMs ?? 15_000, maxRequests = options.maxRequests ?? 512
  if (!Number.isInteger(attempts) || attempts < 1 || attempts > 3 || !Number.isInteger(timeoutMs) || timeoutMs < 0 || timeoutMs > 30_000
    || !Number.isInteger(maxRequests) || maxRequests < 1 || maxRequests > 4096) return unavailable()
  if (timeoutMs === 0) return fail("inventory_read_deadline", 503)
  const controller = new AbortController()
  const deadline = Date.now() + timeoutMs
  let requests = 0
  const check = () => {
    if (Date.now() >= deadline) controller.abort()
    if (controller.signal.aborted) fail("inventory_read_deadline", 503)
    if (++requests > maxRequests) unavailable()
  }
  const timeout = new Promise<never>((_, reject) => {
    controller.signal.addEventListener("abort", () => reject(new InventoryReadError("inventory_read_deadline", 503)), { once: true })
  })
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const work = async () => {
      const db = client ?? await (await import("@/lib/supabase/server")).createClient()
      // This helper deliberately does not reuse developer OperationContext: that is a paid grant
      // boundary with different credentials/projections. Authentication here comes from this session.
      async function scope() {
        check()
        const claims = await db.auth.getClaims()
        if (claims.error || !claims.data?.claims.sub || claims.data.claims.client_id || claims.data.claims.role !== "authenticated") fail("inventory_sign_in_required", 401)
        check()
        const user = await db.auth.getUser()
        const actor = user.data.user?.id
        if (user.error || !actor || actor !== claims.data!.claims.sub) return fail("inventory_sign_in_required", 401)
        check()
        const membership = await db.from("partnerships").select("id,owner_user_id,user1_id,user2_id")
          .or(`user1_id.eq.${actor},user2_id.eq.${actor}`).limit(2).abortSignal(controller.signal)
        if (membership.error) return unavailable()
        const partners = rows(membership.data)
        if (partners.length > 1) return unavailable()
        const p = partners[0]
        if (p && (p.user1_id !== actor && p.user2_id !== actor || p.owner_user_id !== p.user1_id && p.owner_user_id !== p.user2_id)) return fail("inventory_read_forbidden", 403)
        const owner = p ? p.owner_user_id : actor
        if (!isSlotContractId(owner)) return unavailable()
        check()
        const access = await db.rpc("billing_partner_allowed", { owner_id: owner, actor_id: actor }).abortSignal(controller.signal)
        // Unlike legacy compatibility, missing billing policy never silently allows new reads.
        if (access.error || typeof access.data !== "boolean") return unavailable()
        if (!access.data) return fail("inventory_read_forbidden", 403)
        return { actor, owner, partnership: p ?? null }
      }
      const initialScope = await scope()
      const owner = initialScope.owner
      const sameScope = async () => { if (JSON.stringify(await scope()) !== JSON.stringify(initialScope)) conflict() }
      async function revision() {
        check()
        const result = await db.from("inventory_owner_state").select("owner_user_id,inventory_revision")
          .eq("owner_user_id", owner).abortSignal(controller.signal).maybeSingle()
        if (result.error) return unavailable()
        if (!result.data) return fail("inventory_not_initialized", 503)
        if (result.data.owner_user_id !== owner || !isSlotRevision(result.data.inventory_revision)) return unavailable()
        return result.data.inventory_revision as number
      }
      async function count(table: string, collection?: string) {
        check()
        let query = db.from(table).select("owner_user_id", { count: "exact", head: true }).eq("owner_user_id", owner)
        if (collection) query = query.eq("collection_id", collection)
        const result = await query.abortSignal(controller.signal)
        if (result.error || !isSlotRevision(result.count)) return unavailable()
        return result.count
      }
      function reader(table: string, projection: string, key: string, revision: number, total: number) {
        return async (after: string | null): Promise<SnapshotPage<Row>> => {
          check()
          let query = db.from(table).select(projection).eq("owner_user_id", owner).order(key, { ascending: true }).limit(PAGE)
          if (after !== null) query = query.gt(key, after)
          const result = await query.abortSignal(controller.signal)
          if (result.error) return unavailable()
          const page = rows(result.data)
          if (page.length > PAGE || page.some(r => r.owner_user_id !== owner || !isSlotContractId(r[key]))) return unavailable()
          // PostgreSQL owns text collation. Shared validation rejects duplicate IDs/cursor cycles.
          return { inventoryRevision: revision, total, rows: page, next: page.length === PAGE ? String(page.at(-1)![key]) : null }
        }
      }
      async function metadata(rev: number) {
        const stateTotal = await count("storage_collection_state"), binderTotal = await count("binders")
        const states = await readCompleteSnapshotRows(reader("storage_collection_state", STATE, "collection_id", rev, stateTotal), rev, r => String(r.collection_id))
        const binders = await readCompleteSnapshotRows(reader("binders", "id,owner_user_id,name", "id", rev, binderTotal), rev, r => String(r.id))
        if (stateTotal !== binderTotal || binders.some(b => !states.some(s => s.collection_id === b.id)) || states.some(s => s.authority !== "slots")) {
          // A concurrent conversion/create is retryable; stable legacy is an honest boundary.
          if (await revision() !== rev) conflict()
          return fail("legacy_inventory_incomplete", 503)
        }
        if (states.some(s => !isSlotRevision(s.version) || !isSlotRevision(s.layout_revision))) return unavailable()
        return { states, binders }
      }
      for (let attempt = 0; attempt < attempts; attempt++) {
        try {
          await sameScope()
          const rev = await revision(), meta = await metadata(rev)
          const itemCount = await count("inventory_items"), placementCount = await count("inventory_placements"), slotCount = await count("binder_slots")
          const placementRows = await readCompleteSnapshotRows(reader("inventory_placements", "inventory_item_id,owner_user_id,collection_id,slot_id,version", "inventory_item_id", rev, placementCount), rev, r => String(r.inventory_item_id))
          const placements = placementRows.map(r => valid(normalizePlacement({ inventoryItemId: r.inventory_item_id, collectionId: r.collection_id, slotId: r.slot_id, version: r.version })))
          const collections = meta.states.map(s => valid(normalizeStorageCollection({ id: s.collection_id, ownerUserId: owner,
            name: meta.binders.find(b => b.id === s.collection_id)!.name, kind: s.kind, defaultPresentation: s.default_presentation, version: s.version })))
          const itemReader = reader("inventory_items", "id,owner_user_id,identity,grading,acquired_at,version", "id", rev, itemCount)
          const collectionReader = reader("storage_collection_state", STATE, "collection_id", rev, meta.states.length)
          let snapshotSlotCount = 0
          const binderReader = async (after: string | null) => {
            const page = await collectionReader(after)
            const binders = []
            for (const s of page.rows) {
              if (JSON.stringify(s) !== JSON.stringify(meta.states.find(state => state.collection_id === s.collection_id))) conflict()
              const collectionId = String(s.collection_id), slotCount = await count("binder_slots", collectionId)
              let loaded = 0
              const slotPage = await readAllSlotPages(async continuation => {
                if (continuation && (continuation.inventoryRevision !== rev || continuation.collectionVersion !== s.version || continuation.layoutRevision !== s.layout_revision)) conflict()
                check()
                let query = db.from("binder_slots").select(SLOT).eq("owner_user_id", owner).eq("collection_id", collectionId)
                  .order("position", { ascending: true }).limit(PAGE)
                if (continuation) query = query.gt("position", continuation.afterPosition)
                const result = await query.abortSignal(controller.signal)
                if (result.error) return unavailable()
                const slots = rows(result.data)
                if (slots.some(r => r.owner_user_id !== owner || r.collection_id !== collectionId)) return unavailable()
                loaded += slots.length
                if (loaded > slotCount || !slots.length && loaded < slotCount) conflict()
                return { inventoryRevision: rev, collectionVersion: s.version as number, layoutRevision: s.layout_revision as number,
                  slots: slots as Array<{ id: string; position: number } & Row>, nextPosition: loaded < slotCount ? slots.at(-1)!.position as number : null }
              })
              if (loaded !== slotCount || await count("binder_slots", collectionId) !== slotCount) conflict()
              snapshotSlotCount += loaded
              binders.push(valid(normalizeBinderSnapshot({ ownerUserId: owner, collectionId, layoutRevision: s.layout_revision as number, presetManifest: s.preset_manifest,
                slots: slotPage.slots.map(r => valid(normalizeBinderSlot({ id: r.id, ownerUserId: r.owner_user_id, collectionId: r.collection_id,
                  target: r.target, status: r.status, wantedCards: r.wanted_cards, version: r.version, presetOrigin: r.preset_origin,
                  inventoryItemId: placements.find(p => p.slotId === r.id)?.inventoryItemId ?? null }))) })))
            }
            return { ...page, rows: binders }
          }
          // Shared completeness validation and final fences all precede branding/publication.
          const snapshot = await readCompleteInventorySnapshot(owner, rev, {
            items: async after => { const page = await itemReader(after); return { ...page, rows: page.rows.map(r => valid(normalizeInventoryItem({ id: r.id,
              ownerUserId: r.owner_user_id, identity: r.identity, grading: r.grading, acquiredAt: r.acquired_at, version: r.version }))) } },
            placements: async after => {
              // Already consumed every actual placement page above to project occupied slots.
              const start = after === null ? 0 : placements.findIndex(p => p.inventoryItemId === after) + 1
              const page = placements.slice(start, start + PAGE)
              return { inventoryRevision: rev, total: placementCount, rows: page, next: start + page.length < placementCount ? page.at(-1)!.inventoryItemId : null }
            },
            collections: async after => { const page = await collectionReader(after); return { ...page, rows: page.rows.map(s => {
              if (JSON.stringify(s) !== JSON.stringify(meta.states.find(state => state.collection_id === s.collection_id))) conflict()
              return collections.find(c => c.id === s.collection_id)!
            }) } },
            binders: binderReader,
          }, async () => {
            if (await count("inventory_items") !== itemCount || await count("inventory_placements") !== placementCount
              || await count("binder_slots") !== slotCount || snapshotSlotCount !== slotCount) conflict()
            if (JSON.stringify(await metadata(rev)) !== JSON.stringify(meta) || await revision() !== rev) conflict()
            await sameScope()
            check()
          })
          return snapshot
        } catch (error) {
          if (error instanceof InventoryReadError && error.code === "inventory_read_conflict" && attempt + 1 < attempts) continue
          // Shared validators' details and PostgREST errors never cross this private API boundary.
          if (error instanceof InventoryReadError) throw error
          return unavailable()
        }
      }
      return conflict()
    }
    return await Promise.race([work(), timeout])
  } catch (error) {
    if (error instanceof InventoryReadError) throw error
    return unavailable()
  } finally { clearTimeout(timer); controller.abort() }
}
