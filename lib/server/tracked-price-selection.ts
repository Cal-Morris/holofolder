import type { SupabaseClient } from '@supabase/supabase-js';
import { isSlotContractId, isSlotRevision } from '@/lib/domain/binder-slots';
import { normalizeInventoryIdentity } from '@/lib/domain/inventory';
import { trackedPriceIdentity, trackedPriceRequests, type TrackedPriceIdentity } from '@/lib/tracked-price-identity';

type Row = Record<string, unknown>;
const PAGE = 500;
const MAX_REQUESTS = 512;
const MAX_BYTES = 32 * 1024 * 1024;
const TIMEOUT_MS = 30_000;
const unavailable = (): never => {
  throw new Error('Tracked price selection unavailable or incomplete');
};
const record = (v: unknown): v is Row => !!v && typeof v === 'object' && !Array.isArray(v);

/** Trusted workflow/admin boundary, not a browser read or a native-route admission gate. */
export async function selectTrackedPriceLookups(db: SupabaseClient, ownerUserId: string | null) {
  if (ownerUserId !== null && !isSlotContractId(ownerUserId)) return unavailable();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let requests = 0,
    bytes = 0;
  try {
    async function read(table: string, projection: string, key: string): Promise<Row[]> {
      const ownerKey = 'owner_user_id';
      const output: Row[] = [],
        seen = new Set<unknown>();
      const fields = projection.split(',');
      let total: number | undefined;
      do {
        if (++requests > MAX_REQUESTS || controller.signal.aborted) return unavailable();
        let query = db
          .from(table)
          .select(projection, { count: 'exact' })
          .order(key, { ascending: true })
          .range(output.length, output.length + PAGE - 1);
        if (ownerUserId !== null) query = query.eq(ownerKey, ownerUserId);
        const result = await query.abortSignal(controller.signal);
        if (result.error) return unavailable();
        if (!Array.isArray(result.data) || !isSlotRevision(result.count)) return unavailable();
        total ??= result.count;
        if (result.count !== total || result.data.length !== Math.min(PAGE, total - output.length))
          return unavailable();
        bytes += Buffer.byteLength(JSON.stringify(result.data));
        if (bytes > MAX_BYTES) return unavailable();
        for (const row of result.data) {
          if (
            !record(row) ||
            fields.some((field) => !Object.hasOwn(row, field) || row[field] === undefined) ||
            !isSlotContractId(row[key]) ||
            seen.has(row[key]) ||
            !isSlotContractId(row[ownerKey]) ||
            (ownerUserId !== null && row[ownerKey] !== ownerUserId)
          )
            return unavailable();
          seen.add(row[key]);
          output.push(row);
        }
      } while (output.length < total);
      return output;
    }
    async function metadata() {
      const roots = await read('inventory_owner_state', 'owner_user_id,inventory_revision', 'owner_user_id');
      const states = await read(
        'storage_collection_state',
        'collection_id,owner_user_id,version,layout_revision',
        'collection_id',
      );
      const binders = await read('binders', 'id,owner_user_id', 'id');
      if (roots.some((r) => !isSlotRevision(r.inventory_revision))) return unavailable();
      const bindersById = new Map(binders.map((b) => [b.id, b]));
      const owners = new Set(roots.map((r) => r.owner_user_id));
      for (const state of states) {
        if (
          bindersById.get(state.collection_id)?.owner_user_id !== state.owner_user_id ||
          !owners.has(state.owner_user_id) ||
          !isSlotRevision(state.version) ||
          !isSlotRevision(state.layout_revision)
        )
          return unavailable();
      }
      return { roots, states, binders };
    }
    const initial = await metadata();
    const states = new Map(initial.states.map((s) => [s.collection_id, s]));
    const rootOwners = new Set(initial.roots.map((r) => r.owner_user_id));
    const identities: TrackedPriceIdentity[] = [];
    function add(cardId: unknown, language: unknown, finish: unknown) {
      const identity = trackedPriceIdentity(cardId, language, finish);
      if (identity) identities.push(identity);
    }
    for (const row of await read('inventory_items', 'id,owner_user_id,identity', 'id')) {
      if (!rootOwners.has(row.owner_user_id)) return unavailable();
      const identity = normalizeInventoryIdentity(row.identity);
      if (!identity) return unavailable();
      if (identity.kind === 'card') add(identity.cardId, identity.language, identity.finish);
    }
    for (const row of await read('binder_slots', 'id,owner_user_id,collection_id,wanted_cards', 'id')) {
      if (states.get(row.collection_id)?.owner_user_id !== row.owner_user_id || !Array.isArray(row.wanted_cards))
        return unavailable();
      for (const want of row.wanted_cards) {
        if (
          !record(want) ||
          !isSlotContractId(want.card_id) ||
          !normalizeInventoryIdentity({
            kind: 'card',
            cardId: want.card_id,
            ...('card_language' in want ? { language: want.card_language } : {}),
            ...('card_finish' in want ? { finish: want.card_finish } : {}),
          })
        )
          return unavailable();
        add(want.card_id, want.card_language, want.card_finish);
      }
    }
    if (JSON.stringify(await metadata()) !== JSON.stringify(initial)) return unavailable();
    return trackedPriceRequests(identities);
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}
