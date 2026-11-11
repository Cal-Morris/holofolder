import { normalizeEbayItemUrl, type PriceCheckListing } from '@/lib/ebay-listings';
import type { PriceCheckSummary, SoldComp } from '@/lib/sold-comps';

export const PRICE_CHECK_FRESH_MS = 30 * 60 * 60 * 1000;
export interface CardPriceCheck {
  summary: PriceCheckSummary;
  checkedAt: string;
  searchUrl?: string;
  sales?: SoldComp[];
  listings?: PriceCheckListing[];
}
export type PriceCheckSource = 'ebay' | 'soldcomps';
export interface CardPriceChecks {
  ebay: CardPriceCheck | null;
  soldcomps: CardPriceCheck | null;
  errors: Partial<Record<PriceCheckSource, string>>;
}

export function isCardPriceCheck(value: unknown): value is CardPriceCheck {
  if (!value || typeof value !== 'object') return false;
  const row = value as CardPriceCheck;
  const s = row.summary;
  if (
    !s ||
    !['asking', 'sold'].includes(s.kind) ||
    s.currency !== 'GBP' ||
    !Number.isInteger(s.count) ||
    s.count < 0 ||
    s.count > 200 ||
    typeof row.checkedAt !== 'string' ||
    !Number.isFinite(Date.parse(row.checkedAt)) ||
    ![s.low, s.median, s.high].every((n) => n === null || (typeof n === 'number' && Number.isFinite(n) && n > 0))
  )
    return false;
  if (
    s.count === 0
      ? s.low !== null || s.median !== null || s.high !== null
      : s.low === null || s.median === null || s.high === null || s.low > s.median || s.median > s.high
  )
    return false;
  if (
    row.searchUrl !== undefined &&
    (typeof row.searchUrl !== 'string' || !row.searchUrl.startsWith('https://www.ebay.co.uk/sch/'))
  )
    return false;
  const validRecord = (item: PriceCheckListing) =>
    typeof item?.amount === 'number' &&
    Number.isFinite(item.amount) &&
    item.amount > 0 &&
    (item.title === undefined || (typeof item.title === 'string' && item.title.length <= 500)) &&
    (item.condition === undefined || (typeof item.condition === 'string' && item.condition.length <= 100)) &&
    (item.url === undefined || (typeof item.url === 'string' && normalizeEbayItemUrl(item.url) === item.url));
  if (
    row.listings !== undefined &&
    (!Array.isArray(row.listings) || row.listings.length !== s.count || !row.listings.every(validRecord))
  )
    return false;
  return (
    row.sales === undefined ||
    (Array.isArray(row.sales) &&
      row.sales.length === s.count &&
      row.sales.every(
        (sale) => validRecord(sale) && typeof sale.soldAt === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(sale.soldAt),
      ))
  );
}
