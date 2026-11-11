import type { SupportedCurrency } from '@/lib/card-pricing';

/** en-GB currency label; whole units from 100 up. Unknown, zero and negative amounts are null (never invented). */
export function formatCurrencyAmount(amount: number | null | undefined, currency: SupportedCurrency) {
  if (amount == null || !Number.isFinite(amount) || amount <= 0) return null;
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency,
    maximumFractionDigits: amount >= 100 ? 0 : 2,
  }).format(amount);
}

export function formatGbpAmount(amount: number | null | undefined) {
  return typeof amount === 'number' && Number.isFinite(amount) ? formatCurrencyAmount(amount, 'GBP') : null;
}
