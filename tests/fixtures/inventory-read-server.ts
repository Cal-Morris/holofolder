import { createClient } from "@supabase/supabase-js"

// Synthetic auth and PostgREST transport; never reaches a hosted project.
export const owner = "11111111-1111-4111-8111-111111111111"
export const collection = "22222222-2222-4222-8222-222222222222"
type Row = Record<string, unknown>
export function fixture(size = 1031) {
  const tables: Record<string, Row[]> = {
    partnerships: [], inventory_owner_state: [{ owner_user_id: owner, inventory_revision: 7 }],
    binders: [{ id: collection, owner_user_id: owner, name: "Synthetic storage" }],
    storage_collection_state: [{ collection_id: collection, owner_user_id: owner, kind: "binder", default_presentation: "binder", version: 3, layout_revision: 4, authority: "slots", preset_manifest: null }],
    inventory_items: [], inventory_placements: [], binder_slots: [],
  }
  for (let n = 0; n < size; n++) {
    const id = `synthetic-${String(n).padStart(5, "0")}`
    tables.inventory_items.push({ id, owner_user_id: owner, identity: n % 3 ? { kind: "card", cardId: n % 2 ? "legacy-unknown" : "synthetic-energy" } : { kind: "pokemon", pokemonId: 25 }, grading: null, acquired_at: null, version: n })
    tables.inventory_placements.push({ inventory_item_id: id, owner_user_id: owner, collection_id: collection, slot_id: id, version: n })
    tables.binder_slots.push({ id, owner_user_id: owner, collection_id: collection, position: n * 2, target: null, status: "collected", wanted_cards: [], preset_origin: null, version: n })
  }
  let actor = owner, allowed = true, oauth = false
  const requests: { table: string; url: URL; method: string; headers: Headers }[] = []
  let intercept: ((table: string, url: URL) => Response | void) | undefined
  const client = createClient("https://synthetic.supabase.test", "synthetic-key", { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: async (input, init) => {
    const url = new URL(String(input)), table = url.pathname.split("/").at(-1)!
    const method = init?.method ?? "GET"
    requests.push({ table, url, method, headers: new Headers(init?.headers) })
    const overridden = intercept?.(table, url)
    if (overridden) return overridden
    if (table === "billing_partner_allowed") return Response.json(allowed)
    let rows = [...(tables[table] ?? [])]
    for (const [key, filter] of url.searchParams) {
      if (filter.startsWith("eq.")) rows = rows.filter(r => String(r[key]) === filter.slice(3))
      if (filter.startsWith("gt.")) rows = rows.filter(r => typeof r[key] === "number" ? Number(r[key]) > Number(filter.slice(3)) : String(r[key]) > filter.slice(3))
    }
    if (url.searchParams.has("order")) {
      const key = url.searchParams.get("order")!.split(".")[0]
      rows.sort((a, b) => a[key]! < b[key]! ? -1 : a[key]! > b[key]! ? 1 : 0)
    }
    const count = rows.length
    const limit = Math.min(1000, Number(url.searchParams.get("limit") ?? 1000))
    rows = rows.slice(0, limit)
    const select = url.searchParams.get("select")
    if (select && select !== "*") rows = rows.map(r => Object.fromEntries(select.split(",").filter(k => k in r).map(k => [k, r[k]])))
    return new Response(method === "HEAD" ? null : JSON.stringify(rows), { status: 200, headers: { "Content-Type": "application/json", "Content-Range": `0-${Math.max(0, rows.length - 1)}/${count}` } })
  } } })
  client.auth.getClaims = async () => ({ data: { claims: { sub: actor, session_id: "synthetic-auth-session", role: "authenticated", ...(oauth ? { client_id: "synthetic-oauth" } : {}) } }, error: null }) as never
  client.auth.getUser = async () => ({ data: { user: { id: actor } }, error: null }) as never
  return { client, tables, requests, setActor: (id: string) => { actor = id }, deny: () => { allowed = false }, oauth: () => { oauth = true }, intercept: (fn: typeof intercept) => { intercept = fn } }
}
