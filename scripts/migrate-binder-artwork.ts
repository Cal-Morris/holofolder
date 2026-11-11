import { createHash } from 'node:crypto';
import pg from 'pg';
import { loadProjectEnvFiles } from '../lib/load-project-env';
import { createAdminClient } from '../lib/supabase/admin';
import { privateArtworkStore } from '../lib/server/binder-artwork-r2';
import { BINDER_ARTWORK_BUCKET, MAX_BINDER_ARTWORK_BYTES } from '../lib/binder-appearance';

// Copies and verifies private artwork before the app switches stores. Leaves source objects intact
// for rollback. Re-run before deployment to catch uploads made while the old app is still running.
async function main() {
  await loadProjectEnvFiles();
  const apply = process.argv.includes('--apply');
  const url = new URL(process.env.POSTGRES_URL_NON_POOLING!);
  url.searchParams.delete('sslmode');
  const db = new pg.Client({ connectionString: url.toString(), ssl: { rejectUnauthorized: false } });
  await db.connect();
  try {
    const admin = createAdminClient();
    const store = apply ? privateArtworkStore() : null;
    let after = '',
      count = 0,
      totalBytes = 0;
    const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
    while (true) {
      const { rows } = await db.query<{ name: string }>(
        'SELECT name FROM storage.objects WHERE bucket_id=$1 AND name>$2 ORDER BY name LIMIT 100',
        [BINDER_ARTWORK_BUCKET, after],
      );
      if (!rows.length) break;
      for (const { name } of rows) {
        const [owner, objectId, extra] = name.split('/');
        if (!owner || !objectId || extra) throw new Error('Unexpected artwork object path, migration stopped');
        const { data, error } = await admin.storage.from(BINDER_ARTWORK_BUCKET).download(name);
        if (error || !data || !data.size || data.size > MAX_BINDER_ARTWORK_BYTES)
          throw new Error('Source artwork cannot be verified');
        const bytes = new Uint8Array(await data.arrayBuffer());
        totalBytes += bytes.byteLength;
        if (totalBytes > 100 * 1024 * 1024)
          throw new Error('100 MB migration budget reached, review inventory before continuing');
        if (store) {
          const id = `upload:${objectId}`;
          await store.put(owner, id, bytes, data.type);
          const actual = await store.read(owner, id);
          if (!actual || hash(actual) !== hash(bytes))
            throw new Error('R2 artwork byte verification failed, migration stopped');
        }
        count++;
        after = name;
      }
    }
    console.log(
      JSON.stringify({
        mode: apply ? 'copied-and-verified' : 'inventory',
        objects: count,
        bytes: totalBytes,
        sourceRetained: true,
      }),
    );
  } finally {
    await db.end();
  }
}
main().catch(() => {
  console.error('Artwork migration failed. No source objects were deleted.');
  process.exitCode = 1;
});
