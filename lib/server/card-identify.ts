import 'server-only';
import * as ort from 'onnxruntime-web/wasm';
import sharp from 'sharp';
import { createAdminClient } from '@/lib/supabase/admin';
import { createCardFingerprinter, PICTURE_MODEL_BASE_URL, PICTURE_MODEL_FILES } from '@/lib/card-picture-fingerprint';
import { EMBEDDING_MODEL, toVectorLiteral } from '@/lib/card-assets/embeddings-db';
import { DeveloperAccessError } from '@/lib/developer-api/permissions';
import { IDENTIFY_SEARCH_K } from '@/lib/card-identify';
import type { PictureMatch } from '@/lib/card-picture-match';

/**
 * Fingerprints a photo with the same module, model and WASM runtime as the scan worker in the browser
 * (lib/card-picture-fingerprint.ts on onnxruntime-web), then finds the nearest cards in tcg_card_embeddings
 * (identify_tcg_cards, migration 117). The 22 MB model and the runtime are fetched from R2 once per warm instance and
 * kept in memory; nothing is bundled. One image at a time per instance: the WASM session runs one inference at a time.
 */
let fingerprinter: ReturnType<typeof loadFingerprinter> | null = null;
let queue: Promise<unknown> = Promise.resolve();

async function download(name: string) {
  // no-store: the files are larger than Next's data cache allows, and the instance keeps them in memory anyway.
  const response = await fetch(`${PICTURE_MODEL_BASE_URL}${name}`, { cache: 'no-store' });
  if (!response.ok) throw new Error(`${name}: HTTP ${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
}

async function loadFingerprinter() {
  const [runtime, model, modelData] = await Promise.all(
    (['runtime', 'model', 'modelData'] as const).map((file) => download(PICTURE_MODEL_FILES[file])),
  );
  return createCardFingerprinter(ort, { runtime, model, modelData });
}

/** Decodes like the index build (sharp, EXIF orientation applied, no colour management). Big photos are shrunk first. */
async function decode(image: Uint8Array) {
  try {
    const { data, info } = await sharp(image, { limitInputPixels: 50_000_000 })
      .rotate()
      .resize({ width: 1024, height: 1024, fit: 'inside', withoutEnlargement: true })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    return { data, width: info.width, height: info.height };
  } catch {
    throw new DeveloperAccessError('invalid_image', 'image could not be read as a JPEG, PNG or WebP picture.', 400);
  }
}

export async function identifyCardPicture(image: Uint8Array, languages: readonly string[] | null) {
  const started = performance.now();
  const pixels = await decode(image);
  const decoded = performance.now();
  fingerprinter ??= loadFingerprinter().catch((error: unknown) => {
    fingerprinter = null;
    throw error;
  });
  const fingerprint = await fingerprinter;
  const run = queue.then(() => fingerprint(pixels.data, pixels.width, pixels.height));
  queue = run.catch(() => undefined);
  const vector = await run;
  const embedded = performance.now();
  const { data, error } = await createAdminClient().rpc('identify_tcg_cards', {
    p_embedding: toVectorLiteral(vector),
    p_model: EMBEDDING_MODEL,
    p_langs: languages ? [...languages] : null,
    p_limit: IDENTIFY_SEARCH_K,
  });
  if (error) throw new DeveloperAccessError('temporarily_unavailable', 'Card identification is unavailable.', 503);
  const matches: PictureMatch[] = ((data ?? []) as Array<{ card_id: string; lang: string; similarity: number }>).map(
    (row) => ({ id: row.card_id, language: row.lang, score: row.similarity }),
  );
  const ms = {
    decode: Math.round(decoded - started),
    embed: Math.round(embedded - decoded),
    search: Math.round(performance.now() - embedded),
  };
  return { matches, ms };
}
