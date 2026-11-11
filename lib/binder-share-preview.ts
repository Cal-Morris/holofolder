import type { PublicBinder } from '@/lib/public-binder';
import { toSmallCardAssetSrc, toCardImageSrc } from '@/lib/card-image-url';

export type PreviewPocket = { src: string | null; owned: boolean };

/** Counts for the link preview, plus the page with the most owned cards (earliest on a tie) as pockets. */
export function binderPreviewSummary(binder: Pick<PublicBinder, 'slots' | 'rows' | 'cols'>) {
  let collected = 0,
    total = 0;
  for (const slot of binder.slots) {
    if (slot.target || slot.item) total++;
    if (slot.item) collected++;
  }
  const perPage = Math.max(1, binder.rows * binder.cols);
  let best = 0,
    bestOwned = -1;
  for (let start = 0; start < binder.slots.length; start += perPage) {
    const owned = binder.slots.slice(start, start + perPage).filter((slot) => slot.item).length;
    if (owned > bestOwned) [best, bestOwned] = [start, owned];
  }
  const page: PreviewPocket[] = Array.from({ length: perPage }, (_, i) => {
    const slot = binder.slots[best + i];
    const src = toCardImageSrc(slot?.card?.image);
    return {
      src: src?.startsWith('https://') ? (toSmallCardAssetSrc(src) ?? src) : null,
      owned: Boolean(slot?.item),
    };
  });
  return { collected, total, page };
}
