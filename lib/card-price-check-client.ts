import { isCardPriceCheck, type PriceCheckSource, type CardPriceChecks } from '@/lib/card-price-checks';
import { pinCardPriceCheck, priceCheckFinish } from '@/lib/card-price-check-cache';
import type { CardFinish } from '@/lib/domain/cards';

/** A failed check request; `status` lets batch callers back off on 429/503 instead of retrying hot. */
export class PriceCheckRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

// Reuse saved checks indefinitely; only the explicit refresh action may replace one.
// Every good answer is pinned on this device for offline reads.
export async function requestCardPriceCheck(
  cardId: string,
  language: string,
  finish: CardFinish | undefined,
  source: PriceCheckSource,
  signal: AbortSignal,
  refresh = false,
) {
  const exactFinish = priceCheckFinish(finish);
  const params = new URLSearchParams({ cardId, language, finish: exactFinish, source });
  if (refresh) params.set('refresh', 'true');
  const response = await fetch(`/app/api/card-price-checks?${params}`, {
    method: 'POST',
    cache: 'no-store',
    signal: AbortSignal.any([signal, AbortSignal.timeout(45_000)]),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok)
    throw new PriceCheckRequestError(
      typeof data?.error === 'string' ? data.error : 'Price check unavailable.',
      response.status,
    );
  const check: unknown = data?.[source];
  if (
    !(check === null || (isCardPriceCheck(check) && check.summary.kind === (source === 'ebay' ? 'asking' : 'sold'))) ||
    !data?.errors ||
    typeof data.errors !== 'object' ||
    (data.errors[source] !== undefined && typeof data.errors[source] !== 'string')
  )
    throw new Error('Invalid price check response.');
  if (check) await pinCardPriceCheck(cardId, exactFinish, source, check);
  return { check, error: data.errors[source] as string | undefined };
}

/** Read shared saved evidence without starting a provider lookup. */
export async function readSavedCardPriceChecks(
  cardId: string,
  language: string,
  finish: CardFinish | undefined,
  signal: AbortSignal,
): Promise<CardPriceChecks> {
  const params = new URLSearchParams({ cardId, language, finish: priceCheckFinish(finish) });
  const response = await fetch(`/app/api/card-price-checks?${params}`, {
    method: 'GET',
    cache: 'no-store',
    signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok)
    throw new PriceCheckRequestError(
      typeof data?.error === 'string' ? data.error : 'Saved price checks unavailable.',
      response.status,
    );
  for (const source of ['ebay', 'soldcomps'] as const) {
    const check: unknown = data?.[source];
    if (
      !(
        check === null ||
        (isCardPriceCheck(check) && check.summary.kind === (source === 'ebay' ? 'asking' : 'sold'))
      ) ||
      !data?.errors ||
      typeof data.errors !== 'object' ||
      (data.errors[source] !== undefined && typeof data.errors[source] !== 'string')
    )
      throw new Error('Invalid price check response.');
  }
  await Promise.all(
    (['ebay', 'soldcomps'] as const).map((source) =>
      data[source] ? pinCardPriceCheck(cardId, finish, source, data[source]) : undefined,
    ),
  );
  return data;
}
