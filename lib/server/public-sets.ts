import { cacheLife, cacheTag } from 'next/cache';
import { readSetCardPages } from '@/lib/catalog-queries';
import { readCatalogMetadata } from '@/lib/card-catalog';
import { pickCardAssetUrl } from '@/lib/card-image-url';
import { getSetArtwork } from '@/lib/set-artwork';
import { assignSetSlugs, type PublicSetSummary } from '@/lib/set-pages';
import { buildTcgdexAssetImageUrl, pickImageLanguage, pickLocalizedText } from '@/lib/tcgdex-shared';

export interface PublicSetCard {
  id: string;
  number: string;
  name: string;
  rarity?: string;
  illustrator?: string;
  image?: string;
  /** National Dex numbers of the Pokémon on the card (several on tag teams, none on Trainers and Energy). */
  dexIds: number[];
}

const HIDDEN_SET_IDS = new Set(['jumbo']);

async function admin() {
  return (await import('@/lib/supabase/admin')).createAdminClient();
}

/**
 * Every English set we hold cards for, newest first, with its stable page slug. Plain `'use cache'` (not
 * remote) so the list lands in the prerendered HTML; a card sync expires the `card-catalog` tag.
 */
/**
 * Builds without database credentials (CI) prerender empty public catalogue pages instead of failing; deployed
 * builds have them. The e2e build has synthetic credentials for a backend that only answers share fixtures, so it
 * counts as having none.
 */
export const hasCatalogDatabase = () =>
  Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) &&
  process.env.HOLOFOLDER_E2E !== '1';

export async function getPublicSets(): Promise<PublicSetSummary[]> {
  'use cache';
  cacheLife('weeks');
  cacheTag('card-catalog', 'public-sets');
  if (!hasCatalogDatabase()) {
    cacheLife('seconds');
    return [];
  }
  const db = await admin();
  const { data, error } = await db
    .from('tcg_sets')
    .select(
      'id, name_json, official_card_count, release_date, tcg_series!inner(name_json, name_en), tcg_cards!inner(id)',
    )
    // One card per set: enough to leave out sets we hold no cards for, without counting 41k rows.
    .limit(1, { referencedTable: 'tcg_cards' })
    .not('name_json->en', 'is', null)
    .order('release_date', { ascending: false, nullsFirst: false })
    .limit(1000);
  if (error) throw error;
  type Row = {
    id: string;
    name_json: unknown;
    official_card_count: number | null;
    release_date: string | null;
    tcg_series: { name_json: unknown; name_en: string | null } | null;
  };
  const sets = (data as unknown as Row[]).flatMap((row) => {
    const name = pickLocalizedText(row.name_json, 'en')?.trim();
    if (!name || HIDDEN_SET_IDS.has(row.id)) return [];
    return [
      {
        id: row.id,
        name,
        seriesName: pickLocalizedText(row.tcg_series?.name_json, 'en') || row.tcg_series?.name_en || undefined,
        releaseDate: row.release_date ?? undefined,
        officialCardCount: row.official_card_count ?? undefined,
        ...getSetArtwork(row.id),
      },
    ];
  });
  const slugs = assignSetSlugs(sets);
  return sets.map((set) => ({ ...set, slug: slugs.get(set.id)! }));
}

export const PUBLIC_CARD_COLUMNS =
  'id, series_id, set_id, local_id, name_json, name_en, rarity, illustrator, image_languages_json, external_ids_json, tcg_card_dex_ids(dex_id)';

/** A `tcg_cards` row read with PUBLIC_CARD_COLUMNS as a public card: English name, printed number, image. */
export function toPublicSetCard(card: {
  id: string;
  series_id: string;
  set_id: string;
  local_id: string;
  name_json: unknown;
  name_en: string | null;
  rarity: string | null;
  illustrator: string | null;
  image_languages_json: unknown;
  external_ids_json: unknown;
  tcg_card_dex_ids: { dex_id: number }[] | null;
}): PublicSetCard {
  const imageLanguage = pickImageLanguage(card.image_languages_json, 'en');
  const image = pickCardAssetUrl(
    card.external_ids_json,
    imageLanguage,
    imageLanguage && buildTcgdexAssetImageUrl(imageLanguage, card.series_id, card.set_id, card.local_id),
    'en',
  );
  return {
    id: card.id,
    number: readCatalogMetadata(card.external_ids_json).localId ?? card.local_id,
    name: pickLocalizedText(card.name_json, 'en') || card.name_en || card.id,
    ...(card.rarity ? { rarity: card.rarity } : {}),
    ...(card.illustrator ? { illustrator: card.illustrator } : {}),
    ...(image ? { image } : {}),
    dexIds: (card.tcg_card_dex_ids ?? []).map((row) => row.dex_id).sort((a, b) => a - b),
  };
}

/** The set's cards in number order, English names and images from our asset domain. */
export async function getPublicSetCards(setId: string): Promise<PublicSetCard[]> {
  'use cache';
  cacheLife('weeks');
  cacheTag('card-catalog', `public-set:${setId.replace(/[^a-zA-Z0-9._-]/g, '_')}`);
  const db = await admin();
  const rows = await readSetCardPages((from, to) =>
    db
      .from('tcg_cards')
      .select(PUBLIC_CARD_COLUMNS)
      .eq('set_id', setId)
      .order('local_id_sort', { ascending: true, nullsFirst: false })
      .order('id')
      .range(from, to),
  );
  return rows.map(toPublicSetCard);
}
