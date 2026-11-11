import { readCatalogMetadata } from './card-catalog';
import { inferDexIdsFromCardName } from './card-dex-inference';
import { parseSourceCardImageUrl, pickExternalCardImageUrl } from './card-image-sources';
import type { MirrorCardExternalSourceRow, MirrorCardRow, MirrorSetRow } from './card-db-sync';

/**
 * Fills catalog gaps from public sources: images for cards the primary source has no
 * image for, cross-source aliases, and promo sets the primary source does not list.
 * The planner is pure; `bun run card-assets fill-gaps` (scripts/card-assets/fill-gaps.ts) fetches the sources and applies the plan.
 * Every image URL it writes is mirrored into the card image store before it is served.
 */

export type GapProduct = {
  productId: number;
  groupId: number;
  name: string;
  extendedData?: Array<{ name: string; value: string }>;
};
export type GapLegacyCard = { id: string; name: string; number: string; images?: { large?: string; small?: string } };
/** A playshop.fr product: one scanned card, handle `pokemon-<setId>-<number>-<slug>`, title `<NNN>/<TTT> - <name>`. */
export type GapShopProduct = { handle: string; title: string; image: string };
export type GapCard = Pick<
  MirrorCardRow,
  'id' | 'set_id' | 'local_id' | 'name_en' | 'image_languages_json' | 'external_ids_json'
>;

/**
 * pokemontcg: a pokemontcg-data set (cards matched by number and name).
 * tcgcsv: a TCGplayer product group (matched by number and name).
 * scrydex / limitless: an expansion code on that image host, addressed by the card's own collector
 * number. These hosts publish no card list, so use them only for sets numbered like the source.
 * playshop: a TCGdex set id; playshop.fr lists scans of single cards under that id (French-only sets).
 */
type Source =
  { pokemontcg: string } | { tcgcsv: number } | { scrydex: string } | { limitless: string } | { playshop: string };

/** Where to look for images, in order, for each set with cards that have no image. */
export const GAP_IMAGE_SOURCES: Record<string, Source[]> = {
  '30th-c': [{ pokemontcg: 'me55c' }, { tcgcsv: 24837 }],
  '30th': [{ pokemontcg: 'me55' }],
  cel25cc: [{ pokemontcg: 'cel25c' }, { tcgcsv: 2931 }],
  cel25: [{ pokemontcg: 'cel25c' }],
  fut20: [{ pokemontcg: 'fut20' }],
  ecard2: [{ pokemontcg: 'ecard2' }],
  smp: [{ pokemontcg: 'smp' }],
  sm2: [{ pokemontcg: 'sm2' }],
  hgssp: [{ pokemontcg: 'hsp' }, { limitless: 'HSP' }],
  ex10: [{ pokemontcg: 'ex10' }],
  exu: [{ pokemontcg: 'ex10' }],
  'ex5.5': [{ tcgcsv: 2214 }],
  mfb: [{ tcgcsv: 23330 }],
  'tk-hs-g': [{ tcgcsv: 1540 }, { scrydex: 'tk4b' }],
  'tk-hs-r': [{ tcgcsv: 1540 }, { scrydex: 'tk4a' }],
  'tk-dp-m': [{ tcgcsv: 1541 }, { scrydex: 'tk3a' }],
  'tk-dp-l': [{ tcgcsv: 1541 }, { scrydex: 'tk3b' }],
  'tk-sm-r': [{ tcgcsv: 2069 }, { scrydex: 'tk10b' }],
  'tk-sm-l': [{ tcgcsv: 2069 }, { scrydex: 'tk10a' }],
  mep: [{ scrydex: 'mep' }],
  '2024sv': [{ scrydex: 'mcd24' }],
  'first-partner-packs': [{ tcgcsv: 2776 }],
  xya: [{ tcgcsv: 1938 }],
  // French McDonald's collections: no card database has scans; playshop.fr product scans (single cards only).
  '2013bw': [{ playshop: '2013bw' }],
  '2018sm-fr': [{ playshop: '2018sm-fr' }],
  '2019sm-fr': [{ playshop: '2019sm-fr' }],
};

/** Cards that are the same printing under two ids. The alias is hidden behind the canonical card. */
export const GAP_CARD_ALIASES: Array<{
  alias: string;
  canonical: string;
  source: { pokemontcg: string; cardId: string };
}> = [
  // Palkia LV.X 106/106 in the Classic Collection: the primary source names it "Palkia".
  { alias: 'me55c-106p', canonical: '30th-c-022', source: { pokemontcg: 'me55c', cardId: 'me55c-106p' } },
];

