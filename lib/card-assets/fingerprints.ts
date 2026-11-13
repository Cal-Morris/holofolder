/**
 * Card image fingerprints: one DINOv3 vector per card and language, built by `bun run card-assets fingerprints` from
 * the images mirrored in R2, so a phone can recognise a card by its picture. Pure logic only (no model, no I/O).
 *
 * Published layout under `pokemon/tcg/fingerprints/v1/<model slug>/` (content-hashed names, cached forever, except
 * the manifest):
 *   manifest.json                   current files per language, model, dtype, dimension, quantisation, build time
 *   <lang>-<hash>.bin               N × 384 int8, row i is card ids[i]
 *   <lang>-<hash>.ids.json          ["sv01-001", …]
 *   <lang>-<hash>.sources.json      [[objectKey, etag], …] the image each row was built from (build-side only)
 */
import { ONNX_RUNTIME_VERSION } from '../card-picture-fingerprint';
import { createHash } from 'node:crypto';
import { getSourceImageLowPathname, parseSourceCardImageUrl, pickCardImageUrl } from '../card-image-sources';
import { CARD_ASSET_ROOT, CARD_IMAGE_EXTENSIONS, getCardImageBlobPathname } from '../tcgdex-card-image';
import { buildTcgdexAssetImageUrl, pickImageLanguage } from '../tcgdex-shared';

export const FINGERPRINT_MODEL = {
  id: 'onnx-community/dinov3-vits16-pretrain-lvd1689m-ONNX',
  slug: 'dinov3-vits16-q8',
  dtype: 'q8',
  dim: 384,
} as const;
export const FINGERPRINT_FORMAT_VERSION = 1;
export const FINGERPRINT_PREFIX = `${CARD_ASSET_ROOT}/fingerprints/v${FINGERPRINT_FORMAT_VERSION}/${FINGERPRINT_MODEL.slug}`;

export interface FingerprintCard {
  id: string;
  set_id: string;
  series_id: string;
  local_id: string;
  name_json: unknown;
  image_languages_json: unknown;
  external_ids_json: unknown;
}

/** One gallery row: the card, the R2 object it was built from (key plus ETag), and its int8 vector. */
export interface FingerprintEntry {
  id: string;
  key: string;
  etag: string;
  vector: Int8Array;
}

export interface FingerprintLanguageFiles {
  count: number;
  vectors: string;
  ids: string;
  sources: string;
  bytes: number;
}

export interface FingerprintManifest {
  version: typeof FINGERPRINT_FORMAT_VERSION;
  model: { id: string; dtype: string; dim: number };
  preprocessing: string;
  quantization: string;
  /** FINGERPRINT_RUNTIME; absent in indexes built with onnxruntime-node through Transformers.js. */
  runtime?: string;
  builtAt: string;
  languages: Record<string, FingerprintLanguageFiles>;
}

export const FINGERPRINT_PREPROCESSING =
  'lib/card-picture-fingerprint.ts on the stored low rendition (about 245 × 342 WebP; the high one when no low ' +
  'exists), decoded with sharp: the model’s own image processor (224 × 224 bilinear, ImageNet mean and std), then ' +
  'the CLS token (first 384 values of the last hidden state), L2-normalised. Queries go through exactly the same steps.';
/**
 * What computed the fingerprints. The int8 kernels differ slightly between onnxruntime builds (cosine 0.97-0.999 for
 * the same input), so a manifest built by another runtime is rebuilt from scratch rather than resumed.
 */
export const FINGERPRINT_RUNTIME = `onnxruntime-web ${ONNX_RUNTIME_VERSION} wasm, single thread`;
export const FINGERPRINT_QUANTIZATION =
  'int8, symmetric per vector: q = round(x / max|x| × 127). Rows have different scales, so rank by cosine: ' +
  'dot(query, row) / |row| (precompute each row’s norm once).';

function nameLanguages(card: FingerprintCard) {
  const names = card.name_json;
  return names && typeof names === 'object' && !Array.isArray(names) ? Object.keys(names) : [];
}

