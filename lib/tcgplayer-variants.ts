import { normalizeCatalogName } from './card-catalog';
import { mapWithConcurrency } from './card-db-sync-concurrency';

/**
 * Which standard finishes each printing is sold in, from TCGplayer's catalogue (via the TCGCSV daily dump). TCGdex
 * leaves new sets without variant flags or fills them with generated placeholders (Delta Reign: every card
 * "normal only"), and misses reverse holos on older sets (Delta Species), so a set checklist couldn't offer
 * "Reverse holo" pockets. A TCGplayer SKU is a real printing on sale, so a matched card's normal, holo and reverse
 * flags come from it; first edition is only ever added. Unmatched cards keep TCGdex's flags.
 */
export type TcgplayerVariants = { normal: boolean; holo: boolean; reverse: boolean; firstEdition?: true };

export type TcgcsvGroup = { groupId: number; name: string; publishedOn?: string };
export type TcgcsvProduct = { productId: number; name: string; extendedData?: Array<{ name: string; value: string }> };
export type TcgcsvPrice = { productId: number; subTypeName: string };
type SetLike = { id: string; name_en: string | null; release_date?: string | null };
type CardLike = { id: string; set_id: string; local_id: string; name_en: string | null };

const SUBTYPES: Record<string, Partial<Record<'normal' | 'holo' | 'reverse' | 'firstEdition', true>>> = {
  normal: { normal: true },
  unlimited: { normal: true },
  holofoil: { holo: true },
  unlimitedholofoil: { holo: true },
  reverseholofoil: { reverse: true },
  '1stedition': { firstEdition: true },
  '1steditionholofoil': { firstEdition: true },
};
/** Of a set's cards, how many must line up by collector number before a group is trusted as that set. */
const MIN_COVERAGE = 0.8;
/**
 * TCGplayer groups for sets whose name differs there ("151" is "SV: Scarlet & Violet 151") or whose cards are split
 * over several groups (Crown Zenith and its Galarian Gallery). Still checked by collector number before use.
 */
export const TCGPLAYER_GROUPS: Readonly<Record<string, readonly number[]>> = {
  'sv03.5': [23237],
  sv01: [22873],
  svp: [22872],
  'swsh12.5': [17688, 17689],
  'swsh4.5': [2754, 2781],
  swsh1: [2585],
  swshp: [2545],
  sm1: [1863],
  smp: [1861],
  g1: [1728, 1729],
  xy1: [1387],
  xyp: [1451],
  bw1: [1400],
  bwp: [1407],
  hgssp: [1453],
  dp1: [1430],
  dpp: [1421],
  ru1: [1433],
  np: [1423],
  ex1: [1393],
  ecard1: [1375],
  basep: [1418],
};

const collectorNumber = (value: string) =>
  value
    .split('/')[0]
    .toLowerCase()
    .replace(/(?<!\d)0+(?=\d)/g, '');
