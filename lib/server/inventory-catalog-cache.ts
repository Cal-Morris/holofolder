import { cacheLife, cacheTag } from 'next/cache';
import { createAdminClient } from '@/lib/supabase/admin';
import { batchCatalogCardReads, mergeCatalogRows } from './inventory-read-catalog';

let readCard: ReturnType<typeof batchCatalogCardReads> | undefined;

/** One card id's public mirror rows, shared by every user and revalidated with the rest of the mirror after a card sync.
 * Misses that land together are read in one batch, so a cold cache costs a few queries, not one per card. */
async function readCachedCatalogCard(id: string) {
  'use cache: remote';
  cacheLife('days');
  cacheTag('tcg-mirror', 'inventory-catalog-v1');
  readCard ??= batchCatalogCardReads(createAdminClient());
  return readCard(id);
}

export async function readInventoryCatalogRows(ids: readonly string[]) {
  return mergeCatalogRows(await Promise.all(ids.map(readCachedCatalogCard)));
}
