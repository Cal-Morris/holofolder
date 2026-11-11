import { DISPLAY_CURRENCIES, type DisplayCurrency } from '@/lib/pricing-region';
import { summarizeShowSession, type ShowSession } from '@/lib/show-session';

export interface ShowBudget {
  limit: number;
  currency: DisplayCurrency;
}
export const showBudgetStorageKey = (viewerId: string | null, ownerId: string | null) =>
  viewerId && ownerId ? `holofolder:show-budget:v1:${viewerId}:${ownerId}` : null;

export function parseShowBudget(raw: string | null | undefined): ShowBudget | null {
  try {
    const value = JSON.parse(raw ?? 'null');
    if (
      !value ||
      typeof value.limit !== 'number' ||
      !Number.isFinite(value.limit) ||
      value.limit <= 0 ||
      !DISPLAY_CURRENCIES.includes(value.currency)
    )
      return null;
    return { limit: value.limit, currency: value.currency };
  } catch {
    return null;
  }
}

export function summarizeShowBudget(budget: ShowBudget, session: ShowSession) {
  const { spent } = summarizeShowSession(session, budget.currency);
  return {
    spent,
    remaining: Math.round((budget.limit - spent) * 100) / 100,
    excludedCount: session.purchases.filter((purchase) => purchase.currency !== budget.currency).length,
  };
}
