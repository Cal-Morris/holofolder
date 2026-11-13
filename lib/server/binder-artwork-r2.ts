import { AwsClient } from 'aws4fetch';
import { binderArtworkPath, BINDER_ARTWORK_TYPES, MAX_BINDER_ARTWORK_BYTES } from '@/lib/binder-appearance';
import { getR2BucketEndpoint } from '@/lib/card-image-r2';

type ArtworkConfig = { accountId: string; accessKeyId: string; secretAccessKey: string; bucket: string };
export function getPrivateArtworkConfig(env: Record<string, string | undefined> = process.env): ArtworkConfig | null {
  const accountId = env.R2_ACCOUNT_ID?.trim() ?? '';
  const bucket = env.R2_ARTWORK_BUCKET?.trim() ?? '';
  const accessKeyId = env.R2_ARTWORK_ACCESS_KEY_ID?.trim() ?? '';
  const secretAccessKey = env.R2_ARTWORK_SECRET_ACCESS_KEY?.trim() ?? '';
  if (
    !/^[a-f0-9]{32}$/i.test(accountId) ||
    !/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(bucket) ||
    bucket === env.R2_BUCKET?.trim() ||
    !accessKeyId ||
    !secretAccessKey
  )
    return null;
  return { accountId, bucket, accessKeyId, secretAccessKey };
}

export function createPrivateArtworkStore(config: ArtworkConfig, fetchImpl: typeof fetch = fetch) {
  const client = new AwsClient({ ...config, service: 's3', region: 'auto', retries: 0 });
  const endpoint = getR2BucketEndpoint(config);
  function objectUrl(owner: string, id: string) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(owner))
      throw new Error('Invalid artwork owner');
    return `${endpoint}${binderArtworkPath(owner, id)}`;
  }
  async function request(owner: string, id: string, init: RequestInit) {
    const signed = await client.sign(objectUrl(owner, id), init);
    const response = await fetchImpl(signed.url, { ...init, headers: signed.headers, cache: 'no-store' });
    if (!response.ok && response.status !== 404 && response.status !== 412)
      throw new Error('Private artwork storage is unavailable');
    return response;
  }
  return {
    async exists(owner: string, id: string) {
      return (await request(owner, id, { method: 'HEAD' })).ok;
    },
    async prepareUpload(owner: string, id: string, contentType: string, size: number) {
      if (
        !BINDER_ARTWORK_TYPES.includes(contentType as (typeof BINDER_ARTWORK_TYPES)[number]) ||
        !Number.isSafeInteger(size) ||
        size <= 0 ||
        size > MAX_BINDER_ARTWORK_BYTES
      )
        throw new Error('Choose a PNG, JPEG or WebP image under 5 MB.');
      const headers = { 'Content-Type': contentType, 'If-None-Match': '*' };
      const signed = await client.sign(`${objectUrl(owner, id)}?X-Amz-Expires=300`, {
        method: 'PUT',
        headers: { ...headers, 'Content-Length': String(size) },
        aws: { signQuery: true, allHeaders: true },
      });
      return {
        signedUploadUrl: signed.url,
        method: 'PUT' as const,
        headers,
        expiresIn: 300,
        storage: 'r2-private' as const,
      };
    },
    async downloadUrl(owner: string, id: string) {
      return (await client.sign(`${objectUrl(owner, id)}?X-Amz-Expires=300`, { aws: { signQuery: true } })).url;
    },
    async read(owner: string, id: string) {
      const response = await request(owner, id, { method: 'GET' });
      if (response.status === 404) return null;
      if (Number(response.headers.get('content-length')) > MAX_BINDER_ARTWORK_BYTES) {
        await response.body?.cancel();
        throw new Error('Choose an image under 5 MB.');
      }
      const reader = response.body?.getReader();
      if (!reader) return null;
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        while (true) {
          // oxlint-disable-next-line react-doctor/async-await-in-loop -- a stream is read one chunk at a time
          const chunk = await reader.read();
          if (chunk.done) break;
          size += chunk.value.byteLength;
          if (size > MAX_BINDER_ARTWORK_BYTES) {
            await reader.cancel();
            throw new Error('Choose an image under 5 MB.');
          }
          chunks.push(chunk.value);
        }
      } finally {
        reader.releaseLock();
      }
      return Buffer.concat(chunks);
    },
    async put(owner: string, id: string, bytes: Uint8Array, contentType: string) {
      if (!bytes.length || bytes.length > MAX_BINDER_ARTWORK_BYTES) throw new Error('Choose an image under 5 MB.');
      const body = new Uint8Array(bytes).buffer;
      const response = await request(owner, id, {
        method: 'PUT',
        body,
        headers: { 'Content-Type': contentType, 'Cache-Control': 'private, no-store', 'If-None-Match': '*' },
      });
      if (!response.ok && response.status !== 412) throw new Error('Artwork copy failed');
    },
  };
}
export function privateArtworkStore() {
  const config = getPrivateArtworkConfig();
  if (!config) throw new Error('Private artwork storage is not configured');
  return createPrivateArtworkStore(config);
}
