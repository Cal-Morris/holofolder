'use client';

import { useEffect, useState } from 'react';
import { BINDER_ARTWORK_TYPES, MAX_BINDER_ARTWORK_BYTES } from '@/lib/binder-appearance';
import { getOfflineStore } from '@/lib/offline-store/kv';

const key = (owner: string, id: string) => `page-art:${owner}:${id}`;
const isArtworkBlob = (value: unknown): value is Blob =>
  value instanceof Blob &&
  value.size > 0 &&
  value.size <= MAX_BINDER_ARTWORK_BYTES &&
  (BINDER_ARTWORK_TYPES as readonly string[]).includes(value.type);

/** Keep an upload on this device so it shows offline straight away, before and after it is saved. */
export async function rememberPageArtUpload(owner: string, id: string, blob: Blob) {
  await getOfflineStore()?.set(key(owner, id), blob);
}

async function loadUpload(owner: string, id: string, signal: AbortSignal): Promise<Blob | null> {
  const store = getOfflineStore();
  const saved = await store?.get(key(owner, id)).catch(() => undefined);
  if (isArtworkBlob(saved)) return saved;
  const response = await fetch(`/app/api/binder-appearance/artwork?id=${encodeURIComponent(id)}`, {
    cache: 'no-store',
    credentials: 'same-origin',
    headers: { 'X-Binder-Owner': owner },
    signal,
  }).catch(() => null);
  const blob = response?.ok ? await response.blob().catch(() => null) : null;
  if (!isArtworkBlob(blob)) return null;
  await store?.set(key(owner, id), blob).catch(() => undefined);
  return blob;
}

/**
 * Object URLs for the owner's uploaded page artwork. Uploads are private, so they are fetched once with the owner
 * check and kept in IndexedDB (per account, never in the service worker), which makes them show offline.
 */
export function usePageArtUploads(owner: string | null, ids: readonly string[]) {
  const [urls, setUrls] = useState<Record<string, string>>({});
  const wanted = ids.toSorted().join(',');
  useEffect(() => {
    if (!owner || !wanted) return;
    const controller = new AbortController();
    const created: string[] = [];
    void Promise.all(
      wanted.split(',').map(async (id) => {
        const blob = await loadUpload(owner, id, controller.signal).catch(() => null);
        if (!blob || controller.signal.aborted) return;
        const url = URL.createObjectURL(blob);
        created.push(url);
        setUrls((current) => ({ ...current, [id]: url }));
      }),
    );
    return () => {
      controller.abort();
      for (const url of created) URL.revokeObjectURL(url);
      setUrls({});
    };
  }, [owner, wanted]);
  return urls;
}
