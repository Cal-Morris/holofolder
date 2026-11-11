import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';

const KEY = /^hf_([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.([A-Za-z0-9_-]{43})$/;
export function parseDeveloperKey(raw: string): { id: string; secret: string } | null {
  if (raw.length !== 83) return null;
  const match = KEY.exec(raw);
  return match ? { id: match[1], secret: match[2] } : null;
}
export function createDeveloperKey() {
  const id = randomUUID(),
    secret = randomBytes(32).toString('base64url');
  return { id, key: `hf_${id}.${secret}`, digest: createHash('sha256').update(secret).digest('hex') };
}
export function verifyDeveloperKey(raw: string, digest: string): boolean {
  const parsed = parseDeveloperKey(raw);
  if (!parsed || !/^[0-9a-f]{64}$/.test(digest)) return false;
  return timingSafeEqual(createHash('sha256').update(parsed.secret).digest(), Buffer.from(digest, 'hex'));
}
