import type { SupabaseClient } from '@supabase/supabase-js';
import { isCardLanguage } from '@/lib/domain/cards';
import { isSlotContractId } from '@/lib/domain/binder-slots';
import type { InventoryCatalogEvidence } from '@/lib/domain/inventory-browse';
import { readCatalogMetadata } from '@/lib/card-catalog';
import { formatPokemonDisplayName, getPokemonById } from '@/lib/pokemon-catalog';
import { buildTcgdexAssetImageUrl, pickImageLanguage } from '@/lib/tcgdex-shared';
import { pickCardImageUrl } from '@/lib/card-image-sources';

type Row = Record<string, unknown>;
/** Public mirror rows for the cards a snapshot names, their dex links and sets (inventory_snapshot_v2's catalog). */
export interface InventoryCatalogRows {
  cards: Row[];
  dex: Row[];
  sets: Row[];
}

export function buildInventoryCatalog({ cards, dex, sets }: InventoryCatalogRows): InventoryCatalogEvidence[] {
  const setsById = new Map(sets.map((s) => [s.id, s]));
  const dexByCard = new Map<unknown, number[]>();
  for (const l of dex) {
    if (typeof l.dex_id !== 'number' || !Number.isSafeInteger(l.dex_id) || l.dex_id <= 0) continue;
    dexByCard.set(l.card_id, [...(dexByCard.get(l.card_id) ?? []), l.dex_id]);
  }
  const result: InventoryCatalogEvidence[] = [];
  for (const raw of cards) {
    const set = setsById.get(raw.set_id);
    if (
      !isSlotContractId(raw.id) ||
      !isSlotContractId(raw.local_id) ||
      !set ||
      !isSlotContractId(set.id) ||
      typeof set.name_en !== 'string' ||
      !set.name_en.trim() ||
      typeof raw.name_en !== 'string' ||
      !raw.name_en.trim()
    )
      continue;
    const metadata = readCatalogMetadata(raw.external_ids_json);
    const pokemonIds = Array.from(new Set(dexByCard.get(raw.id) ?? [])).sort((a, b) => a - b);
    const names = [
      ...new Set(
        (dexByCard.get(raw.id) ?? []).flatMap((id) => {
          const pokemon = getPokemonById(id);
          return pokemon ? [formatPokemonDisplayName(pokemon.name)] : [];
        }),
      ),
    ];
    const imageForLanguage = (language: string) => {
      const imageLanguage = pickImageLanguage(raw.image_languages_json, language);
      const tcgdexImage =
        imageLanguage && isSlotContractId(raw.series_id)
          ? buildTcgdexAssetImageUrl(imageLanguage, raw.series_id, String(set.id), String(raw.local_id))
          : null;
      return (
        pickCardImageUrl(raw.external_ids_json, tcgdexImage ? imageLanguage : null, tcgdexImage, language) ?? undefined
      );
    };
    const translations =
      raw.name_json && typeof raw.name_json === 'object' ? (raw.name_json as Record<string, unknown>) : {};
    // Only attested languages, never infer a printing's language from the owner's preference.
    const languages = Object.keys(translations).filter(
      (l) => typeof translations[l] === 'string' && String(translations[l]).trim(),
    );
    for (const language of languages.filter(isCardLanguage))
      result.push({
        card: {
          id: raw.id,
          localId: metadata.localId ?? raw.local_id,
          name: String(translations[language]),
          language,
          set: { id: set.id, name: set.name_en },
          ...(metadata.canonicalId ? { canonicalId: metadata.canonicalId } : {}),
          ...(metadata.aliasIds ? { aliasIds: metadata.aliasIds } : {}),
          image: imageForLanguage(language),
        },
        speciesNames: names,
        pokemonIds,
      });
    if (!languages.length)
      result.push({
        card: {
          id: raw.id,
          localId: metadata.localId ?? raw.local_id,
          name: raw.name_en,
          set: { id: set.id, name: set.name_en },
          image: imageForLanguage('en'),
          ...(metadata.canonicalId ? { canonicalId: metadata.canonicalId } : {}),
          ...(metadata.aliasIds ? { aliasIds: metadata.aliasIds } : {}),
        },
        speciesNames: names,
        pokemonIds,
      });
  }
  return result;
}

const isRow = (value: unknown): value is Row => !!value && typeof value === 'object' && !Array.isArray(value);
const list = (value: unknown) => (Array.isArray(value) ? value.filter(isRow) : []);
const text = (a: unknown, b: unknown) => (String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0);

/** inventory_snapshot_v2's `card_ids`: copies' card ids, slot targets and every slot want, read from a raw snapshot. */
export function inventoryCatalogCardIds(snapshot: Row): string[] {
  const ids = new Set<string>();
  const add = (row: unknown, key: string) => {
    if (isRow(row) && typeof row[key] === 'string') ids.add(row[key]);
  };
  for (const item of list(snapshot.items))
    if (isRow(item.identity) && item.identity.kind === 'card') add(item.identity, 'cardId');
  for (const collection of list(snapshot.collections))
    for (const slot of list(collection.slots)) {
      if (isRow(slot.target) && slot.target.kind === 'card') add(slot.target, 'cardId');
      for (const want of list(slot.wanted_cards)) add(want, 'card_id');
    }
  return [...ids];
}

