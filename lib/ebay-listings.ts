import { scorePriceObservationMatch, type PriceSubject } from '@/lib/price-intelligence';

export interface PriceCheckListing {
  amount: number;
  title?: string;
  url?: string;
  condition?: string;
}

export function normalizeEbayItemUrl(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > 2000) return undefined;
  try {
    const url = new URL(value);
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.port ||
      !['www.ebay.co.uk', 'www.ebay.com', 'www.ebay.de'].includes(url.hostname) ||
      !/^\/itm\/(?:[^/]+\/)?\d{9,15}\/?$/.test(url.pathname)
    )
      return undefined;
    const variation = url.searchParams.get('var');
    url.search = '';
    url.hash = '';
    if (variation && /^\d{9,15}$/.test(variation)) url.searchParams.set('var', variation);
    return url.toString();
  } catch {
    return undefined;
  }
}

export function readPublicListingMetadata(title: string, url: unknown, condition: unknown) {
  const link = normalizeEbayItemUrl(url);
  return {
    title: title.slice(0, 500),
    ...(link ? { url: link } : {}),
    ...(typeof condition === 'string' && condition.trim() ? { condition: condition.trim().slice(0, 100) } : {}),
  };
}

export interface EbayListingSummary {
  kind: 'asking';
  currency: 'GBP';
  count: number;
  median: number | null;
  low: number | null;
  high: number | null;
}

export function summarizeEbayListingEvidence(subject: PriceSubject, items: unknown[]) {
  const prices = new Map<string, PriceCheckListing>();
  for (const item of items.slice(0, 200)) {
    if (!item || typeof item !== 'object' || subject.language !== 'en') continue;
    const row = item as Record<string, unknown>;
    const price = row.price as { value?: unknown; currency?: unknown } | undefined;
    const location = row.itemLocation as { country?: unknown } | undefined;
    if (
      typeof row.itemId !== 'string' ||
      !row.itemId ||
      typeof row.title !== 'string' ||
      price?.currency !== 'GBP' ||
      location?.country !== 'GB' ||
      !Array.isArray(row.buyingOptions) ||
      row.itemGroupHref
    )
      continue;
    const buyingOptions = new Set(row.buyingOptions);
    if (!buyingOptions.has('FIXED_PRICE') || buyingOptions.has('AUCTION')) continue;
    if (typeof price.value !== 'string' && typeof price.value !== 'number') continue;
    if (typeof price.value === 'string' && !/^\d+(?:\.\d+)?$/.test(price.value)) continue;
    const amount = Number(price.value);
    if (!Number.isFinite(amount) || amount <= 0) continue;
    if (!matchesPriceCheckTitle(subject, row.title)) continue;
    prices.set(row.itemId, {
      ...prices.get(row.itemId),
      amount,
      ...readPublicListingMetadata(row.title, row.itemWebUrl, row.condition),
    });
  }
  const listings = [...prices.values()];
  const amounts = listings.map((listing) => listing.amount).sort((a, b) => a - b);
  const middle = Math.floor(amounts.length / 2);
  const summary: EbayListingSummary = {
    kind: 'asking',
    currency: 'GBP',
    count: amounts.length,
    median: amounts.length
      ? Math.round((amounts.length % 2 ? amounts[middle] : (amounts[middle - 1] + amounts[middle]) / 2) * 100) / 100
      : null,
    low: amounts[0] ?? null,
    high: amounts.at(-1) ?? null,
  };
  return { summary, listings };
}

export function summarizeEbayListings(subject: PriceSubject, items: unknown[]): EbayListingSummary {
  return summarizeEbayListingEvidence(subject, items).summary;
}

export function matchesPriceCheckTitle(subject: PriceSubject, title: string) {
  if (subject.language !== 'en' || /\b(booster|sealed|empty|sleeves?|binder|poster|art print|code card)\b/i.test(title))
    return false;
  if (
    /\b(japanese|jpn|jap|jp|korean|kor|kr|german|ger|deu|de|french|fre|fra|fr|italian|ita|it|spanish|spa|esp|es|portuguese|por|pt|chinese|chi|chn|cn|zh|dutch|dut|nl|1st|first edition|shadowless|unlimited error)\b/i.test(
      title,
    )
  )
    return false;
  const inferredHolo = subject.printing && subject.unambiguousPrintingFinish === 'holo';
  if (
    subject.variant === 'holo' &&
    ((!inferredHolo && !/\bholo(?:foil)?\b/i.test(title)) || /non[ -]?holo/i.test(title))
  )
    return false;
  if (
    subject.printing &&
    /\b(?:cosmos|cosmic|galaxy|cracked ice|confetti|pok[eé] ?ball|master ?ball|non[ -]?foil)\b/i.test(title)
  )
    return false;
  if (subject.variant === 'normal' && /\bholo(?:foil)?\b/i.test(title) && !/non[ -]?holo/i.test(title)) return false;
  const number = subject.localId?.replace(/^0+(?=\d)/, '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (!number || !new RegExp(`(?:^|[^a-z0-9])(?:[a-z]+[- ]?)?0*${number}(?=$|[^a-z0-9])`, 'i').test(title))
    return false;
  // A set alias elsewhere in the title must not rescue a conflicting printed promo code.
  if (subject.printing && /^\d+$/.test(subject.localId ?? '')) {
    const codes = title.matchAll(new RegExp(`\\b([a-z]+)-?0*${number}\\b`, 'gi'));
    for (const code of codes) if (code[1].toLowerCase() !== subject.setId?.toLowerCase()) return false;
  }
  const printedTotal = title.match(new RegExp(`${number}\\s*/\\s*(\\d+)`, 'i'))?.[1];
  if (subject.officialCardCount && printedTotal && Number(printedTotal) !== subject.officialCardCount) return false;
  const match = scorePriceObservationMatch(subject, {
    provider: 'ebay',
    title,
    sourceUrl: '',
    amount: 1,
    currency: 'GBP',
    observedAt: '',
  });
  if (match.rating !== 'exact') return false;
  return true;
}
