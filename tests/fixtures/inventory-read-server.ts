import { createClient } from "@supabase/supabase-js"

// Synthetic auth and PostgREST transport; never reaches a hosted project.
export const owner = "11111111-1111-4111-8111-111111111111"
export const collection = "22222222-2222-4222-8222-222222222222"
type Row = Record<string, unknown>
const text = (a: unknown, b: unknown) => String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0

/** Mirror rows the catalog evidence needs for these card ids, matching inventory_snapshot_v2's catalog (exact id, then canonical/alias). */
export function catalogRows(tables: Record<string, Row[]>, ids: Iterable<string>) {
  const wanted = [...new Set(ids)]
  const meta = (c: Row) => (c.external_ids_json as { catalog?: { canonicalId?: string; aliasIds?: string[] } } | null)?.catalog
  const direct = tables.tcg_cards.filter(c => wanted.includes(String(c.id)))
  const fallback = tables.tcg_cards.filter(c => !direct.includes(c) && wanted.some(id => !direct.some(d => d.id === id)
    && (meta(c)?.canonicalId === id || meta(c)?.aliasIds?.includes(id))))
  const cards = [...direct, ...fallback].sort((a, b) => text(a.id, b.id))
  return { cards, dex: tables.tcg_card_dex_ids.filter(d => cards.some(c => c.id === d.card_id)).sort((a, b) => text(a.card_id, b.card_id) || Number(a.dex_id) - Number(b.dex_id)),
    sets: tables.tcg_sets.filter(t => cards.some(c => c.set_id === t.id)).sort((a, b) => text(a.id, b.id)) }
}
/** Card ids a snapshot names: copies, slot targets and wants. */
export function snapshotCardIds(snapshot: { items: { identity: { kind: string; cardId?: string } }[]; binders: { slots: { target: { kind: string; cardId?: string } | null; wantedCards: { card_id: string }[] }[] }[] }) {
  return [...snapshot.items.flatMap(i => i.identity.kind === "card" ? [i.identity.cardId!] : []),
    ...snapshot.binders.flatMap(b => b.slots.flatMap(s => [...(s.target?.kind === "card" ? [s.target.cardId!] : []), ...s.wantedCards.map(w => w.card_id)]))]
}
/** Synthetic inventory_snapshot_v2: same parts, filters, ordering and JSON keys as migration 107. */
export function snapshotDocument(tables: Record<string, Row[]>, owner: string, part = "all", onlyCollection: string | null = null, onlyItem: string | null = null) {
  const own = (t: string) => (tables[t] ?? []).filter(r => r.owner_user_id === owner)
  const slots = own("binder_slots").filter(s => ["all", "slots"].includes(part) && (!onlyCollection || s.collection_id === onlyCollection))
  const binders = own("binders"), states = own("storage_collection_state")
  const ids = [...new Set([...binders.map(b => String(b.id)), ...states.map(s => String(s.collection_id))])]
    .filter(id => part !== "item" && (!onlyCollection || id === onlyCollection)).sort()
  const placementsAll = own("inventory_placements")
  const items = own("inventory_items").filter(i => part === "all" || part === "item" && i.id === onlyItem
    || ["items", "slots"].includes(part) && (!onlyCollection || placementsAll.some(p => p.inventory_item_id === i.id && p.collection_id === onlyCollection)))
    .sort((a, b) => text(a.id, b.id))
  const pick = (r: Row, keys: string[]) => Object.fromEntries(keys.map(k => [k, r[k] ?? null]))
  const cardIds = part !== "all" ? [] : [...items.flatMap(i => (i.identity as Row)?.kind === "card" ? [String((i.identity as Row).cardId)] : []),
    ...slots.flatMap(s => [...((s.target as Row)?.kind === "card" ? [String((s.target as Row).cardId)] : []),
      ...(Array.isArray(s.wanted_cards) ? s.wanted_cards.map(w => String((w as Row).card_id)) : [])])]
  return {
    revision: own("inventory_owner_state")[0]?.inventory_revision ?? null,
    collections: ids.map(id => {
      const b = binders.find(r => r.id === id), st = states.find(r => r.collection_id === id)
      return { id, binder: !!b, state: !!st, ...pick(b ?? {}, ["name", "is_default", "sort_order", "binder_rows", "binder_cols", "updated_at"]),
        ...pick(st ?? {}, ["kind", "default_presentation", "version", "layout_revision", "preset_manifest", "location"]),
        slot_count: part === "collections" ? own("binder_slots").filter(s => s.collection_id === id).length : null,
        slots: ["all", "slots"].includes(part) ? slots.filter(s => s.collection_id === id).sort((a, b) => Number(a.position) - Number(b.position))
          .map(s => pick(s, ["id", "position", "target", "status", "wanted_cards", "preset_origin", "version"])) : null }
    }),
    items: items.map(i => pick(i, ["id", "identity", "grading", "acquired_at", "version"])),
    placements: placementsAll.filter(p => items.some(i => i.id === p.inventory_item_id)).sort((a, b) => text(a.inventory_item_id, b.inventory_item_id))
      .map(p => pick(p, ["inventory_item_id", "collection_id", "slot_id", "version"])),
    catalog: part === "all" ? catalogRows(tables, cardIds) : null,
  }
}
/** Synthetic developer_inventory_read_v1: credential, user, membership and billing checks, then one scoped snapshot. */
export function developerRead(tables: Record<string, Row[]>, body: unknown, current: { oauthPermissions?: unknown; paid: boolean; allowed?: boolean }) {
  const a = JSON.parse(String(body)), forbidden = () => Response.json({ code: "42501", message: "native_read_forbidden" }, { status: 403 })
  const permissions = a.transport === "rest" ? (tables.developer_api_keys ?? []).find(k => k.id === a.credential && k.actor_id === a.actor
    && !k.revoked_at && Date.parse(String(k.expires_at)) > Date.now())?.permissions : a.transport === "mcp" ? current.oauthPermissions : undefined
  if (!permissions) return forbidden()
  const m = tables.partnerships.find(p => p.user1_id === a.actor || p.user2_id === a.actor)
  if (m && ![m.user1_id, m.user2_id].includes(m.owner_user_id) || current.allowed === false) return forbidden()
  const owner = String(m?.owner_user_id ?? a.actor)
  return Response.json({ scope: { permissions, owner, members: m ? [m.user1_id, m.user2_id] : [a.actor], partnership: m ?? null, billing_access: { perpetual: current.paid } },
    snapshot: a.part === "scope" ? null : snapshotDocument(tables, owner, a.part, a.only_collection, a.only_item),
    settings: a.part === "collections" ? tables.user_settings.find(u => u.user_id === owner) ?? null : null })
}
export function fixture(size = 1031, owner = "11111111-1111-4111-8111-111111111111", authSessionId = "synthetic-auth-session") {
  const tables: Record<string, Row[]> = {
    pokemon_collection: [], partnerships: [], inventory_owner_state: [{ owner_user_id: owner, inventory_revision: 7 }],
    binders: [{ id: collection, owner_user_id: owner, name: "Synthetic storage", binder_rows: null, binder_cols: null, updated_at: null }],
    storage_collection_state: [{ collection_id: collection, owner_user_id: owner, kind: "binder", default_presentation: "binder", version: 3, layout_revision: 4, authority: "slots", preset_manifest: null, location: null }],
    inventory_items: [], inventory_placements: [], binder_slots: [], binder_legacy_rows: [], user_settings: [], tcg_cards: [], tcg_sets: [], tcg_card_dex_ids: [],
  }
  for (let n = 0; n < size; n++) {
    const id = `synthetic-${String(n).padStart(5, "0")}`
    tables.inventory_items.push({ id, owner_user_id: owner, identity: n % 3 ? { kind: "card", cardId: n % 2 ? "legacy-unknown" : "synthetic-energy" } : { kind: "pokemon", pokemonId: 25 }, grading: null, acquired_at: null, version: n, legacy_source: null })
    tables.inventory_placements.push({ inventory_item_id: id, owner_user_id: owner, collection_id: collection, slot_id: id, version: n })
    tables.binder_slots.push({ id, owner_user_id: owner, collection_id: collection, position: n * 2, target: null, status: "collected", wanted_cards: [], preset_origin: null, version: n })
  }
  let actor = owner, allowed = true, oauth = false
  const requests: { table: string; url: URL; method: string; headers: Headers }[] = []
  let intercept: ((table: string, url: URL, init?: RequestInit) => Response | void) | undefined
  const transport: typeof fetch = async (input, init) => {
    const url = new URL(String(input)), table = url.pathname.split("/").at(-1)!
    const method = init?.method ?? "GET"
    requests.push({ table, url, method, headers: new Headers(init?.headers) })
    const overridden = intercept?.(table, url, init)
    if (overridden) return overridden
    if (table === "inventory_read_v2") {
      const fail = (message: string, code = "42501") => Response.json({ code, message }, { status: code === "42501" ? 403 : 400 })
      if (oauth) return fail("inventory_sign_in_required")
      const membership = tables.partnerships.filter(p => p.user1_id === actor || p.user2_id === actor)
      if (membership.length > 1) return fail("inventory_read_unavailable", "55000")
      let owner = String(membership[0]?.owner_user_id ?? actor), partnership: Row | null = membership[0] ?? null
      if (!allowed) {
        if (owner === actor) return fail("inventory_read_forbidden")
        owner = actor; partnership = null
      }
      const settings = tables.user_settings.find(s => s.user_id === owner)
      return Response.json({ scope: { actor, owner, session_id: authSessionId, partner_paused: !allowed,
        partnership: partnership && { id: partnership.id, owner_user_id: partnership.owner_user_id, user1_id: partnership.user1_id, user2_id: partnership.user2_id },
        settings: settings ? { binder_rows: settings.binder_rows ?? null, binder_cols: settings.binder_cols ?? null, updated_at: settings.updated_at ?? null } : null },
      snapshot: snapshotDocument(tables, owner) })
    }
    if (table === "billing_partner_allowed") return Response.json(allowed)
    let rows = [...(tables[table] ?? [])]
    // Current 033 policy exposes user_settings only to its user, not their partner.
    if (table === "user_settings") rows = rows.filter(r => r.user_id === actor)
    for (const [key, filter] of url.searchParams) {
      if (filter.startsWith("in.(")) {
        const values = filter.slice(4, -1).split(",").map(v => v.replace(/^"|"$/g, ""))
        rows = rows.filter(r => values.includes(String(r[key])))
      }
      if (filter.startsWith("cs.") && key === "external_ids_json->catalog->aliasIds") rows = rows.filter(r => {
        const aliases = (r.external_ids_json as { catalog?: { aliasIds?: string[] } })?.catalog?.aliasIds ?? []
        return JSON.parse(filter.slice(3)).every((id: string) => aliases.includes(id))
      })
      if (filter.startsWith("eq.")) rows = rows.filter(r => {
        const value = key === "external_ids_json->catalog->>canonicalId" ? (r.external_ids_json as { catalog?: { canonicalId?: string } })?.catalog?.canonicalId : r[key]
        return String(value) === filter.slice(3)
      })
      if (filter.startsWith("gt.")) rows = rows.filter(r => typeof r[key] === "number" ? Number(r[key]) > Number(filter.slice(3)) : String(r[key]) > filter.slice(3))
    }
    if (url.searchParams.has("order")) {
      const key = url.searchParams.get("order")!.split(".")[0]
      rows.sort((a, b) => a[key]! < b[key]! ? -1 : a[key]! > b[key]! ? 1 : 0)
    }
    const count = rows.length
    const limit = Math.min(1000, Number(url.searchParams.get("limit") ?? 1000))
    const offset = Number(url.searchParams.get("offset") ?? 0)
    rows = rows.slice(offset, offset + limit)
    const select = url.searchParams.get("select")
    if (select && select !== "*") rows = rows.map(r => Object.fromEntries(select.split(",").filter(k => k in r).map(k => [k, r[k]])))
    return new Response(method === "HEAD" ? null : JSON.stringify(rows), { status: 200, headers: { "Content-Type": "application/json", "Content-Range": `0-${Math.max(0, rows.length - 1)}/${count}` } })
  }
  const client = createClient("https://synthetic.supabase.test", "synthetic-key", { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: transport } })
  client.auth.getClaims = async () => ({ data: { claims: { sub: actor, session_id: authSessionId, role: "authenticated", ...(oauth ? { client_id: "synthetic-oauth" } : {}) } }, error: null }) as never
  client.auth.getUser = async () => ({ data: { user: { id: actor } }, error: null }) as never
  return { client, transport, tables, requests, setActor: (id: string) => { actor = id }, deny: () => { allowed = false }, oauth: () => { oauth = true }, intercept: (fn: typeof intercept) => { intercept = fn } }
}
