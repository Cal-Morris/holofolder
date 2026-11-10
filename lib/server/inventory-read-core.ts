import { readInventoryCatalog } from "@/lib/server/inventory-read-catalog"
import { isBinderGridSize, withBinderLayout } from "@/lib/binder-layout"
import { settingsFromRow } from "@/lib/settings"
import type { InventoryNavigationEvidence, InventoryReadEvidence } from "@/lib/collection/inventory-read-transport"
import type { SupabaseClient } from "@supabase/supabase-js"
import { isSlotContractId, isSlotRevision, normalizeBinderSlot, normalizeBinderSnapshot } from "@/lib/domain/binder-slots"
import { normalizeInventoryItem, normalizePlacement, normalizeStorageCollection } from "@/lib/domain/inventory"
import {
  readAllSlotPages, readCompleteInventorySnapshot, readCompleteSnapshotRows,
  type CompleteInventorySnapshot, type SnapshotPage,
} from "@/lib/collection/slot-snapshot"

/** Internal planning state only. Transports must use their explicitly declared projection. */
export class InventoryReadError extends Error {
  constructor(readonly code: "inventory_sign_in_required" | "inventory_read_forbidden" | "inventory_read_unavailable"
    | "inventory_not_initialized" | "legacy_inventory_incomplete" | "inventory_read_conflict" | "inventory_read_deadline",
  readonly status: 401 | 403 | 409 | 503) { super(code) }
}
type Row = Record<string, unknown>
const PAGE = 500
const STATE = "collection_id,owner_user_id,kind,default_presentation,version,layout_revision,preset_manifest,authority,location"
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

/** Internal trusted boundary. Only the cookie and verified developer adapters supply authority.
 * Never expose the client or scope callback as request input. All streams share the same fences. */
