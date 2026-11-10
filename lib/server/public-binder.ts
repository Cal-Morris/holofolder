import type { SupabaseClient } from '@supabase/supabase-js'
import type { BinderShareRecord } from '@/lib/binder-share'
import type { PublicBinder, PublicDisplaySlot, PublicShareIdentity } from '@/lib/public-binder'
import { normalizeUsername, normalizeBinderSlug, isMissingIdentitySchema } from '@/lib/public-binder-identity'
import { readStorageAuthority } from '@/lib/legacy-binder-transition'
import { getBinderCompletion, isSlotRevision, normalizeSlotTarget, type BinderSnapshot, type SlotTargetCandidate } from '@/lib/domain/binder-slots'
import { normalizeInventoryIdentity, inventoryItemCandidate, type InventoryItem } from '@/lib/domain/inventory'
import { BINDER_COLOR_PRESETS, DEFAULT_BINDER_COLOR_ID, type BinderColorId } from '@/lib/binder-colors'
import { isBinderGridSize } from '@/lib/binder-layout'
import { normalizeBinderName } from '@/lib/binders/model'
import { POKEMON_CATALOG, getPokemonSummary } from '@/lib/pokemon-catalog'
import { readCatalogMetadata } from '@/lib/card-catalog'
import { mapWithConcurrency } from '@/lib/card-db-sync-concurrency'
import { buildTcgdexAssetImageUrl } from '@/lib/tcgdex-shared'

type Row = Record<string, unknown>
const PAGE = 500
const SHARE = 'owner_user_id,binder_id,token,is_enabled,show_prices'
const BINDER = 'id,owner_user_id,name,binder_rows,binder_cols,updated_at'
const ITEM = 'id,owner_user_id,identity,public_grade:grading->grade,public_provider:grading->provider,private_certificate:grading->certificate,version'
const STATE = 'collection_id,owner_user_id,authority,conversion_version,version,layout_revision'
export class PublicBinderUnavailable extends Error { constructor() { super('Public binder unavailable') } }
const fail = (): never => { throw new PublicBinderUnavailable() }
const object = (v: unknown): Row => v && typeof v === 'object' && !Array.isArray(v) ? v as Row : fail()
const rows = (v: unknown): Row[] => Array.isArray(v) ? v.map(object) : fail()
const id = (v: unknown): string => typeof v === 'string' && v.length > 0 && v.length <= 200 ? v : fail()
const same = (a: unknown, b: unknown) => { if (JSON.stringify(a) !== JSON.stringify(b)) fail() }
const color = (v: unknown): BinderColorId => BINDER_COLOR_PRESETS.find(p => p.id === v)?.id ?? DEFAULT_BINDER_COLOR_ID

/** The only production entry accepts a public identity, never a caller's owner or collection scope.
 * Injected client is a trusted server/test dependency. No persistent cache or hosted mutation. */
