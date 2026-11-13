import type { SupportedCurrency } from '@/lib/card-pricing';

const currencyFormats = (maximumFractionDigits: number) =>
  Object.fromEntries(
    (['USD', 'EUR', 'GBP'] as const).map((currency) => [
      currency,
      new Intl.NumberFormat('en-GB', { style: 'currency', currency, maximumFractionDigits }),
    ]),
  ) as Record<SupportedCurrency, Intl.NumberFormat>;
const WHOLE_UNITS = currencyFormats(0);
const WITH_PENCE = currencyFormats(2);

/** en-GB currency label; whole units from 100 up. Unknown, zero and negative amounts are null (never invented). */
export function formatCurrencyAmount(amount: number | null | undefined, currency: SupportedCurrency) {
  if (amount == null || !Number.isFinite(amount) || amount <= 0) return null;
  return (amount >= 100 ? WHOLE_UNITS : WITH_PENCE)[currency].format(amount);
}

export function formatGbpAmount(amount: number | null | undefined) {
  return typeof amount === 'number' && Number.isFinite(amount) ? formatCurrencyAmount(amount, 'GBP') : null;
}
