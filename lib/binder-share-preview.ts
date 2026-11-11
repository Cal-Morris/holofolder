import type { PublicBinder } from '@/lib/public-binder';
import { toSmallCardAssetSrc, toCardImageSrc } from '@/lib/card-image-url';

/** Owned card images first (binder order), then target printings, for the link preview. */
export function binderPreviewSummary(binder: Pick<PublicBinder, 'slots'>, max = 5) {
  let collected = 0,
    total = 0;
  const owned: string[] = [],
    targets: string[] = [];
  for (const slot of binder.slots) {
    if (slot.target || slot.item) total++;
    if (slot.item) collected++;
    const src = toCardImageSrc(slot.card?.image);
    if (!src?.startsWith('https://')) continue;
    (slot.item ? owned : targets).push(toSmallCardAssetSrc(src) ?? src);
  }
  return { collected, total, images: [...new Set([...owned, ...targets])].slice(0, max) };
}