export async function loadPublicBinder(identity: PublicShareIdentity, client?: SupabaseClient): Promise<PublicBinder> {
  const db = client ?? (await import('@/lib/supabase/admin')).createAdminClient()
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 15_000)
  let requests = 0
  async function execute<T extends { error: unknown }>(query: PromiseLike<T>): Promise<T> {
    if (++requests > 4096 || controller.signal.aborted) return fail()
    const result = await query
    if (controller.signal.aborted) return fail()
    return result
  }
  async function run<T extends { error: unknown }>(query: PromiseLike<T>): Promise<T> {
    const result = await execute(query)
    if (result.error) return fail()
    return result
  }
  async function permission(): Promise<BinderShareRecord> {
    if ('token' in identity) {
      if (!/^[a-zA-Z0-9_-]{1,200}$/.test(identity.token)) return fail()
      const result = await run(db.from('binder_shares').select(SHARE).eq('token', identity.token).eq('is_enabled', true).abortSignal(controller.signal).maybeSingle())
      const share = result.data as BinderShareRecord | null
      if (!share?.is_enabled || share.token !== identity.token || !share.owner_user_id) return fail()
      return share
    }
    if (normalizeUsername(identity.username) !== identity.username || normalizeBinderSlug(identity.binderSlug) !== identity.binderSlug) return fail()
    const result = await run(db.rpc('resolve_named_binder_share', { requested_username: identity.username, requested_slug: identity.binderSlug }).abortSignal(controller.signal).maybeSingle())
    const share = result.data as BinderShareRecord | null
    if (!share?.is_enabled || !share.binder_id || !share.owner_user_id || !share.token) return fail()
    // RPC can grow independently. Retain only the permission fields in the server fence.
    return { owner_user_id: share.owner_user_id, binder_id: share.binder_id, token: share.token, is_enabled: share.is_enabled, show_prices: share.show_prices }
  }
  try {
    const share = await permission(), owner = id(share.owner_user_id)
    // Historical binderless tokens resolve only the current default, never list other binders.
    async function binder() {
      let query = db.from('binders').select(BINDER).eq('owner_user_id', owner)
      query = share.binder_id ? query.eq('id', share.binder_id) : query.eq('is_default', true)
      const result = await run(query.abortSignal(controller.signal).maybeSingle())
      const value = object(result.data)
      if (value.owner_user_id !== owner || share.binder_id && value.id !== share.binder_id) return fail()
      return value
    }
    const initialBinder = await binder(), collection = id(initialBinder.id)
    const scoped = (table: string, projection: string) => db.from(table).select(projection).eq('owner_user_id', owner).eq('collection_id', collection).abortSignal(controller.signal)
    async function state() {
      const result = await execute(scoped('storage_collection_state', STATE).maybeSingle())
      // Only an absent pre-rollout schema may use legacy compatibility.
      const authority = readStorageAuthority(result.data, result.error)
      if (result.error) return { authority, row: null }
      if (result.data && (object(result.data).owner_user_id !== owner || object(result.data).collection_id !== collection)) return fail()
      return { authority, row: result.data as Row | null }
    }
    async function revision() {
      const result = await run(db.from('inventory_owner_state').select('inventory_revision').eq('owner_user_id', owner).abortSignal(controller.signal).maybeSingle())
      if (!isSlotRevision(result.data?.inventory_revision)) return fail()
      return result.data.inventory_revision as number
    }
    async function paged(table: string, projection: string, key: string, legacy = false) {
      const result: Row[] = []
      for (let offset = 0; ; offset += PAGE) {
        const query = legacy
          ? db.from(table).select(projection).eq('user_id', owner).eq('binder_id', collection).abortSignal(controller.signal)
          : scoped(table, projection)
        const page = rows((await run(query.order(key, { ascending: true }).range(offset, offset + PAGE - 1))).data)
        if (page.length > PAGE) return fail()
        result.push(...page)
        if (page.length < PAGE) return result
      }
    }
    const initialState = await state()
    const native = initialState.authority === 'slots'
    const rev = native ? await revision() : null
    const settings = await run(db.from('user_settings').select('binder_rows,binder_cols,binder_color_id,binder_page_colors,binder_slot_glare_enabled,dark_mode').eq('user_id', owner).abortSignal(controller.signal).maybeSingle())
    const appearanceRow: Row = settings.data ? object(settings.data) : {}
    const pageColors: Record<string, BinderColorId> = {}
    if (appearanceRow.binder_page_colors && typeof appearanceRow.binder_page_colors === 'object') {
      for (const [page, value] of Object.entries(appearanceRow.binder_page_colors)) if (/^[1-9]\d{0,6}$/.test(page)) pageColors[page] = color(value)
    }
    // NULL binder geometry inherits the owner's settings (039). Native never invents a default beyond that.
    const grid = (value: unknown, fallback: unknown) => isBinderGridSize(value) ? value : isBinderGridSize(fallback) ? fallback : native ? fail() : 4
    async function username() {
      const result = await execute(db.from('account_identities').select('username').eq('user_id', owner).abortSignal(controller.signal).maybeSingle())
      if (result.error && !isMissingIdentitySchema(result.error)) return fail()
      return normalizeUsername(result.data?.username)
    }
    const publicUsername = await username()
    const base = { ...(publicUsername ? { username: publicUsername } : {}), name: normalizeBinderName(initialBinder.name) ?? 'Pokémon binder',
      rows: grid(initialBinder.binder_rows, appearanceRow.binder_rows), cols: grid(initialBinder.binder_cols, appearanceRow.binder_cols),
      appearance: { dark: appearanceRow.dark_mode !== false, color: color(appearanceRow.binder_color_id), pageColors, glare: appearanceRow.binder_slot_glare_enabled !== false } }
    const grades = new Map<string, string>()
    const providers = new Map<string, string>()
    const catalogRows = new Map<string, Row>()
    const catalogLinks = new Map<string, number[]>()
    const priceLookups = new Map<number, { cardId: string; language: string }>()
    const catalog = new Map<string, { name: string; image?: string; candidate: Extract<SlotTargetCandidate, { kind: 'card' }> }>()
    async function preloadCatalog(ids: string[]) {
      const unique = [...new Set(ids)]
      const projection = 'id,name_en,series_id,set_id,local_id,image_languages_json,external_ids_json'
      for (let offset = 0; offset < unique.length; offset += 100) {
        const batch = unique.slice(offset, offset + 100)
        const direct = rows((await run(db.from('tcg_cards').select(projection).in('id', batch).abortSignal(controller.signal))).data)
        for (const row of direct) {
          const key = id(row.id)
          if (!batch.includes(key) || catalogRows.has(key)) return fail()
          catalogRows.set(key, row)
        }
      }
      // Missing IDs may be recorded catalog aliases. Bound their concurrency and never fuzzy-match.
      await mapWithConcurrency(unique.filter(key => !catalogRows.has(key)), 12, async key => {
        const result = await run(db.from('tcg_cards').select(projection).contains('external_ids_json', { catalog: { aliasIds: [key] } }).abortSignal(controller.signal).maybeSingle())
        if (result.data) catalogRows.set(key, object(result.data))
      })
      const canonical = [...new Set([...catalogRows.values()].map(row => id(row.id)))]
      for (let offset = 0; offset < canonical.length; offset += 100) {
        const batch = canonical.slice(offset, offset + 100)
        for (let start = 0; ; start += PAGE) {
          const page = rows((await run(db.from('tcg_card_dex_ids').select('card_id,dex_id').in('card_id', batch)
            .order('card_id').order('dex_id').range(start, start + PAGE - 1).abortSignal(controller.signal))).data)
          for (const link of page) {
            const key = id(link.card_id)
            if (!batch.includes(key) || typeof link.dex_id !== 'number' || !Number.isSafeInteger(link.dex_id) || link.dex_id <= 0) return fail()
            const links = catalogLinks.get(key) ?? []
            if (links.includes(link.dex_id)) return fail()
            links.push(link.dex_id)
            catalogLinks.set(key, links)
          }
          if (page.length < PAGE) break
        }
      }
    }
    function card(cardId: string, language: string = 'en') {
      const cacheKey = JSON.stringify([cardId, language])
      if (catalog.has(cacheKey)) return catalog.get(cacheKey)!
      const row = catalogRows.get(cardId)
      if (!row) return undefined
      const canonical = id(row.id), metadata = readCatalogMetadata(row.external_ids_json)
      const pokemonIds = catalogLinks.get(canonical) ?? []
      const languages = Array.isArray(row.image_languages_json) ? row.image_languages_json : []
      const lang = /^[a-z]{2}(?:-[a-z]{2})?$/.test(language) && languages.includes(language) ? language : undefined
      const segment = (v: unknown): v is string => typeof v === 'string' && /^[a-zA-Z0-9._-]{1,64}$/.test(v) && !v.includes('..')
      const image = lang && segment(row.series_id) && segment(row.set_id) && segment(row.local_id)
        ? buildTcgdexAssetImageUrl(String(lang), row.series_id, row.set_id, row.local_id, 'high', 'webp') : undefined
      const value = { name: typeof row.name_en === 'string' && row.name_en.trim() ? row.name_en : 'Unknown card', ...(image ? { image } : {}),
        candidate: { kind: 'card' as const, id: canonical, ...(metadata.canonicalId ? { canonicalId: metadata.canonicalId } : {}), ...(metadata.aliasIds ? { aliasIds: metadata.aliasIds } : {}), pokemonIds } }
      catalog.set(cacheKey, value)
      return value
    }
    let slots: PublicDisplaySlot[], completion: PublicBinder['completion']
    if (native) {
      if (!isSlotRevision(initialState.row?.version) || !isSlotRevision(initialState.row?.layout_revision)) return fail()
      const stored = await paged('binder_slots', 'id,owner_user_id,collection_id,position,target,status,version', 'position')
      const placements = await paged('inventory_placements', 'inventory_item_id,owner_user_id,collection_id,slot_id,version', 'slot_id')
      if (new Set(stored.map(s => s.id)).size !== stored.length || new Set(placements.map(p => p.slot_id)).size !== placements.length
        || new Set(placements.map(p => p.inventory_item_id)).size !== placements.length) return fail()
      if (stored.some((s, i) => s.owner_user_id !== owner || s.collection_id !== collection || !isSlotRevision(s.position) || !isSlotRevision(s.version) || i > 0 && Number(s.position) <= Number(stored[i - 1].position))) return fail()
      if (placements.some(p => p.owner_user_id !== owner || p.collection_id !== collection || !isSlotRevision(p.version) || !stored.some(s => s.id === p.slot_id))) return fail()
      const items = new Map<string, InventoryItem>()
      const itemPages: Row[][] = []
      for (let offset = 0; offset < placements.length; offset += 100) {
        const ids = placements.slice(offset, offset + 100).map(p => id(p.inventory_item_id))
        const result = rows((await run(db.from('inventory_items').select(ITEM).eq('owner_user_id', owner).in('id', ids).abortSignal(controller.signal))).data)
        itemPages.push(result)
        if (result.length !== ids.length) return fail()
        for (const row of result) {
          const identity = normalizeInventoryIdentity(row.identity)
          if (!identity || row.owner_user_id !== owner || !ids.includes(id(row.id)) || items.has(String(row.id)) || !isSlotRevision(row.version)) return fail()
          // Internal matching needs only identity, never legacy/source JSON or acquisition fields.
          items.set(String(row.id), { id: String(row.id), ownerUserId: owner, identity, version: Number(row.version), grading: null, acquiredAt: null })
        }
        // Grade projection never retains certificates, label/slab images, links or asset IDs.
        for (const row of result) {
          const grade = row.public_grade
          const certificate = typeof row.private_certificate === 'string' ? row.private_certificate : null
          const provider = row.public_provider && typeof row.public_provider === 'object' ? row.public_provider as Row : null
          const providerName = provider?.kind === 'known' && ['psa', 'ace', 'cgc', 'beckett'].includes(String(provider.id)) ? String(provider.id).toUpperCase() : provider?.kind === 'custom' ? provider.name : null
          if (typeof providerName === 'string' && providerName.length <= 500 && !/https?:|www\.|[<>]/i.test(providerName) && (!certificate || !providerName.includes(certificate))) providers.set(String(row.id), providerName)
          if (typeof grade === 'string' && grade.length <= 500 && !/https?:|www\.|[<>]/i.test(grade) && (!certificate || !grade.includes(certificate))) grades.set(String(row.id), grade)
        }
      }
      await preloadCatalog([...items.values()].flatMap(item => item.identity.kind === 'card' ? [item.identity.cardId] : []).concat(stored.flatMap(s => {
        const target = normalizeSlotTarget(s.target)
        return target?.kind === 'card' ? [target.cardId] : []
      })))
      const snapshot: BinderSnapshot = { ownerUserId: owner, collectionId: collection, layoutRevision: Number(initialState.row!.layout_revision), presetManifest: null, slots: [] }
      slots = []
      for (const [index, row] of stored.entries()) {
        const target = normalizeSlotTarget(row.target)
        if (target === undefined) return fail()
        const placement = placements.find(p => p.slot_id === row.id)
        if (!!placement !== (row.status === 'collected' || row.status === 'finalized')) return fail()
        const item = placement ? items.get(String(placement.inventory_item_id))! : null
        const identity = item?.identity ?? target
        const found = identity?.kind === 'card' ? card(identity.cardId, identity.language ?? 'en') : null
        const pokemon = identity?.kind === 'pokemon' ? getPokemonSummary(identity.pokemonId) : null
        snapshot.slots.push({ id: id(row.id), ownerUserId: owner, collectionId: collection, target, inventoryItemId: item?.id ?? null, wantedCards: [], status: placement ? 'collected' : null, version: Number(row.version), presetOrigin: null })
        slots.push({ id: `public-${index}`, target: target?.kind === 'card' ? { kind: 'card', ...(target.language ? { language: target.language } : {}), ...(target.finish ? { finish: target.finish } : {}) } : target, item: item ? { grading: grades.has(item.id) ? { grade: grades.get(item.id)! } : null } : null,
          card: identity?.kind === 'card' ? { name: found?.name ?? 'Unknown card', ...(found?.image ? { image: found.image } : {}) } : null,
          pokemon: pokemon ? { id: pokemon.id, name: pokemon.name } : null, ...(item && providers.has(item.id) ? { recordedProvider: providers.get(item.id)! } : {}) })
        if (item?.identity.kind === 'card') priceLookups.set(index, { cardId: item.identity.cardId, language: item.identity.language ?? 'en' })
      }
      const goal = getBinderCompletion(snapshot, key => { const item = items.get(key); return item ? inventoryItemCandidate(item, key => card(key)?.candidate) : undefined })
      completion = { targetCount: goal.targetCount, completedTargetCount: goal.completedTargetCount }
      same(stored, await paged('binder_slots', 'id,owner_user_id,collection_id,position,target,status,version', 'position'))
      same(placements, await paged('inventory_placements', 'inventory_item_id,owner_user_id,collection_id,slot_id,version', 'slot_id'))
      for (const page of itemPages) {
        const final = rows((await run(db.from('inventory_items').select(ITEM).eq('owner_user_id', owner).in('id', page.map(r => String(r.id))).abortSignal(controller.signal))).data)
        const sorted = (values: Row[]) => values.toSorted((a, b) => String(a.id).localeCompare(String(b.id)))
        same(sorted(page), sorted(final))
      }
      same(rev, await revision())
    } else {
      // Legacy National Dex is its actual layout contract, never a native default or conversion.
      const stored = await paged('pokemon_collection', 'pokemon_id,status,card_id,card_language', 'pokemon_id', true)
      await preloadCatalog(stored.flatMap(row => typeof row.card_id === 'string' ? [row.card_id] : []))
      slots = []
      for (const [index, pokemon] of POKEMON_CATALOG.entries()) {
        const item = stored.find(r => r.pokemon_id === pokemon.id)
        const owned = item?.status === 'collected' || item?.status === 'finalized'
        const found = owned && typeof item?.card_id === 'string' ? card(item.card_id, typeof item.card_language === 'string' ? item.card_language : 'en') : null
        if (owned && typeof item?.card_id === 'string') priceLookups.set(index, { cardId: item.card_id, language: typeof item.card_language === 'string' ? item.card_language : 'en' })
        slots.push({ id: `public-${index}`, target: { kind: 'pokemon', pokemonId: pokemon.id }, item: owned ? { grading: null } : null,
          card: found ? { name: found.name, ...(found.image ? { image: found.image } : {}) } : null, pokemon: { id: pokemon.id, name: pokemon.name } })
      }
      completion = { targetCount: slots.length, completedTargetCount: slots.filter(s => s.item).length }
      same(stored, await paged('pokemon_collection', 'pokemon_id,status,card_id,card_language', 'pokemon_id', true))
    }
    if (share.show_prices === true) {
      const savedPrices = new Map<string, number | null>()
      const unique = new Map([...priceLookups.values()].map(lookup => [JSON.stringify(lookup), lookup]))
      await mapWithConcurrency([...unique], 12, async ([key, lookup]) => {
        const result = await run(db.from('card_prices').select('gbp_amount').eq('card_id', lookup.cardId).eq('language', lookup.language).abortSignal(controller.signal).maybeSingle())
        const amount = Number(result.data?.gbp_amount)
        savedPrices.set(key, Number.isFinite(amount) && amount > 0 ? amount : null)
      })
      for (const [index, lookup] of priceLookups) {
        const key = JSON.stringify(lookup)
        const amount = savedPrices.get(key)
        if (amount != null) slots[index].marketGBP = amount
      }
    }
    same(initialBinder, await binder())
    same(initialState, await state())
    same(appearanceRow, (await run(db.from('user_settings').select('binder_rows,binder_cols,binder_color_id,binder_page_colors,binder_slot_glare_enabled,dark_mode').eq('user_id', owner).abortSignal(controller.signal).maybeSingle())).data ?? {})
    same(publicUsername, await username())
    if (native) same(rev, await revision())
    same(share, await permission())
    return { kind: native ? 'native' : 'legacy', ...base, completion, slots }
  } catch { return fail() } finally { clearTimeout(timer); controller.abort() }
}
