import { revalidateTag } from 'next/cache';

/** Named share pages are cached until their owner writes. Every server writer that changes what a share shows
 * expires its owner's tag; `links` also retries addresses cached as missing (share enabled, username or slug set). */
export const publicBinderTag = (ownerUserId: string) => `public-binder:${ownerUserId}`;
export const MISSING_PUBLIC_BINDER_TAG = 'public-binder-missing';

export function expirePublicBinders(ownerUserId: string, { links = false } = {}) {
  try {
    revalidateTag(publicBinderTag(ownerUserId), { expire: 0 });
    if (links) revalidateTag(MISSING_PUBLIC_BINDER_TAG, { expire: 0 });
  } catch {
    // Outside a Next request (unit tests, scripts) there is no cache to expire.
  }
}