/**
 * Promo distributions the primary source does not list, imported from TCGplayer product data.
 * `seriesId` files the set under an existing series; otherwise it goes under the supplemental series.
 */
export const GAP_NEW_SETS: Array<{
  id: string;
  group: number;
  name: string;
  releaseDate: string | null;
  seriesId?: string;
}> = [
  { id: 'trick-or-trade-2022', group: 3179, name: 'Trick or Trade BOOster Bundle 2022', releaseDate: '2022-09-01' },
  { id: 'trick-or-trade-2023', group: 23266, name: 'Trick or Trade BOOster Bundle 2023', releaseDate: '2023-09-01' },
  { id: 'trick-or-trade-2024', group: 23561, name: 'Trick or Trade BOOster Bundle 2024', releaseDate: '2024-08-30' },
  { id: 'burger-king-promos', group: 2175, name: 'Burger King Promos', releaseDate: null },
  { id: 'countdown-calendar-2008', group: 2155, name: 'Countdown Calendar Promos', releaseDate: '2008-10-01' },
  { id: 'mcdonalds-2026', group: 24938, name: "McDonald's Collection 2026", releaseDate: '2026-11-10', seriesId: 'mc' },
];
export const GAP_SERIES_ID = 'catalog-supplements';

const FINISH = /^(?:holo|holofoil|non-holo|cosmos holo|reverse holo|\d{4} copyright date)$/i;

