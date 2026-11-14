import type { SupabaseClient } from '@supabase/supabase-js';
import { isSlotContractId, isSlotRevision } from '@/lib/domain/binder-slots';
import { normalizeInventoryIdentity } from '@/lib/domain/inventory';
import { trackedPriceIdentity, trackedPriceRequests, type TrackedPriceIdentity } from '@/lib/tracked-price-identity';

type Row = Record<string, unknown>;
const PAGE = 500;
const MAX_REQUESTS = 512;
const MAX_BYTES = 32 * 1024 * 1024;
const TIMEOUT_MS = 30_000;
// PostgREST (and Postgres) when migration 128 is not applied yet.
const MISSING_FUNCTION = new Set(['PGRST202', '42883']);
const unavailable = (): never => {
  throw new Error('Tracked price selection unavailable or incomplete');
};
const record = (v: unknown): v is Row => !!v && typeof v === 'object' && !Array.isArray(v);

/**
 * Trusted workflow/admin boundary, not a browser read or a native-route admission gate.
 *
 * Reads only what decides the price set: card identities of inventory copies, and the distinct
 * (card, language, finish) of wants. Ownership between items, slots, binders and owner roots is
 * enforced by foreign keys, and the result is a refresh list, so no cross-table snapshot is taken.
 */
export async function selectTrackedPriceLookups(db: SupabaseClient, ownerUserId: string | null) {
  if (ownerUserId !== null && !isSlotContractId(ownerUserId)) return unavailable();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let requests = 0,
    bytes = 0;
  const budget = (data: unknown) => {
    bytes += Buffer.byteLength(JSON.stringify(data));
    if (bytes > MAX_BYTES) unavailable();
  };
  try {
    async function read(table: string, projection: string, key: string): Promise<Row[]> {
      const ownerKey = 'owner_user_id';
      const output: Row[] = [],
        seen = new Set<unknown>();
      const fields = projection.split(',');
      let total: number | undefined;
      do {
        if (++requests > MAX_REQUESTS || controller.signal.aborted) return unavailable();
        // Count once; later pages must still add up to it.
        let query = db
          .from(table)
          .select(projection, total === undefined ? { count: 'exact' } : undefined)
          .order(key, { ascending: true })
          .range(output.length, output.length + PAGE - 1);
        if (ownerUserId !== null) query = query.eq(ownerKey, ownerUserId);
        const result = await query.abortSignal(controller.signal);
        if (result.error || !Array.isArray(result.data)) return unavailable();
        if (total === undefined) {
          if (!isSlotRevision(result.count)) return unavailable();
          total = result.count;
        }
        if (result.data.length !== Math.min(PAGE, total - output.length)) return unavailable();
        budget(result.data);
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
    async function wants(): Promise<unknown[]> {
      if (++requests > MAX_REQUESTS) return unavailable();
      const result = await db
        .rpc('tracked_price_want_identities_v1', { p_owner: ownerUserId })
        .abortSignal(controller.signal);
      if (!result.error) {
        if (!Array.isArray(result.data)) return unavailable();
        budget(result.data);
        return result.data;
      }
      if (!MISSING_FUNCTION.has(result.error.code)) return unavailable();
      // Whole-row fallback until 128 is applied. Delete it once it is.
      return (await read('binder_slots', 'id,owner_user_id,wanted_cards', 'id')).flatMap((row) =>
        Array.isArray(row.wanted_cards) ? row.wanted_cards : unavailable(),
      );
    }
    const identities: TrackedPriceIdentity[] = [];
    function add(cardId: unknown, language: unknown, finish: unknown) {
      const identity = trackedPriceIdentity(cardId, language, finish);
      if (identity) identities.push(identity);
    }
    for (const row of await read('inventory_items', 'id,owner_user_id,identity', 'id')) {
      const identity = normalizeInventoryIdentity(row.identity);
      if (!identity) return unavailable();
      if (identity.kind === 'card') add(identity.cardId, identity.language, identity.finish);
    }
    for (const want of await wants()) {
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
    return trackedPriceRequests(identities);
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}