export interface InventoryReadAuthority {
  scope: (check: () => void, signal: AbortSignal) => Promise<{
    actor: string; owner: string; authorityId: string; partnership: Record<string, unknown> | null
  }>
  privateSettings: boolean
}
export async function readTrustedInventoryState(db: SupabaseClient, authority: InventoryReadAuthority, options: InventoryReadOptions = {}): Promise<{
  snapshot: CompleteInventorySnapshot
  actorUserId: string
  partnerUserId: string | null
  authorityId: string
  evidence: InventoryReadEvidence
  navigation: InventoryNavigationEvidence
  slotPositions: Record<string, number>
  collectionMetadata: Record<string, { isDefault: boolean | null; sortOrder: number | null; updatedAt: string | null }>
}> {
  const attempts = options.attempts ?? 2, timeoutMs = options.timeoutMs ?? 15_000, maxRequests = options.maxRequests ?? 512
  if (!Number.isInteger(attempts) || attempts < 1 || attempts > 3 || !Number.isInteger(timeoutMs) || timeoutMs < 0 || timeoutMs > 30_000
    || !Number.isInteger(maxRequests) || maxRequests < 1 || maxRequests > 4096) return unavailable()
  if (timeoutMs === 0) return fail("inventory_read_deadline", 503)
  const controller = new AbortController()
  const deadline = Date.now() + timeoutMs
  let requests = 0
  let authorityFailure: unknown
  let bytes = 0
  const accountBytes = (value: unknown) => {
    bytes += Buffer.byteLength(JSON.stringify(value))
    if (bytes > 32 * 1024 * 1024) return unavailable()
  }
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
      const scope = async () => {
        try { return await authority.scope(check, controller.signal) }
        catch (error) { authorityFailure = error; throw error }
      }
      const initialScope = await scope()
      const owner = initialScope.owner
      const partnerUserId = initialScope.partnership ? (initialScope.partnership.user1_id === owner ? initialScope.partnership.user2_id : initialScope.partnership.user1_id) : null
      if (partnerUserId !== null && (!isSlotContractId(partnerUserId) || partnerUserId === owner)) return unavailable()
      const sameScope = async () => { if (JSON.stringify(await scope()) !== JSON.stringify(initialScope)) conflict() }
      async function revision() {
        check()
        const result = await db.from("inventory_owner_state").select("owner_user_id,inventory_revision")
          .eq("owner_user_id", owner).abortSignal(controller.signal).maybeSingle()
        if (result.error) return unavailable()
        if (!result.data) return null
        if (result.data.owner_user_id !== owner || !isSlotRevision(result.data.inventory_revision)) return unavailable()
        return result.data.inventory_revision as number
      }
      async function count(table: string, collection?: string) {
        check()
        const ownerColumn = table === "pokemon_collection" ? "user_id" : "owner_user_id"
        let query = db.from(table).select(ownerColumn, { count: "exact", head: true }).eq(ownerColumn, owner)
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
          accountBytes(page)
          if (page.length > PAGE || page.some(r => r.owner_user_id !== owner || !isSlotContractId(r[key]))) return unavailable()
          // PostgreSQL owns text collation. Shared validation rejects duplicate IDs/cursor cycles.
          return { inventoryRevision: revision, total, rows: page, next: page.length === PAGE ? String(page.at(-1)![key]) : null }
        }
      }
      async function metadata(rev: number, rootRevision: number | null) {
        const [stateTotal, binderTotal] = await Promise.all([count("storage_collection_state"), count("binders")])
        const [states, binders] = await Promise.all([
          readCompleteSnapshotRows(reader("storage_collection_state", STATE, "collection_id", rev, stateTotal), rev, r => String(r.collection_id)),
          readCompleteSnapshotRows(reader("binders", "id,owner_user_id,name,is_default,sort_order,binder_rows,binder_cols,updated_at", "id", rev, binderTotal), rev, r => String(r.id)),
        ])
        if (stateTotal !== binderTotal || binders.some(b => !states.some(s => s.collection_id === b.id)) || states.some(s => s.authority !== "slots")) {
          // A concurrent conversion/create is retryable; stable legacy is an honest boundary.
          if (await revision() !== rootRevision) conflict()
          return fail("legacy_inventory_incomplete", 503)
        }
        if (states.some(s => !isSlotRevision(s.version) || !isSlotRevision(s.layout_revision))) return unavailable()
        if (!authority.privateSettings) {
          check()
          const grid = await db.rpc("inventory_grid_read_v1").abortSignal(controller.signal)
          if (!grid.error) {
            const value: unknown = grid.data
            const keys = (v: unknown, expected: string[]): v is Row => !!v && typeof v === "object" && !Array.isArray(v)
              && Object.keys(v).length === expected.length && expected.every(key => Object.hasOwn(v, key))
            if (!keys(value, ["owner_user_id", "partnership", "settings"])) return unavailable()
            if (value.owner_user_id !== owner) conflict()
            const p = value.partnership
            if (p !== null && !keys(p, ["id", "owner_user_id", "user1_id", "user2_id"])) return unavailable()
            if (p === null ? initialScope.partnership !== null : initialScope.partnership === null
              || Object.entries(p).some(([key, v]) => initialScope.partnership![key] !== v)) conflict()
            const settings = value.settings
            if (settings !== null && (!keys(settings, ["binder_rows", "binder_cols", "updated_at"])
              || settings.updated_at !== null && typeof settings.updated_at !== "string")) return unavailable()
            return { states, binders, stateTotal, binderTotal, settings, settingsKnown: true }
          }
          if (grid.error.code === "42501" && grid.error.message === "inventory_sign_in_required") return fail("inventory_sign_in_required", 401)
          if (grid.error.code === "42501" && grid.error.message === "inventory_read_forbidden") return fail("inventory_read_forbidden", 403)
          // Only an uninstalled RPC retains 439's safe behavior; permission/auth failures fail closed.
          const missingGrid = grid.error.code === "PGRST202" || grid.error.code === "42883"
            && grid.error.message === "function public.inventory_grid_read_v1() does not exist"
          if (!missingGrid) return unavailable()
        }
        check()
        const settings = await db.from("user_settings").select("user_id,binder_rows,binder_cols,updated_at").eq("user_id", owner).limit(2).abortSignal(controller.signal)
        if (settings.error) return unavailable()
        const settingsRows = rows(settings.data)
        if (settingsRows.length > 1 || settingsRows.some(r => r.user_id !== owner)) return unavailable()
        return { states, binders, stateTotal, binderTotal, settings: settingsRows[0] ?? null, settingsKnown: authority.privateSettings || initialScope.actor === owner }
      }
      for (let attempt = 0; attempt < attempts; attempt++) {
        try {
          await sameScope()
          const rootRevision = await revision(), rev = rootRevision ?? 0
          // Absence is a revision-zero planning base only for a proven untouched owner.
          // Never provision rows in GET; trusted first creation needs the parent 098 prerequisite.
          const proveEmpty = async (final: boolean) => {
            for (const table of ["binders", "pokemon_collection", "storage_collection_state", "inventory_items", "binder_slots", "inventory_placements", "binder_legacy_rows"]) {
              if (await count(table) !== 0) {
                if (final || await revision() !== null) conflict()
                return fail("inventory_not_initialized", 503)
              }
            }
            if (await revision() !== null) conflict()
          }
          if (rootRevision === null) await proveEmpty(false)
          const meta = await metadata(rev, rootRevision)
          const sourceCount = await count("binder_legacy_rows")
          const sourceRows = await readCompleteSnapshotRows(reader("binder_legacy_rows", "legacy_row_id,owner_user_id,collection_id,slot_id,source_row", "legacy_row_id", rev, sourceCount), rev, r => String(r.legacy_row_id))
          const sourceBySlot = new Map(sourceRows.map(r => [r.slot_id, r]))
          if (sourceBySlot.size !== sourceRows.length) return unavailable()
          const sourceForSlot = (slot: Row) => {
            const source = sourceBySlot.get(slot.id)
            if (!source) return null
            if (source.collection_id !== slot.collection_id) return unavailable()
            return { legacyRowId: source.legacy_row_id, sourceRow: source.source_row }
          }
          const [itemCount, placementCount, slotCount] = await Promise.all([count("inventory_items"), count("inventory_placements"), count("binder_slots")])
          const placementRows = await readCompleteSnapshotRows(reader("inventory_placements", "inventory_item_id,owner_user_id,collection_id,slot_id,version", "inventory_item_id", rev, placementCount), rev, r => String(r.inventory_item_id))
          const placements = placementRows.map(r => valid(normalizePlacement({ inventoryItemId: r.inventory_item_id, collectionId: r.collection_id, slotId: r.slot_id, version: r.version })))
          const placementsBySlot = new Map(placements.map(p => [p.slotId, p]))
          if (placementsBySlot.size !== placements.length) return unavailable()
          const collections = meta.states.map(s => valid(normalizeStorageCollection({ id: s.collection_id, ownerUserId: owner,
            name: meta.binders.find(b => b.id === s.collection_id)!.name, kind: s.kind, defaultPresentation: s.default_presentation, location: s.location, version: s.version })))
          const itemReader = reader("inventory_items", "id,owner_user_id,identity,grading,acquired_at,version,legacy_source", "id", rev, itemCount)
          const collectionReader = reader("storage_collection_state", STATE, "collection_id", rev, meta.stateTotal)
          const slotPositions: Record<string, number> = Object.create(null)
          let snapshotSlotCount = 0
          const storage: InventoryReadEvidence["storage"] = []
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
                accountBytes(slots)
                if (slots.some(r => r.owner_user_id !== owner || r.collection_id !== collectionId)) return unavailable()
                loaded += slots.length
                if (loaded > slotCount || !slots.length && loaded < slotCount) conflict()
                return { inventoryRevision: rev, collectionVersion: s.version as number, layoutRevision: s.layout_revision as number,
                  slots: slots as Array<{ id: string; position: number } & Row>, nextPosition: loaded < slotCount ? slots.at(-1)!.position as number : null }
              })
              if (loaded !== slotCount || await count("binder_slots", collectionId) !== slotCount) conflict()
              for (const slot of slotPage.slots) slotPositions[slot.id] = slot.position
              snapshotSlotCount += loaded
              storage.push({ collectionId, collectionVersion: s.version as number, layoutRevision: s.layout_revision as number, slotCount })
              binders.push(valid(normalizeBinderSnapshot({ ownerUserId: owner, collectionId, layoutRevision: s.layout_revision as number, presetManifest: s.preset_manifest,
                slots: slotPage.slots.map(r => valid(normalizeBinderSlot({ id: r.id, ownerUserId: r.owner_user_id, collectionId: r.collection_id,
                  target: r.target, status: r.status, wantedCards: r.wanted_cards, version: r.version, presetOrigin: r.preset_origin,
                  legacySource: sourceForSlot(r),
                  inventoryItemId: placementsBySlot.get(String(r.id))?.inventoryItemId ?? null }))) })))
            }
            return { ...page, rows: binders }
          }
          // Shared completeness validation and final fences all precede branding/publication.
          const snapshot = await readCompleteInventorySnapshot(owner, rev, {
            items: async after => { const page = await itemReader(after); return { ...page, rows: page.rows.map(r => valid(normalizeInventoryItem({ id: r.id,
              ownerUserId: r.owner_user_id, identity: r.identity, grading: r.grading, acquiredAt: r.acquired_at, version: r.version, legacySource: r.legacy_source }))) } },
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
            const [finalItems, finalPlacements, finalSlots] = await Promise.all([count("inventory_items"), count("inventory_placements"), count("binder_slots")])
            if (finalItems !== itemCount || finalPlacements !== placementCount || finalSlots !== slotCount || snapshotSlotCount !== slotCount) conflict()
            if (JSON.stringify(await metadata(rev, rootRevision)) !== JSON.stringify(meta) || await revision() !== rootRevision) conflict()
            await sameScope()
            check()
          })
          if (sourceRows.some(source => !snapshot.binders.some(b => b.collectionId === source.collection_id && b.slots.some(slot => slot.id === source.slot_id)))) return unavailable()
          const catalog = await readInventoryCatalog(db, snapshot, controller.signal, check, accountBytes)
          const layouts: InventoryNavigationEvidence["layouts"] = []
          for (const b of meta.binders) {
            const settings = meta.settings
            const known = (v: unknown) => v === null || isBinderGridSize(v)
            // Missing columns/invalid data are unknown, unlike a successfully read absent settings row.
            if (!known(b.binder_rows) || !known(b.binder_cols)) continue
            // Only the narrow RPC (or an owner table read) can prove row absence.
            const ownerDimensionKnown = (key: "binder_rows" | "binder_cols") => settings ? known(settings[key]) : meta.settingsKnown
            if (b.binder_rows === null && !ownerDimensionKnown("binder_rows") || b.binder_cols === null && !ownerDimensionKnown("binder_cols")) continue
            const grid = withBinderLayout(settingsFromRow(settings), { rows: b.binder_rows as number | null, cols: b.binder_cols as number | null })
            layouts.push({ collectionId: String(b.id), layoutRevision: snapshot.binders.find(s => s.collectionId === b.id)!.layoutRevision, rows: grid.binderRows, cols: grid.binderCols })
          }
          if (JSON.stringify(await metadata(rev, rootRevision)) !== JSON.stringify(meta) || await revision() !== rootRevision) conflict()
          if (await count("binder_legacy_rows") !== sourceCount) conflict()
          const finalSources = await readCompleteSnapshotRows(reader("binder_legacy_rows", "legacy_row_id,owner_user_id,collection_id,slot_id,source_row", "legacy_row_id", rev, sourceCount), rev, r => String(r.legacy_row_id))
          if (JSON.stringify(finalSources) !== JSON.stringify(sourceRows)) conflict()
          await sameScope()
          if (rootRevision === null) {
            await proveEmpty(true)
            await sameScope()
            if (await revision() !== null) conflict()
          }
          const collectionMetadata = Object.fromEntries(meta.binders.map(b => [String(b.id), {
            isDefault: typeof b.is_default === "boolean" ? b.is_default : null,
            sortOrder: isSlotRevision(b.sort_order) ? b.sort_order : null,
            updatedAt: typeof b.updated_at === "string" ? b.updated_at : null,
          }]))
          return { snapshot, slotPositions, collectionMetadata, partnerUserId, navigation: { catalog, layouts }, actorUserId: initialScope.actor, authorityId: initialScope.authorityId,
            evidence: { inventoryRevision: rev, items: itemCount, placements: placementCount,
              collections: meta.stateTotal, binders: meta.binderTotal, slots: slotCount, storage } }
        } catch (error) {
          if (error instanceof InventoryReadError && error.code === "inventory_read_conflict" && attempt + 1 < attempts) continue
          // Shared validators' details and PostgREST errors never cross this private API boundary.
          if (error === authorityFailure || error instanceof InventoryReadError) throw error
          return unavailable()
        }
      }
      return conflict()
    }
    return await Promise.race([work(), timeout])
  } catch (error) {
    if (error === authorityFailure || error instanceof InventoryReadError) throw error
    return unavailable()
  } finally { clearTimeout(timer); controller.abort() }
}
