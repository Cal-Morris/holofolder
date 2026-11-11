import type { SupabaseClient } from '@supabase/supabase-js'

/** Synthetic PostgREST-shaped backend. No real user/card/certificate data or hosted writes. */
/** `scenario` gives the owner and token their own suffix, so several synthetic shares can be served side by side. */
export function syntheticPublicDatabase(options: { disabled?: boolean; large?: boolean; unknown?: boolean; change?: 'revoke' | 'identity' | 'order' | 'copy' | 'metadata'; prices?: boolean; scenario?: string } = {}) {
  const owner = options.scenario ? `PRIVATE-owner-${options.scenario}` : 'PRIVATE-owner', collection = 'binder-allowed'
  const share = { owner_user_id: owner, binder_id: collection, token: options.scenario ? `synthetic-${options.scenario}` : 'synthetic-token', is_enabled: !options.disabled, show_prices: options.prices === true }
  const binder = { id: collection, owner_user_id: owner, name: 'Synthetic mixed binder', is_default: true, binder_rows: 2, binder_cols: 3, updated_at: 'synthetic-1' }
  const state = { owner_user_id: owner, collection_id: collection, authority: 'slots', conversion_version: null, version: 1, layout_revision: 1 }
  const scopes = { owner_user_id: owner, collection_id: collection }
  const slots = Array.from({ length: options.large ? 1007 : 7 }, (_, i) => ({ id: `PRIVATE-slot-${i}`, ...scopes, position: i,
    target: i === 0 || i === 1 || i === 6 ? { kind: 'pokemon', pokemonId: 143 } : null,
    status: i < 4 || options.large ? 'collected' : null, version: 1, wanted_cards: [{ wanted_by: ['PRIVATE-member'], card_image: 'https://PRIVATE-image', source: 'PRIVATE-want-source' }], preset_origin: { source: 'PRIVATE-removed-target' } }))
  const placements = slots.filter(s => s.status).map((s, i) => ({ ...scopes, slot_id: s.id, inventory_item_id: `PRIVATE-copy-${i}`, version: 1 }))
  const items = placements.map((p, i) => ({ id: p.inventory_item_id, owner_user_id: owner, identity: { kind: 'card', cardId: i < 2 || options.large ? 'synthetic-mon' : i === 2 ? 'synthetic-trainer' : 'synthetic-energy' },
    grading: { grade: '9', certificate: 'PRIVATE-certificate', label: { assetIds: ['PRIVATE-asset'], photo: 'https://PRIVATE-photo' }, provider: { kind: 'known', id: 'psa', link: 'https://PRIVATE-cert-link' }, source: { text: 'PRIVATE-nested-grade' } },
    acquired_at: 'PRIVATE-acquisition', notes: 'PRIVATE-notes', cost: 999, version: 1, legacy_source: { name: 'PRIVATE-source-name', pokemonIds: [143], image: 'https://PRIVATE-image' } }))
  const cards = ['mon', 'trainer', 'energy'].map((kind, i) => ({ id: `synthetic-${kind}`, name_en: ['Synthetic Snorlax', 'Synthetic Trainer', 'Synthetic Energy'][i], series_id: 'synthetic', set_id: 'synthetic', local_id: `${i}`, image_languages_json: ['en'], external_ids_json: { private: { image: 'https://PRIVATE-catalog-source' } } }))
  const tables: Record<string, Record<string, unknown>[]> = {
    binder_shares: [share], resolve_named_binder_share: [share], binders: [binder], storage_collection_state: [state], inventory_owner_state: [{ owner_user_id: owner, inventory_revision: 1 }],
    binder_slots: slots, inventory_placements: placements, inventory_items: items, tcg_cards: options.unknown ? [] : cards,
    tcg_card_dex_ids: [{ card_id: 'synthetic-mon', dex_id: 143 }],
    account_identities: [],
    user_settings: [{ user_id: owner, binder_rows: 4, binder_cols: 4, dark_mode: true, binder_color_id: 'ocean', binder_page_colors: { '1': 'ruby', 'PRIVATE-key': 'PRIVATE-value' }, binder_slot_glare_enabled: false }],
  }
  const calls: { table: string; projection: string; filters: Record<string, unknown> }[] = []
  const counts: Record<string, number> = {}
  function query(table: string) {
    let projection = '*', start = 0, end = Infinity
    const orders: string[] = []
    const filters: Record<string, unknown> = {}
    const q = {
      select(p: string) { projection = p; return q }, eq(k: string, v: unknown) { filters[k] = v; return q },
      in(k: string, v: unknown[]) { filters[k] = v; return q }, contains(k: string, v: unknown) { filters[k] = typeof v === 'string' ? { contains: JSON.parse(v) } : v; return q },
      order(k: string) { orders.push(k); return q }, range(a: number, b: number) { start = a; end = b; return q }, abortSignal() { return q },
      maybeSingle() { return execute(true) }, then(resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) { return execute(false).then(resolve, reject) },
    }
    async function execute(single: boolean) {
      calls.push({ table, projection, filters: { ...filters } })
      counts[table] = (counts[table] ?? 0) + 1
      if (counts[table] > 1) {
        if (table === 'binder_shares' && options.change === 'revoke') share.is_enabled = false
        if (table === 'binder_shares' && options.change === 'identity') share.token = 'replaced-token'
        if (table === 'storage_collection_state' && options.change === 'order') state.layout_revision++
        if (table === 'inventory_owner_state' && options.change === 'copy') tables.inventory_owner_state[0].inventory_revision = 2
        if (table === 'binders' && options.change === 'metadata') binder.binder_cols = 4
      }
      const contains = (actual: unknown, wanted: unknown): boolean => Array.isArray(wanted) ? Array.isArray(actual) && wanted.every(v => actual.includes(v)) : wanted && typeof wanted === 'object' ? !!actual && typeof actual === 'object' && Object.entries(wanted).every(([k, v]) => contains((actual as Record<string, unknown>)[k], v)) : actual === wanted
      const path = (row: Record<string, unknown>, key: string) => key.split('->').reduce<unknown>((o, k) => o && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined, row)
      let values = (tables[table] ?? []).filter(row => Object.entries(filters).every(([key, value]) => Array.isArray(value) ? value.includes(row[key]) : value && typeof value === 'object' && 'contains' in value ? contains(path(row, key), value.contains) : typeof value === 'object' ? contains(row[key], value) : row[key] === value))
      if (orders.length) values = values.toSorted((a, b) => {
        for (const order of orders) {
          const comparison = typeof a[order] === 'number' ? Number(a[order]) - Number(b[order]) : String(a[order]).localeCompare(String(b[order]))
          if (comparison) return comparison
        }
        return 0
      })
      values = values.slice(start, end + 1).map(row => projection === '*' ? row : Object.fromEntries(projection.split(',').map(k => {
        const [alias, path] = k.includes(':') ? k.split(':') : [k, k]
        const [field, child] = path.split('->')
        const value = child && row[field] && typeof row[field] === 'object' ? (row[field] as Record<string, unknown>)[child] : row[field]
        return [alias, value]
      })))
      return { data: structuredClone(single ? values[0] ?? null : values), error: null }
    }
    return q
  }
  return { client: { from: query, rpc: query } as unknown as SupabaseClient, calls, tables }
}