/** "ME06: Delta Reign" → "deltareign", "EX Delta Species" → "exdeltaspecies". */
const groupName = (name: string) => normalizeCatalogName(name.replace(/^[A-Za-z0-9.]+:\s*/, ''));
/** "Bagon - 057/113 (Delta Species)" → "bagon"; "Azumarill δ" → "azumarill". */
const cardName = (name: string) => normalizeCatalogName(name.split(/\s+-\s+|\s*\(/)[0].replace(/\s*δ\s*$/, ''));
const numberOf = (p: TcgcsvProduct) => p.extendedData?.find((d) => d.name === 'Number')?.value;
const days = (a: string, b: string) => Math.abs(Date.parse(a) - Date.parse(b)) / 86_400_000;

/**
 * The groups to try for a set, each try being one or more groups read together: its mapped groups, else groups of
 * the same name (or with a short series prefix, "EX Delta Species"), nearest release first. Release dates only rank,
 * since TCGplayer dates some old groups to the day they were last edited.
 */
export function candidateGroups(set: SetLike, groups: readonly TcgcsvGroup[]): number[][] {
  const mapped = TCGPLAYER_GROUPS[set.id];
  if (mapped) return [[...mapped]];
  const name = normalizeCatalogName(set.name_en ?? '');
  if (name.length < 3) return [];
  const gap = (g: TcgcsvGroup) =>
    set.release_date && g.publishedOn ? days(set.release_date, g.publishedOn) : Number.POSITIVE_INFINITY;
  return groups
    .filter((g) => {
      const n = groupName(g.name);
      // Exact, or a two-letter series prefix (EX, SM, XY), never a longer name that merely ends the same.
      return n.endsWith(name) && n.length - name.length <= 2;
    })
    .sort((a, b) => gap(a) - gap(b))
    .map((g) => [g.groupId]);
}

/**
 * Each card's finishes from one group's products and prices, or null when the group isn't this set (fewer than
 * 80% of the cards match by collector number). Several products on one number are told apart by name, then by
 * the one with no qualifier; a number that stays ambiguous is skipped rather than guessed.
 */
export function matchGroupVariants(
  cards: readonly CardLike[],
  products: readonly TcgcsvProduct[],
  prices: readonly TcgcsvPrice[],
): Map<string, TcgplayerVariants> | null {
  const subtypes = new Map<number, Set<string>>();
  for (const price of prices) {
    const key = normalizeCatalogName(price.subTypeName);
    if (!SUBTYPES[key]) continue;
    const set = subtypes.get(price.productId) ?? new Set();
    set.add(key);
    subtypes.set(price.productId, set);
  }
  const byNumber = new Map<string, TcgcsvProduct[]>();
  for (const product of products) {
    const number = numberOf(product);
    if (!number || !subtypes.has(product.productId)) continue;
    const key = collectorNumber(number);
    byNumber.set(key, [...(byNumber.get(key) ?? []), product]);
  }
  const matched = new Map<string, TcgplayerVariants>();
  let lined = 0;
  for (const card of cards) {
    const onNumber = byNumber.get(collectorNumber(card.local_id)) ?? [];
    if (onNumber.length) lined++;
    const named = onNumber.filter((p) => cardName(p.name) === cardName(card.name_en ?? ''));
    // Several of one name ("Eevee", "Eevee (Poke Ball Pattern)"): the one without a qualifier is the base printing.
    const plain = named.filter((p) => !/\(/.test(p.name));
    const product =
      onNumber.length === 1 ? onNumber[0] : named.length === 1 ? named[0] : plain.length === 1 ? plain[0] : undefined;
    if (!product) continue;
    const flags = Object.assign({}, ...[...subtypes.get(product.productId)!].map((s) => SUBTYPES[s]));
    // Patterned reverses ("Erika's Oddish (Poke Ball)") are their own products: still this card's reverse holo.
    const patternedReverse = named.some((p) => subtypes.get(p.productId)!.has('reverseholofoil'));
    matched.set(card.id, {
      normal: flags.normal === true,
      holo: flags.holo === true,
      reverse: flags.reverse === true || patternedReverse,
      ...(flags.firstEdition ? { firstEdition: true as const } : {}),
    });
  }
  return cards.length && lined / cards.length >= MIN_COVERAGE ? matched : null;
}

const TCGCSV = 'https://tcgcsv.com/tcgplayer/3';
async function tcgcsv<T>(path: string): Promise<T[]> {
  const response = await fetch(`${TCGCSV}/${path}`, {
    headers: { 'User-Agent': 'HoloFolderCatalog/1.0 (+https://holofolder.com)', Accept: 'application/json' },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`TCGCSV ${path}: HTTP ${response.status}`);
  const body = (await response.json()) as { results?: T[] };
  if (!Array.isArray(body.results)) throw new Error(`TCGCSV ${path}: no results`);
  return body.results;
}

/**
 * TCGplayer finishes for every card of the given sets that TCGCSV can match. Never throws: a set whose group
 * can't be found or fetched is left out (its cards keep TCGdex's flags) and logged.
 */
export async function fetchTcgplayerVariants(
  sets: readonly SetLike[],
  cards: readonly CardLike[],
  logger?: (message: string) => void,
): Promise<Map<string, TcgplayerVariants>> {
  const result = new Map<string, TcgplayerVariants>();
  let groups: TcgcsvGroup[];
  try {
    groups = await tcgcsv<TcgcsvGroup>('groups');
  } catch (error) {
    logger?.(`TCGplayer variants skipped: ${error instanceof Error ? error.message : String(error)}`);
    return result;
  }
  const cardsBySet = Map.groupBy(cards, (card) => card.set_id);
  const groupNames = new Map(groups.map((g) => [g.groupId, g.name]));
  await mapWithConcurrency([...sets], 4, async (set) => {
    const setCards = cardsBySet.get(set.id) ?? [];
    if (!setCards.length) return;
    for (const ids of candidateGroups(set, groups)) {
      const label = ids.map((id) => groupNames.get(id) ?? id).join(' + ');
      try {
        // oxlint-disable-next-line react-doctor/async-await-in-loop -- the next candidate is only fetched when this one isn't the set
        const fetched = await Promise.all(
          ids.map((id) => Promise.all([tcgcsv<TcgcsvProduct>(`${id}/products`), tcgcsv<TcgcsvPrice>(`${id}/prices`)])),
        );
        const matched = matchGroupVariants(
          setCards,
          fetched.flatMap(([products]) => products),
          fetched.flatMap(([, prices]) => prices),
        );
        if (!matched) continue;
        for (const [id, variants] of matched) result.set(id, variants);
        logger?.(`TCGplayer variants: ${set.id} ← "${label}", ${matched.size}/${setCards.length} cards`);
        return;
      } catch (error) {
        logger?.(`TCGplayer variants ${set.id}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  });
  return result;
}

/** A card row with TCGplayer's finishes applied over TCGdex's flags and kept as evidence for later syncs. */
export function applyTcgplayerVariants<
  T extends { id: string; variants_json: Record<string, boolean | undefined>; external_ids_json: object },
>(card: T, variants: TcgplayerVariants | undefined): T {
  if (!variants) return card;
  return {
    ...card,
    variants_json: { ...card.variants_json, ...variants },
    external_ids_json: { ...card.external_ids_json, tcgplayerVariants: variants },
  };
}
