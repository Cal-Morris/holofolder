import { createHash } from 'node:crypto';

export function catalogFingerprint(snapshot: unknown) {
  return createHash('sha256').update(JSON.stringify(snapshot)).digest('hex');
}

export function catalogDatabaseIdentity(connectionString: string) {
  const url = new URL(connectionString);
  return catalogFingerprint([
    url.hostname,
    url.port || '5432',
    decodeURIComponent(url.username),
    decodeURIComponent(url.pathname),
  ]);
}
