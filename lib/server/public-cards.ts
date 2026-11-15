import { cacheLife, cacheTag } from 'next/cache';
import { readSetCardPages } from '@/lib/catalog-queries';
import { loadSavedCardPrices } from '@/lib/card-pricing';
import { publicCardPrice } from '@/lib/public-card-price';
import { getPublicSets, hasCatalogDatabase, PUBLIC_CARD_COLUMNS, toPublicSetCard } from '@/lib/server/public-sets';
import { pickLocalizedText } from '@/lib/tcgdex-shared';

async function admin() {
  return (await import('@/lib/supabase/admin')).createAdminClient();
}

const cacheKey = (value: string) => value.replace(/[^a-zA-Z0-9._~-]/g, '_');

/**
 * One English card in a set with a public page, with the extra facts its card page shows, or null. Plain `'use cache'`
 * so it lands in the prerendered HTML; a card sync expires `card-catalog`.
 */
export async function getPublicCard(id: string) {
  'use cache';
  cacheLife('weeks');
  cacheTag('card-catalog', `public-card:${cacheKey(id)}`);
  if (!hasCatalogDatabase()) return null;
  const db = await admin();
  const { data, error } = await db
    .from('tcg_cards')
    .select(`${PUBLIC_CARD_COLUMNS}, category, hp, types_json`)
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  if (!data || !pickLocalizedText(data.name_json, 'en')) return null;
  const set = (await getPublicSets()).find((candidate) => candidate.id === data.set_id);
  if (!set) return null;
  const types = Array.isArray(data.types_json)
    ? data.types_json.filter((type: unknown): type is string => typeof type === 'string')
    : [];
  return {
    card: toPublicSetCard(data),
    set,
    ...(typeof data.category === 'string' && data.category ? { category: data.category } : {}),
    ...(typeof data.hp === 'number' && data.hp > 0 ? { hp: data.hp } : {}),
    types,
  };
}

/** Other English printings of a card's name in sets with public pages, newest set first (up to 24). */
export async function getOtherPrintings(cardId: string, name: string) {
  'use cache';
  cacheLife('weeks');
  cacheTag('card-catalog', `public-card:${cacheKey(cardId)}`);
  const db = await admin();
  const { data, error } = await db
    .from('tcg_cards')
    .select(PUBLIC_CARD_COLUMNS)
    .eq('name_en', name)
    .neq('id', cardId)
    .limit(200);
  if (error) throw error;
  const sets = await getPublicSets();
  const order = new Map(sets.map((set, i) => [set.id, i]));
  return (data ?? [])
    .flatMap((row) => {
      const index = order.get(row.set_id);
      return index === undefined ? [] : [{ card: toPublicSetCard(row), set: sets[index], index }];
    })
    .toSorted((a, b) => a.index - b.index)
    .slice(0, 24)
    .map(({ card, set }) => ({ card, set }));
}

/**
 * The card's saved English price, gated for a public page (see `publicCardPrice`). Saved evidence only, never a
 * provider call, so crawlers can't spend the refresh budget. Re-read daily, as the refresh workflow writes.
 */
export async function getPublicCardPrice(cardId: string) {
  'use cache';
  cacheLife('days');
  cacheTag('public-card-price');
  if (!hasCatalogDatabase()) return null;
  try {
    const [snapshot] = await loadSavedCardPrices([{ cardId, language: 'en' }], { summary: true });
    return publicCardPrice(snapshot);
  } catch {
    return null;
  }
}

/** Every public card's page id, for the sitemap. */
export async function getPublicCardIds() {
  'use cache';
  cacheLife('weeks');
  cacheTag('card-catalog', 'public-card-ids');
  if (!hasCatalogDatabase()) return [];
  const [sets, db] = await Promise.all([getPublicSets(), admin()]);
  // Ten sets per query keeps each `in` list short; readSetCardPages pages past PostgREST's row cap.
  const chunks = Array.from({ length: Math.ceil(sets.length / 10) }, (_, i) =>
    sets.slice(i * 10, i * 10 + 10).map((set) => set.id),
  );
  const pages = await Promise.all(
    chunks.map((setIds) =>
      readSetCardPages((from, to) =>
        db
          .from('tcg_cards')
          .select('id')
          .in('set_id', setIds)
          .not('name_json->en', 'is', null)
          .order('id')
          .range(from, to),
      ),
    ),
  );
  return pages.flat().map((row) => row.id);
}