/** Several ids' rows as one catalog, each card, dex link and set once, in the snapshot's order. */
export function mergeCatalogRows(parts: readonly InventoryCatalogRows[]): InventoryCatalogRows {
  const unique = (rows: Row[], key: (r: Row) => string) => [...new Map(rows.map((r) => [key(r), r])).values()];
  return {
    cards: unique(
      parts.flatMap((p) => p.cards),
      (c) => String(c.id),
    ).sort((a, b) => text(a.id, b.id)),
    dex: unique(
      parts.flatMap((p) => p.dex),
      (d) => `${d.card_id}\u0000${d.dex_id}`,
    ).sort((a, b) => text(a.card_id, b.card_id) || Number(a.dex_id) - Number(b.dex_id)),
    sets: unique(
      parts.flatMap((p) => p.sets),
      (s) => String(s.id),
    ).sort((a, b) => text(a.id, b.id)),
  };
}

const CARD_COLUMNS = 'id,series_id,set_id,local_id,name_en,name_json,image_languages_json,external_ids_json';
const CANONICAL_ID = 'external_ids_json->catalog->>canonicalId';
// In-list chunk: keeps the URL short and every chunk under PostgREST's 1000-row cap (a card has a few dex links).
const CHUNK = 200;
const chunks = (ids: readonly string[]) =>
  Array.from({ length: Math.ceil(ids.length / CHUNK) }, (_, i) => ids.slice(i * CHUNK, (i + 1) * CHUNK));

/** Each id's catalog rows, with inventory_snapshot_v2's semantics: the tcg_cards row with that id, else every row whose
 * catalog canonicalId is it or whose aliasIds hold it. Unknown ids get no rows. */
export async function readCatalogCardRows(
  client: SupabaseClient,
  ids: readonly string[],
): Promise<Map<string, InventoryCatalogRows>> {
  const read = async (query: PromiseLike<{ data: unknown; error: unknown }>) => {
    const { data, error } = await query;
    if (error) throw error;
    return list(data);
  };
  const inList = (table: string, columns: string, key: string, values: readonly string[]) =>
    Promise.all(
      chunks(values).map((chunk) =>
        read(
          client
            .from(table)
            .select(columns)
            .in(key, [...chunk]),
        ),
      ),
    ).then((r) => r.flat());
  const direct = await inList('tcg_cards', CARD_COLUMNS, 'id', ids);
  const directIds = new Set(direct.map((c) => c.id));
  const misses = ids.filter((id) => !directIds.has(id));
  const fallback = misses.length
    ? [
        ...(await inList('tcg_cards', CARD_COLUMNS, CANONICAL_ID, misses)),
        ...(
          await Promise.all(
            misses.map((id) =>
              read(
                client
                  .from('tcg_cards')
                  .select(CARD_COLUMNS)
                  .contains('external_ids_json->catalog->aliasIds', JSON.stringify([id])),
              ),
            ),
          )
        ).flat(),
      ]
    : [];
  const cards = mergeCatalogRows([{ cards: [...direct, ...fallback], dex: [], sets: [] }]).cards;
  const cardIds = cards.map((c) => String(c.id));
  const setIds = [...new Set(cards.map((c) => String(c.set_id)))];
  const [dex, sets] = await Promise.all([
    inList('tcg_card_dex_ids', 'card_id,dex_id', 'card_id', cardIds),
    inList('tcg_sets', 'id,name_en', 'id', setIds),
  ]);
  // The raw JSON, as the database matched it: readCatalogMetadata normalizes.
  const catalogOf = (c: Row) =>
    isRow(c.external_ids_json) && isRow(c.external_ids_json.catalog) ? c.external_ids_json.catalog : {};
  return new Map(
    ids.map((id) => {
      const own = directIds.has(id)
        ? direct.filter((c) => c.id === id)
        : cards.filter((c) => {
            const { canonicalId, aliasIds } = catalogOf(c);
            return canonicalId === id || (Array.isArray(aliasIds) && aliasIds.includes(id));
          });
      const ownIds = new Set(own.map((c) => c.id));
      const ownSets = new Set(own.map((c) => c.set_id));
      return [
        id,
        mergeCatalogRows([
          { cards: own, dex: dex.filter((d) => ownIds.has(d.card_id)), sets: sets.filter((s) => ownSets.has(s.id)) },
        ]),
      ];
    }),
  );
}

/** One id at a time, read together: calls made within `waitMs` share one readCatalogCardRows. */
export function batchCatalogCardReads(client: SupabaseClient, waitMs = 10) {
  let pending: Map<string, PromiseWithResolvers<InventoryCatalogRows>> | null = null;
  return (id: string) => {
    if (!pending) {
      const batch = (pending = new Map());
      setTimeout(() => {
        pending = null;
        readCatalogCardRows(client, [...batch.keys()]).then(
          (rows) => batch.forEach((wait, key) => wait.resolve(rows.get(key)!)),
          (error) => batch.forEach((wait) => wait.reject(error)),
        );
      }, waitMs);
    }
    let wait = pending.get(id);
    if (!wait) pending.set(id, (wait = Promise.withResolvers<InventoryCatalogRows>()));
    return wait.promise;
  };
}
