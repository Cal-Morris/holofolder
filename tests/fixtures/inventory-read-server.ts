import { createClient } from "@supabase/supabase-js"

// Synthetic auth and PostgREST transport; never reaches a hosted project.
export const owner = "11111111-1111-4111-8111-111111111111"
export const collection = "22222222-2222-4222-8222-222222222222"
type Row = Record<string, unknown>
export function fixture(size = 1031, owner = "11111111-1111-4111-8111-111111111111", authSessionId = "synthetic-auth-session") {
  const tables: Record<string, Row[]> = {
    partnerships: [], inventory_owner_state: [{ owner_user_id: owner, inventory_revision: 7 }],
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
  const client = createClient("https://synthetic.supabase.test", "synthetic-key", { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: async (input, init) => {
    const url = new URL(String(input)), table = url.pathname.split("/").at(-1)!
    const method = init?.method ?? "GET"
    requests.push({ table, url, method, headers: new Headers(init?.headers) })
    const overridden = intercept?.(table, url, init)
    if (overridden) return overridden
    if (table === "inventory_grid_read_v1") {
      const membership = tables.partnerships.filter(p => p.user1_id === actor || p.user2_id === actor)
      const resolved = membership[0]?.owner_user_id ?? actor
      const settings = tables.user_settings.filter(s => s.user_id === resolved)
      if (!allowed || oauth || membership.length > 1 || settings.length > 1) return Response.json({ code: "42501" }, { status: 403 })
      return Response.json({ owner_user_id: resolved, partnership: membership[0] ?? null,
        settings: settings[0] ? Object.fromEntries(["binder_rows", "binder_cols", "updated_at"].map(k => [k, settings[0][k] ?? null])) : null })
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
      if (filter.startsWith("cs.")) rows = rows.filter(r => {
        const aliases = (r[key] as { catalog?: { aliasIds?: string[] } })?.catalog?.aliasIds ?? []
        return JSON.parse(filter.slice(3)).catalog.aliasIds.every((id: string) => aliases.includes(id))
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
  } } })
  client.auth.getClaims = async () => ({ data: { claims: { sub: actor, session_id: authSessionId, role: "authenticated", ...(oauth ? { client_id: "synthetic-oauth" } : {}) } }, error: null }) as never
  client.auth.getUser = async () => ({ data: { user: { id: actor } }, error: null }) as never
  return { client, tables, requests, setActor: (id: string) => { actor = id }, deny: () => { allowed = false }, oauth: () => { oauth = true }, intercept: (fn: typeof intercept) => { intercept = fn } }
}
