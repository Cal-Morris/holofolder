/**
 * Pure helpers for `card-assets fingerprints --db`, which mirrors the fingerprint index into
 * public.tcg_card_embeddings (migration 116) so the server can run similarity search. No I/O here.
 */
import { FINGERPRINT_MODEL } from './fingerprints';

/** The `model` column value: one row per card, language and model, so a future model can sit alongside. */
export const EMBEDDING_MODEL = FINGERPRINT_MODEL.slug;

/** Undoes the index's symmetric per-vector int8 quantisation, L2-normalised (cosine only needs the direction). */
export function dequantizeInt8(vector: Int8Array) {
  const out = new Float32Array(vector.length);
  let norm = 0;
  for (let i = 0; i < vector.length; i++) norm += vector[i] * vector[i];
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < vector.length; i++) out[i] = vector[i] / norm;
  return out;
}

/** pgvector's text form, `[0.1,-0.2,…]`, rounded to halfvec precision so batches stay small. */
export function toVectorLiteral(vector: ArrayLike<number>) {
  let text = '[';
  for (let i = 0; i < vector.length; i++) text += (i ? ',' : '') + Number(vector[i].toPrecision(5));
  return `${text}]`;
}

/**
 * What to write for one language. `index` is every row the index holds after this run (card id and image key);
 * `stored` maps card id to the image key the table holds; `changed` names cards embedded again this run, which are
 * written even when their key is unchanged (their ETag moved). A re-run with nothing changed writes nothing.
 */
export function planEmbeddingSync(
  index: ReadonlyArray<{ id: string; key: string }>,
  stored: ReadonlyMap<string, string>,
  changed: ReadonlySet<string> = new Set(),
) {
  const upsert = index.flatMap((row) => (changed.has(row.id) || stored.get(row.id) !== row.key ? [row.id] : []));
  const ids = new Set(index.map((row) => row.id));
  const remove = [...stored.keys()].filter((id) => !ids.has(id));
  return { upsert, remove };
}