/** True when the card was printed in `language` (TCGdex names it in that language). */
export function isPrintedIn(card: FingerprintCard, language: string) {
  return nameLanguages(card).includes(language);
}

/** The image URL the app shows for this card in `language` (same call as lib/tcg-mirror.ts). */
export function appImageUrl(card: FingerprintCard, language: string) {
  const imageLanguage = pickImageLanguage(card.image_languages_json, language);
  return (
    pickCardImageUrl(
      card.external_ids_json,
      imageLanguage,
      imageLanguage && buildTcgdexAssetImageUrl(imageLanguage, card.series_id, card.set_id, card.local_id),
      language,
    ) ?? null
  );
}

function tcgdexKeys(language: string, setId: string, localId: string) {
  return (['low', 'high'] as const).flatMap((quality) =>
    CARD_IMAGE_EXTENSIONS.map((extension) => getCardImageBlobPathname({ language, setId, localId, quality, extension })),
  );
}

/**
 * The R2 objects that may hold this card's reference picture in `language`, best first. The TCGdex print in that
 * language comes first (a scan of the printed card, which is what a camera sees; the measurements in the
 * card-recognition plan were made against it). For English, the fallback-source image the app shows follows, for
 * cards TCGdex has no English print of. Never a print in another language.
 */
export function fingerprintImageKeys(card: FingerprintCard, language: string): string[] {
  const keys = tcgdexKeys(language, card.set_id, card.local_id);
  if (language !== 'en') return keys;
  const url = appImageUrl(card, language);
  const source = url ? parseSourceCardImageUrl(url) : null;
  if (!source) return keys;
  const low = getSourceImageLowPathname(source.pathname);
  return [...keys, ...(low ? [low] : []), source.pathname];
}

/** The first candidate key the bucket holds, or null. */
export function pickStoredKey(candidates: readonly string[], stored: ReadonlySet<string>) {
  return candidates.find((key) => stored.has(key)) ?? null;
}

/** Per-vector symmetric int8. A zero vector stays zero. */
export function quantizeInt8(vector: ArrayLike<number>) {
  let max = 0;
  for (let i = 0; i < vector.length; i++) max = Math.max(max, Math.abs(vector[i]));
  const out = new Int8Array(vector.length);
  if (!max) return out;
  for (let i = 0; i < vector.length; i++) out[i] = Math.round((vector[i] / max) * 127);
  return out;
}

export function l2Normalize(vector: ArrayLike<number>) {
  let sum = 0;
  for (let i = 0; i < vector.length; i++) sum += vector[i] * vector[i];
  const norm = Math.sqrt(sum) || 1;
  return Float32Array.from(vector, (value) => value / norm);
}

