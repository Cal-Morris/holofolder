import { developerImageKey } from '@/lib/developer-api/image-identity';
import { normalizePublicBaseUrl } from '@/lib/card-image-r2';
import { createAdminClient } from '@/lib/supabase/admin';

export type DeveloperImage = { url: string | null; availability: 'available' | 'missing' | 'unavailable' };
export type DeveloperImageResolver = (source: string | null) => Promise<DeveloperImage>;

export function collectDeveloperImageKeys(value: unknown, r2Bases: readonly string[] = []): string[] {
  const keys = new Set<string>();
  function visit(item: unknown) {
    if (typeof item === 'string') {
      const key = developerImageKey(item, r2Bases);
      if (key) keys.add(key);
    } else if (Array.isArray(item)) item.forEach(visit);
    else if (item && typeof item === 'object') Object.values(item).forEach(visit);
  }
  visit(value);
  return [...keys];
}
export function resolveRecordedDeveloperImage(
  source: unknown,
  keys: ReadonlySet<string>,
  base: string,
  r2Bases: readonly string[] = [],
): DeveloperImage {
  const key = developerImageKey(source, r2Bases);
  return key && keys.has(key)
    ? { url: `${base}${key}`, availability: 'available' }
    : { url: null, availability: 'missing' };
}

/** One batched inventory read for the entire response, including nested provider images. */
export async function createDeveloperImageResolver(value: unknown): Promise<DeveloperImageResolver> {
  const base = normalizePublicBaseUrl(process.env.R2_PUBLIC_BASE_URL),
    bucket = process.env.R2_BUCKET;
  if (!base || !bucket) return async (source) => ({ url: null, availability: source ? 'unavailable' : 'missing' });
  const bases = [base, 'https://assets.holofolder.com/', 'https://pub-47cc306087724b00a06ee44b2d4ff58a.r2.dev/'];
  if (process.env.R2_ACCOUNT_ID) bases.push(`https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${bucket}/`);
  const keys = collectDeveloperImageKeys(value, bases),
    present = new Set<string>();
  if (keys.length) {
    const admin = createAdminClient();
    for (let n = 0; n < keys.length; n += 500) {
      // oxlint-disable-next-line react-doctor/async-await-in-loop -- batches go one at a time to bound database load
      const { data, error } = await admin
        .from('card_image_inventory')
        .select('object_key')
        .eq('bucket', bucket)
        .in('object_key', keys.slice(n, n + 500));
      // During migration rollout, fail closed without falling back to per-image R2 requests.
      if (error)
        return async (source) => ({
          url: null,
          availability: developerImageKey(source, bases) ? 'unavailable' : 'missing',
        });
      for (const row of data ?? []) present.add(row.object_key);
    }
  }
  return async (source) => resolveRecordedDeveloperImage(source, present, base, bases);
}
export async function resolveDeveloperImage(source: string | null): Promise<DeveloperImage> {
  if (!source) return { url: null, availability: 'missing' };
  return (await createDeveloperImageResolver(source))(source);
}
