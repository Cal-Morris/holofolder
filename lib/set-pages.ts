// Public set checklist pages (/app/sets and /app/sets/<slug>): pure helpers, no data access.

export const SET_PAGE_POCKETS = 9;

export interface PublicSetSummary {
  id: string;
  slug: string;
  name: string;
  seriesName?: string;
  releaseDate?: string;
  officialCardCount?: number;
  logo?: string;
  symbol?: string;
}

/** "Pokémon GO" → "pokemon-go", "McDonald's Collection 2026" → "mcdonalds-collection-2026". */
export function setSlug(name: string) {
  return name
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * One slug per set id. The oldest set with a name keeps the plain slug; a later set with the same name (or a name
 * that slugs to nothing) gets its id appended, so existing URLs never move when a new set arrives.
 */
export function assignSetSlugs<T extends { id: string; name: string; releaseDate?: string }>(sets: readonly T[]) {
  const taken = new Set<string>();
  const slugs = new Map<string, string>();
  const oldestFirst = sets.toSorted(
    (a, b) => (a.releaseDate ?? '9999').localeCompare(b.releaseDate ?? '9999') || a.id.localeCompare(b.id),
  );
  for (const set of oldestFirst) {
    const base = setSlug(set.name);
    let slug = base && !taken.has(base) ? base : setSlug(`${set.name} ${set.id}`) || setSlug(set.id);
    for (let n = 2; taken.has(slug); n++) slug = `${base || setSlug(set.id)}-${n}`;
    taken.add(slug);
    slugs.set(set.id, slug);
  }
  return slugs;
}

/** "12" in a set of 131 → "12/131"; promos and unnumbered cards ("SWSH050", "TG01") stay as printed. */
export const formatCardNumber = (number: string, officialCardCount?: number) =>
  /^\d+$/.test(number) && officialCardCount ? `${number}/${officialCardCount}` : number;

/** Nine-pocket pages (one side each) to hold every card once. */
export const pagesNeeded = (cards: number, pockets = SET_PAGE_POCKETS) => Math.ceil(Math.max(0, cards) / pockets);

/** Splits cards into binder pages of `pockets` each. */
export function toBinderPages<T>(cards: readonly T[], pockets = SET_PAGE_POCKETS): T[][] {
  return Array.from({ length: pagesNeeded(cards.length, pockets) }, (_, i) =>
    cards.slice(i * pockets, (i + 1) * pockets),
  );
}

/**
 * Base cards are numbered up to the printed set total; secret cards are numbered above it ("181/131"). Cards
 * without a plain number (promos, "TG01") count toward the total only. Unknown printed total: no split.
 */
export function countSetCards(localIds: readonly string[], officialCardCount?: number) {
  const total = localIds.length;
  if (!officialCardCount) return { total, base: undefined, secret: undefined };
  const numbers = localIds.map((id) => (/^\d+$/.test(id) ? Number(id) : null));
  return {
    total,
    base: numbers.filter((n) => n !== null && n >= 1 && n <= officialCardCount).length,
    secret: numbers.filter((n) => n !== null && n > officialCardCount).length,
  };
}

/** Set guides published on holofolder.com/blog, by set page slug. Add a row when a guide is published. */
const BLOG_SET_GUIDES: Record<string, string> = {
  'paldean-fates': 'pokemon-paldean-fates-set-guide',
  'temporal-forces': 'pokemon-temporal-forces-set-guide',
  'twilight-masquerade': 'pokemon-twilight-masquerade-set-guide',
  'shrouded-fable': 'pokemon-shrouded-fable-set-guide',
  'stellar-crown': 'pokemon-stellar-crown-set-guide',
  'surging-sparks': 'pokemon-surging-sparks-set-guide',
  'prismatic-evolutions': 'pokemon-prismatic-evolutions-set-guide',
  'journey-together': 'pokemon-journey-together-set-guide',
  'destined-rivals': 'pokemon-destined-rivals-set-guide',
  'white-flare': 'pokemon-white-flare-set-guide',
  'black-bolt': 'pokemon-black-bolt-set-guide',
  'mega-evolution': 'pokemon-mega-evolution-set-guide',
  'phantasmal-flames': 'pokemon-phantasmal-flames-set-guide',
  'ascended-heroes': 'pokemon-ascended-heroes-set-guide',
  'perfect-order': 'pokemon-perfect-order-set-guide',
  'chaos-rising': 'pokemon-chaos-rising-set-guide',
  'pitch-black': 'pokemon-pitch-black-set-guide',
  '30th-classic-collection': 'pokemon-30th-classic-collection-set-guide',
  '30th-celebration': 'pokemon-30th-celebration-set-guide',
  'delta-reign': 'pokemon-delta-reign-set-guide',
  'mcdonalds-collection-2026': 'pokemon-mcdonalds-collection-2026-set-guide',
};

export function blogSetGuideUrl(slug: string) {
  const guide = BLOG_SET_GUIDES[slug];
  return guide ? `https://holofolder.com/blog/${guide}` : undefined;
}

/** "2025-01-17" → "17 January 2025"; anything else is returned unchanged. */
export function formatReleaseDate(date: string | undefined) {
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return date;
  return new Date(`${date}T00:00:00Z`).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}
