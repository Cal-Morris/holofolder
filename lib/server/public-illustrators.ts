import { cacheLife, cacheTag } from 'next/cache';
import { getCardsByIllustrator, getIllustratorDirectory } from '@/lib/catalog-queries';
import { groupIllustratorsBySlug, type IllustratorCard, type PublicIllustrator } from '@/lib/illustrators';
import { getPublicSets, hasCatalogDatabase } from '@/lib/server/public-sets';

const isMissingFunction = (error: { code?: string; message?: string }) =>
  error.code === 'PGRST202' || error.code === '42883' || /could not find the function/i.test(error.message ?? '');

/**
 * Every illustrator with a public page, A to Z, with English card counts from `public_illustrator_directory()`
 * (migration 137). Until that is applied, names come from the all-language directory without counts. Plain
 * `'use cache'` so the list lands in the HTML; a card sync expires the `card-catalog` tag.
 */
export async function getPublicIllustrators(): Promise<PublicIllustrator[]> {
  'use cache';
  cacheLife('weeks');
  cacheTag('card-catalog', 'public-illustrators');
  if (!hasCatalogDatabase()) {
    cacheLife('seconds');
    return [];
  }
  const db = (await import('@/lib/supabase/admin')).createAdminClient();
  const { data, error } = await db.rpc('public_illustrator_directory');
  if (error && !isMissingFunction(error)) throw error;
  const rows = error
    ? (await getIllustratorDirectory()).map(({ name }) => ({ name }))
    : (data as { illustrator: string; card_count: number }[]).map((row) => ({
        name: row.illustrator,
        cardCount: Number(row.card_count),
      }));
  return groupIllustratorsBySlug(rows);
}

/**
 * An illustrator's English cards (every spelling on the page), newest first: the app's own illustrator lookup, kept
 * to sets with a public page.
 */
export async function getPublicIllustratorCards(names: readonly string[]): Promise<IllustratorCard[]> {
  'use cache';
  cacheLife('weeks');
  cacheTag('card-catalog', 'public-illustrators');
  const [sets, ...lists] = await Promise.all([
    getPublicSets(),
    ...names.map((name) => getCardsByIllustrator(name, 'en')),
  ]);
  const setIds = new Set(sets.map((set) => set.id));
  const order = new Map(sets.map((set, i) => [set.id, i]));
  return lists
    .flat()
    .filter((card) => setIds.has(card.set.id))
    .toSorted(
      (a, b) =>
        order.get(a.set.id)! - order.get(b.set.id)! || a.localId.localeCompare(b.localId, undefined, { numeric: true }),
    );
}
