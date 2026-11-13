/**
 * `card-assets fingerprints --db`: mirrors the fingerprint index into public.tcg_card_embeddings (migration 116).
 * Cards embedded this run are written with their float vectors; every other row comes from the index's int8 values
 * (dequantised), which backfills the table from the local or published index without embedding anything again.
 * Only rows whose image changed are written, and rows for cards the index dropped are deleted.
 */
import { Client } from 'pg';
import {
  dequantizeInt8,
  EMBEDDING_MODEL,
  planEmbeddingSync,
  toVectorLiteral,
} from '../../lib/card-assets/embeddings-db';
import { getMirrorDatabaseUrl } from '../../lib/card-db-sync';

const BATCH = 500;

export interface EmbeddingLanguage {
  language: string;
  /** Every row the index holds for the language after this run. */
  rows: ReadonlyArray<{ id: string; key: string; vector?: Int8Array }>;
  /** Float vectors embedded this run, by card id (also marks them as changed). */
  fresh: ReadonlyMap<string, Float32Array>;
}

export async function syncEmbeddings(languages: readonly EmbeddingLanguage[], options: { dryRun: boolean }) {
  const db = new Client({ connectionString: getMirrorDatabaseUrl() });
  await db.connect();
  const started = performance.now();
  try {
    for (const { language, rows, fresh } of languages) {
      const stored = new Map(
        (
          await db.query<{ card_id: string; image_key: string }>(
            'select card_id, image_key from public.tcg_card_embeddings where lang = $1 and model = $2',
            [language, EMBEDDING_MODEL],
          )
        ).rows.map((row) => [row.card_id, row.image_key]),
      );
      const plan = planEmbeddingSync(rows, stored, new Set(fresh.keys()));
      console.log(JSON.stringify({ db: language, stored: stored.size, upsert: plan.upsert.length, remove: plan.remove.length }));
      if (options.dryRun) continue;
      const byId = new Map(rows.map((row) => [row.id, row]));
      for (let start = 0; start < plan.upsert.length; start += BATCH) {
        const ids = plan.upsert.slice(start, start + BATCH);
        const vectors = ids.map((id) => {
          const vector = fresh.get(id) ?? (byId.get(id)?.vector && dequantizeInt8(byId.get(id)!.vector!));
          if (!vector) throw new Error(`${language} ${id}: no vector to write`);
          return toVectorLiteral(vector);
        });
        await db.query(
          `insert into public.tcg_card_embeddings (card_id, lang, model, embedding, image_key, updated_at)
           select t.card_id, $1, $2, t.embedding::extensions.halfvec, t.image_key, now()
             from unnest($3::text[], $4::text[], $5::text[]) as t(card_id, embedding, image_key)
           on conflict (card_id, lang, model) do update
             set embedding = excluded.embedding, image_key = excluded.image_key, updated_at = now()`,
          [language, EMBEDDING_MODEL, ids, vectors, ids.map((id) => byId.get(id)!.key)],
        );
      }
      if (plan.remove.length)
        await db.query('delete from public.tcg_card_embeddings where lang = $1 and model = $2 and card_id = any($3)', [
          language,
          EMBEDDING_MODEL,
          plan.remove,
        ]);
    }
  } finally {
    await db.end();
  }
  console.log(JSON.stringify({ dbSeconds: Number(((performance.now() - started) / 1000).toFixed(1)) }));
}