/** Cosine similarity, the comparison the manifest asks for (works for float and int8 rows alike). */
export function cosine(a: ArrayLike<number>, b: ArrayLike<number>) {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

export interface WantedImage {
  id: string;
  key: string;
}

/**
 * Decides an incremental run for one language. A previous row is kept when the card still wants the same object and,
 * when `etags` knows the object's current ETag, the ETag still matches. Cards outside `inScope` keep their previous
 * row as long as they still want an image, so `--set` never drops other sets. Everything else in scope is embedded.
 */
export function planFingerprintUpdate(
  wanted: readonly WantedImage[],
  previous: readonly FingerprintEntry[],
  options: { inScope?: (id: string) => boolean; etags?: ReadonlyMap<string, string> } = {},
) {
  const before = new Map(previous.map((entry) => [entry.id, entry]));
  const keep: FingerprintEntry[] = [];
  const embed: WantedImage[] = [];
  for (const want of wanted) {
    const old = before.get(want.id);
    const inScope = options.inScope?.(want.id) ?? true;
    if (old && !inScope) keep.push(old);
    else if (old && old.key === want.key && (options.etags?.get(old.key) ?? old.etag) === old.etag) keep.push(old);
    else if (inScope) embed.push(want);
  }
  const wantedIds = new Set(wanted.map((want) => want.id));
  const dropped = previous.flatMap((entry) => (wantedIds.has(entry.id) ? [] : [entry.id]));
  return { keep, embed, dropped };
}

/** Serialises one language's rows (sorted by card id) into the published files, named by their content hash. */
export function encodeFingerprintFiles(language: string, entries: readonly FingerprintEntry[], dim: number) {
  const rows = entries.toSorted((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const vectors = new Uint8Array(rows.length * dim);
  rows.forEach((row, index) => {
    if (row.vector.length !== dim) throw new Error(`${row.id}: vector has ${row.vector.length} values, not ${dim}`);
    vectors.set(new Uint8Array(row.vector.buffer, row.vector.byteOffset, dim), index * dim);
  });
  const ids = JSON.stringify(rows.map((row) => row.id));
  const sources = JSON.stringify(rows.map((row) => [row.key, row.etag]));
  const hash = createHash('sha256').update(vectors).update('\n').update(ids).update('\n').update(sources);
  const name = `${language}-${hash.digest('hex').slice(0, 16)}`;
  const files = {
    [`${name}.bin`]: vectors,
    [`${name}.ids.json`]: new TextEncoder().encode(ids),
    [`${name}.sources.json`]: new TextEncoder().encode(sources),
  };
  const info: FingerprintLanguageFiles = {
    count: rows.length,
    vectors: `${name}.bin`,
    ids: `${name}.ids.json`,
    sources: `${name}.sources.json`,
    bytes: vectors.byteLength + files[`${name}.ids.json`].byteLength,
  };
  return { info, files };
}

/** Reads one language's published files back into rows; throws when they don't line up. */
export function decodeFingerprintFiles(vectors: Uint8Array, idsJson: string, sourcesJson: string, dim: number) {
  const ids: unknown = JSON.parse(idsJson);
  const sources: unknown = JSON.parse(sourcesJson);
  if (!Array.isArray(ids) || !Array.isArray(sources) || ids.length !== sources.length)
    throw new Error('Fingerprint ids and sources differ in length');
  if (vectors.byteLength !== ids.length * dim) throw new Error('Fingerprint vectors do not match the ids');
  return ids.map((id, index): FingerprintEntry => {
    const source: unknown = sources[index];
    if (
      typeof id !== 'string' ||
      !Array.isArray(source) ||
      typeof source[0] !== 'string' ||
      typeof source[1] !== 'string'
    )
      throw new Error(`Fingerprint row ${index} is malformed`);
    const start = vectors.byteOffset + index * dim;
    return { id, key: source[0], etag: source[1], vector: new Int8Array(vectors.buffer.slice(start, start + dim)) };
  });
}

export function buildFingerprintManifest(
  languages: Record<string, FingerprintLanguageFiles>,
  builtAt: Date,
): FingerprintManifest {
  return {
    version: FINGERPRINT_FORMAT_VERSION,
    model: { id: FINGERPRINT_MODEL.id, dtype: FINGERPRINT_MODEL.dtype, dim: FINGERPRINT_MODEL.dim },
    preprocessing: FINGERPRINT_PREPROCESSING,
    quantization: FINGERPRINT_QUANTIZATION,
    runtime: FINGERPRINT_RUNTIME,
    builtAt: builtAt.toISOString(),
    languages: Object.fromEntries(Object.entries(languages).sort(([a], [b]) => a.localeCompare(b))),
  };
}

/** Validates a manifest read from disk or R2; null when it isn't one this code wrote for the current model. */
export function parseFingerprintManifest(value: unknown): FingerprintManifest | null {
  if (!value || typeof value !== 'object') return null;
  const manifest = value as FingerprintManifest;
  if (manifest.version !== FINGERPRINT_FORMAT_VERSION) return null;
  if (manifest.model?.id !== FINGERPRINT_MODEL.id || manifest.model.dim !== FINGERPRINT_MODEL.dim) return null;
  if (!manifest.languages || typeof manifest.languages !== 'object') return null;
  const name = /^[a-z]{2}(?:-[a-z]{2})?-[0-9a-f]{16}\.(?:bin|ids\.json|sources\.json)$/;
  for (const files of Object.values(manifest.languages)) {
    if (![files.vectors, files.ids, files.sources].every((file) => typeof file === 'string' && name.test(file)))
      return null;
  }
  return manifest;
}