export function normalizeGapName(value: string | null | undefined) {
  return (value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[★☆]/g, ' star ')
    .replace(/δ/g, ' ')
    .replace(/^basic\s+(?=\w+ energy$)/i, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}
export function normalizeGapNumber(value: string | null | undefined) {
  let raw = value ?? '';
  try {
    raw = decodeURIComponent(raw);
  } catch {
    /* Keep the raw collector number. */
  }
  return raw
    .split('/')[0]
    .toLowerCase()
    .replace(/[^a-z0-9!?]/g, '')
    .replace(/(?<![0-9])0+(?=\d)/g, '');
}
function productDetails(p: GapProduct) {
  return Object.fromEntries((p.extendedData ?? []).map((d) => [d.name, d.value]));
}
/** Product name split into the card name and its qualifiers ("Water Energy (#10)" → "Water Energy", ["#10"]). */
export function splitProductName(name: string) {
  const qualifiers: string[] = [];
  let base = name.replace(/\s+(?:-\s+[A-Z]*\d+[a-z]?(?:\/\d+)?\b|\d+\/\d+\b).*$/i, (m) => {
    qualifiers.push(...[...m.matchAll(/[([]([^)\]]+)[)\]]/g)].map((q) => q[1]));
    return '';
  });
  base = base
    .replace(/\s*[([]([^)\]]+)[)\]]/g, (_m, q: string) => {
      qualifiers.push(q.trim());
      return '';
    })
    .trim();
  return { base, qualifiers };
}
function productNumber(p: GapProduct) {
  const { qualifiers } = splitProductName(p.name);
  const hash = qualifiers.map((q) => q.match(/^#(\d+)/)?.[1]).find(Boolean);
  return normalizeGapNumber(hash ?? productDetails(p).Number ?? '');
}

type Candidate = {
  key: string;
  name: string;
  number: string;
  qualified: boolean;
  finishOnly: boolean;
  image: string;
  productId?: string;
  ref: string;
};
function legacyCandidates(cards: GapLegacyCard[]): Candidate[] {
  return cards
    .filter((c) => parseSourceCardImageUrl(c.images?.large ?? c.images?.small ?? ''))
    .map((c) => ({
      key: c.id,
      name: normalizeGapName(c.name),
      number: normalizeGapNumber(c.number),
      qualified: false,
      finishOnly: true,
      image: (c.images!.large ?? c.images!.small)!,
      ref: `pokemontcg:${c.id}`,
    }));
}
function productCandidates(products: GapProduct[], hasImage: (pid: string) => boolean): Candidate[] {
  return products
    .filter((p) => hasImage(String(p.productId)))
    .map((p) => {
      const { base, qualifiers } = splitProductName(p.name);
      const meaningful = qualifiers.filter((q) => !/^#\d+/.test(q));
      return {
        key: String(p.productId),
        name: normalizeGapName(base),
        number: productNumber(p),
        qualified: meaningful.length > 0,
        finishOnly: meaningful.every((q) => FINISH.test(q)),
        image: `https://product-images.tcgplayer.com/${p.productId}.jpg`,
        productId: String(p.productId),
        ref: `tcgcsv:${p.productId}`,
      };
    });
}
function shopCandidates(setId: string, products: GapShopProduct[]): Candidate[] {
  const prefix = `pokemon-${setId}-`;
  return products.flatMap((p) => {
    const number = p.handle.startsWith(prefix) ? p.handle.slice(prefix.length).match(/^([a-z0-9]+)-/)?.[1] : undefined;
    const image = p.image.split('?')[0];
    if (!number || !parseSourceCardImageUrl(image)) return [];
    return [
      {
        key: p.handle,
        name: normalizeGapName(p.title.split(' - ').slice(1).join(' - ') || p.title),
        number: normalizeGapNumber(number),
        qualified: false,
        finishOnly: true,
        image,
        ref: `playshop:${p.handle}`,
      },
    ];
  });
}
/** Several products for one card: prefer the plain printing, then accept finish-only differences. */
function choose(matches: Candidate[]) {
  if (matches.length <= 1) return matches[0];
  const plain = matches.filter((m) => !m.qualified);
  if (plain.length === 1) return plain[0];
  if (matches.every((m) => m.finishOnly))
    return [...matches].sort(
      (a, b) => Number(a.productId ?? 0) - Number(b.productId ?? 0) || a.key.localeCompare(b.key),
    )[0];
  return undefined;
}

const SAFE_KEY = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
/** Image hosts addressed by collector number: one candidate for the card itself, or none. */
function numberedCandidate(
  source: { scrydex: string } | { limitless: string },
  card: GapCard,
  name: string,
  number: string,
): Candidate[] {
  if ('scrydex' in source) {
    const id = `${source.scrydex}-${card.local_id}`;
    return SAFE_KEY.test(id)
      ? [
          {
            key: id,
            name,
            number,
            qualified: false,
            finishOnly: true,
            image: `https://images.scrydex.com/pokemon/${id}/large`,
            ref: `scrydex:${id}`,
          },
        ]
      : [];
  }
  const digits = card.local_id.match(/(\d+)$/)?.[1];
  if (!digits || !/^[A-Z0-9]{1,10}$/.test(source.limitless)) return [];
  const file = `${source.limitless}_${digits.padStart(3, '0')}_R_EN_LG`;
  return [
    {
      key: file,
      name,
      number,
      qualified: false,
      finishOnly: true,
      image: `https://limitlesstcg.nyc3.cdn.digitaloceanspaces.com/tpci/${source.limitless}/${file}.png`,
      ref: `limitless:${file}`,
    },
  ];
}

export function cardHasImage(card: GapCard) {
  return (
    card.image_languages_json.length > 0 ||
    Boolean(readCatalogMetadata(card.external_ids_json).image) ||
    Boolean(pickExternalCardImageUrl(card.external_ids_json))
  );
}

/** The URL a card without TCGdex languages renders from, or null; callers check these for dead links. */
export function currentFallbackImageUrl(card: GapCard): string | null {
  if (card.image_languages_json.length) return null;
  const url = readCatalogMetadata(card.external_ids_json).image ?? pickExternalCardImageUrl(card.external_ids_json);
  if (!url) return null;
  return /^https:\/\/assets\.tcgdex\.net\//.test(url) && !/\.(?:webp|png|jpg)$/.test(url) ? `${url}/high.webp` : url;
}

export type GapImagePatch = { cardId: string; image: string; productId?: string; source: string };
export type GapPlan = {
  images: GapImagePatch[];
  aliases: Array<{ cardId: string; catalog: Record<string, unknown> }>;
  series: Array<{ id: string; name_en: string; name_json: Record<string, string>; raw_json: Record<string, unknown> }>;
  sets: MirrorSetRow[];
  cards: MirrorCardRow[];
  externalSources: MirrorCardExternalSourceRow[];
  dexLinks: Array<{ card_id: string; dex_id: number }>;
  unresolved: Array<{ cardId: string; reason: string }>;
  /** Configured aliases or sets the inputs do not cover (missing rows or source data). */
  notes: string[];
};

export function planCardGapFill(input: {
  cards: GapCard[];
  existingSetIds: ReadonlySet<string>;
  existingSeriesIds: ReadonlySet<string>;
  pokemontcg: Record<string, GapLegacyCard[]>;
  tcgcsv: Record<number, GapProduct[]>;
  hasProductImage: (productId: string) => boolean;
  /** playshop.fr products by TCGdex set id (see GapShopProduct). */
  playshop?: Record<string, GapShopProduct[]>;
  /** Cards whose current image URL is dead (checked by the caller); they are filled like cards without one. */
  brokenImages?: ReadonlySet<string>;
  /** Candidate image URLs the caller found dead; the next source is tried instead. */
  unavailableImages?: ReadonlySet<string>;
}): GapPlan {
  const broken = input.brokenImages ?? new Set<string>();
  const unavailable = input.unavailableImages ?? new Set<string>();
  const needsImage = (c: GapCard) => !cardHasImage(c) || broken.has(c.id);
  const plan: GapPlan = {
    images: [],
    aliases: [],
    series: [],
    sets: [],
    cards: [],
    externalSources: [],
    dexLinks: [],
    unresolved: [],
    notes: [],
  };
  const byId = new Map(input.cards.map((c) => [c.id, c]));
  const bySet = new Map<string, GapCard[]>();
  for (const c of input.cards) bySet.set(c.set_id, [...(bySet.get(c.set_id) ?? []), c]);
  const aliasIds = new Set(GAP_CARD_ALIASES.flatMap((a) => [a.alias, a.canonical]));
  const patched = new Set<string>();

  for (const a of GAP_CARD_ALIASES) {
    const alias = byId.get(a.alias),
      canonical = byId.get(a.canonical);
    const source = input.pokemontcg[a.source.pokemontcg]?.find((c) => c.id === a.source.cardId);
    if (!alias || !canonical) {
      plan.notes.push(`Alias pair ${a.alias} → ${a.canonical} is not in the catalog`);
      continue;
    }
    const image = source?.images?.large ?? source?.images?.small;
    plan.aliases.push({ cardId: alias.id, catalog: { canonicalId: canonical.id, aliasIds: [canonical.id] } });
    plan.aliases.push({ cardId: canonical.id, catalog: { aliasIds: [alias.id] } });
    for (const card of [canonical, alias]) {
      if (image && needsImage(card)) {
        plan.images.push({ cardId: card.id, image, source: `pokemontcg:${a.source.cardId}` });
        patched.add(card.id);
      }
    }
  }

  const setIds = new Set([
    ...Object.keys(GAP_IMAGE_SOURCES),
    ...[...broken].flatMap((id) => byId.get(id)?.set_id ?? []),
  ]);
  for (const setId of setIds) {
    const sources = GAP_IMAGE_SOURCES[setId] ?? [];
    const setCards = bySet.get(setId) ?? [];
    const missing = setCards.filter((c) => needsImage(c) && !patched.has(c.id) && !aliasIds.has(c.id));
    if (!missing.length) continue;
    const configured = sources.map((s) =>
      'pokemontcg' in s
        ? legacyCandidates(input.pokemontcg[s.pokemontcg] ?? [])
        : 'tcgcsv' in s
          ? productCandidates(input.tcgcsv[s.tcgcsv] ?? [], input.hasProductImage)
          : 'playshop' in s
            ? shopCandidates(s.playshop, input.playshop?.[s.playshop] ?? [])
            : s,
    );
    for (const card of missing) {
      const name = normalizeGapName(card.name_en),
        number = normalizeGapNumber(card.local_id);
      let found: Candidate | undefined,
        reason = 'No source image matches the collector number and name';
      // The card's own pokemontcg-data id names its Scrydex scan, which covers scans pokemontcg.io lacks.
      const own = (card.external_ids_json.pokemon_tcg as { cardId?: unknown } | undefined)?.cardId;
      const ownPool: Candidate[] =
        typeof own === 'string' && SAFE_KEY.test(own)
          ? [
              {
                key: own,
                name,
                number,
                qualified: false,
                finishOnly: true,
                image: `https://images.scrydex.com/pokemon/${own}/large`,
                ref: `scrydex:${own}`,
              },
            ]
          : [];
      for (const configuredPool of [ownPool, ...configured]) {
        const pool = (
          Array.isArray(configuredPool) ? configuredPool : numberedCandidate(configuredPool, card, name, number)
        ).filter((c) => !unavailable.has(c.image));
        const exact = pool.filter((c) => c.name === name && c.number === number);
        if (exact.length) {
          found = choose(exact);
          if (found) break;
          reason = 'Several source printings match';
          continue;
        }
        // Reprint collections renumber cards, so match on the name and pair same-name cards in collector order.
        const sameName = pool.filter((c) => c.name === name);
        const siblings = setCards
          .filter((c) => normalizeGapName(c.name_en) === name)
          .sort((a, b) => a.local_id.localeCompare(b.local_id, undefined, { numeric: true }));
        if (siblings.length === 1) {
          found = choose(sameName);
          if (found) break;
          if (sameName.length) reason = 'Several source printings match';
          continue;
        }
        const plain = sameName
          .filter((c) => !c.qualified)
          .sort((a, b) => a.number.localeCompare(b.number, undefined, { numeric: true }));
        if (plain.length === siblings.length && plain.length > 1) {
          found = plain[siblings.indexOf(card)];
          break;
        }
      }
      if (found) {
        plan.images.push({ cardId: card.id, image: found.image, productId: found.productId, source: found.ref });
        patched.add(card.id);
      } else plan.unresolved.push({ cardId: card.id, reason });
    }
  }

  const seriesNeeded =
    GAP_NEW_SETS.some((s) => !s.seriesId && !input.existingSetIds.has(s.id)) &&
    !input.existingSeriesIds.has(GAP_SERIES_ID);
  if (seriesNeeded)
    plan.series.push({
      id: GAP_SERIES_ID,
      name_en: 'Supplemental sets',
      name_json: { en: 'Supplemental sets' },
      raw_json: { source: 'catalog' },
    });
  for (const def of GAP_NEW_SETS) {
    const seriesId = def.seriesId ?? GAP_SERIES_ID;
    // A product already imported into another set is the same printing; never import it twice.
    const elsewhere = new Set(
      input.cards
        .filter((c) => c.set_id !== def.id)
        .map((c) => readCatalogMetadata(c.external_ids_json).productId)
        .filter(Boolean),
    );
    const products = (input.tcgcsv[def.group] ?? []).filter((p) => {
      const d = productDetails(p);
      return (
        /^\d+$/.test(d.HP ?? '') &&
        Boolean(d.Number) &&
        input.hasProductImage(String(p.productId)) &&
        !elsewhere.has(String(p.productId))
      );
    });
    if (!products.length) {
      plan.notes.push(`${def.id}: no card products with images in TCGplayer group ${def.group}`);
      continue;
    }
    const rows = products
      .map((p) => {
        const d = productDetails(p);
        const { base, qualifiers } = splitProductName(p.name);
        const label = qualifiers
          .filter(
            (q) => !/^\d+\/\d+$|^#\d+/.test(q) && !FINISH.test(q) && !/^(?:diamond (?:&|and) pearl|platinum)$/i.test(q),
          )
          .join(', ');
        return { p, d, base, label, number: d.Number.trim() };
      })
      .sort((a, b) => a.number.localeCompare(b.number, undefined, { numeric: true }) || a.base.localeCompare(b.base));
    plan.sets.push({
      id: def.id,
      series_id: seriesId,
      name_en: def.name,
      name_json: { en: def.name },
      official_card_count: null,
      release_date: def.releaseDate,
      raw_json: { supplementalSources: { tcgcsv: { groupId: def.group } } },
    });
    const used = new Map<string, number>();
    rows.forEach((row, index) => {
      const pid = String(row.p.productId);
      const seen = used.get(row.number) ?? 0;
      used.set(row.number, seen + 1);
      const localId = seen ? `${row.number}~${pid}` : row.number;
      const id = `tcgplayer-${pid}`;
      const name = row.label ? `${row.base} (${row.label})` : row.base;
      plan.cards.push({
        id,
        series_id: seriesId,
        set_id: def.id,
        local_id: localId,
        local_id_sort: index + 1,
        name_en: name,
        name_json: { en: name },
        category: 'Pokemon',
        rarity: row.d.Rarity ?? null,
        hp: Number(row.d.HP) || null,
        illustrator: null,
        types_json: row.d['Card Type'] ? [row.d['Card Type']] : [],
        image_languages_json: [],
        variants_json: /cosmos holo|holo/i.test(row.p.name) && !/non-holo/i.test(row.p.name) ? { holo: true } : {},
        external_ids_json: { catalog: { productId: pid, image: `https://product-images.tcgplayer.com/${pid}.jpg` } },
        raw_json: { supplementalSources: { tcgcsv: row.p } },
      });
      plan.externalSources.push({
        card_id: id,
        source: 'tcgcsv',
        source_card_id: pid,
        source_set_id: String(def.group),
        raw_json: { ...row.p },
      });
      const dex = inferDexIdsFromCardName(
        row.base
          .replace(/^(?:Galarian|Alolan|Hisuian|Paldean|Teal Mask)\s+/, '')
          .replace(/-(GX|EX|V|VMAX|VSTAR)\b/gi, ' $1'),
      );
      if (!dex.length) plan.unresolved.push({ cardId: id, reason: `No Pokédex match for ${row.base}` });
      for (const dex_id of dex) plan.dexLinks.push({ card_id: id, dex_id });
    });
  }
  return plan;
}
