import { recordMirroredCardImages } from '../lib/card-image-inventory';
/**
 * Local backfill of card images (TCGdex plus the fallback sources in lib/card-image-sources.ts) into the card image
 * store (Cloudflare R2), without going through a
 * Vercel deployment. Uses the same mirror/backfill code as /api/admin/mirror-card-images.
 *
 *   bun scripts/mirror-card-images.ts [--set a,b] [--from <setId>] [--lang en] [--quality high,low]
 *                                     [--concurrency 8] [--max-class-a 200000] [--max-gb 8]
 *
 * Env (e.g. from `vercel env pull` into a temp file + an R2 API token): CARD_IMAGE_STORE=r2, R2_ACCOUNT_ID,
 * R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET, R2_PUBLIC_BASE_URL, SUPABASE_SERVICE_ROLE_KEY
 * (to record confirmed images), and for the card list either
 * NEXT_PUBLIC_SUPABASE_URL + NEXT_PUBLIC_SUPABASE_ANON_KEY (public read via PostgREST over HTTPS, preferred) or
 * POSTGRES_URL_NON_POOLING (direct Postgres).
 *
 * Resumable and idempotent: objects already in the bucket are skipped (one LIST per set and language), uploads never
 * overwrite. Transient TCGdex/R2 errors (network, 429, 5xx) are retried with exponential backoff. Stops before the
 * Class A operation or storage budget is exceeded. Prints only set ids and counts.
 */
import { Client } from 'pg';
import { getMirrorDatabaseUrl } from '../lib/card-db-sync';
import { mirrorSetImages, parseImageLanguages, type MirrorableCard } from '../lib/card-image-backfill';
import { createCardImageMirror, type CardImageQuality } from '../lib/card-image-blob';
import { createR2Deps, getR2Config } from '../lib/card-image-r2';
import { getCardImageStoreKind } from '../lib/card-image-store';
import { convertSourceImageToWebp } from '../lib/card-image-transform';
import { loadProjectEnvFiles } from '../lib/load-project-env';

function arg(name: string) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function list(value: string | undefined) {
  return (value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const RETRYABLE = new Set([408, 425, 429, 500, 502, 503, 504]);

export class BudgetExceededError extends Error {}

/** fetch with retry/backoff plus Class A / byte accounting for R2 free-tier safety. */
export function createPoliteFetch(options: {
  maxClassA: number;
  maxBytes: number;
  endpointPrefix: string;
  attempts?: number;
}) {
  const stats = { classA: 0, classB: 0, bytesUploaded: 0, retries: 0 };
  const attempts = options.attempts ?? 5;

  const politeFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
    const isR2 = url.startsWith(options.endpointPrefix);
    const isClassA = isR2 && (method === 'PUT' || url.includes('list-type=2'));
    const bodyBytes = init?.body instanceof ArrayBuffer ? init.body.byteLength : 0;

    if (isClassA && stats.classA >= options.maxClassA)
      throw new BudgetExceededError(`Class A budget of ${options.maxClassA} reached`);
    if (bodyBytes && stats.bytesUploaded + bodyBytes > options.maxBytes)
      throw new BudgetExceededError('storage budget reached');

    for (let attempt = 1; ; attempt += 1) {
      if (isClassA) stats.classA += 1;
      else if (isR2) stats.classB += 1;
      try {
        const response = await fetch(input, init);
        if (RETRYABLE.has(response.status) && attempt < attempts) {
          stats.retries += 1;
          const retryAfter = Number(response.headers.get('retry-after'));
          await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 500 * 2 ** (attempt - 1));
          continue;
        }
        if (isR2 && method === 'PUT' && response.ok) stats.bytesUploaded += bodyBytes;
        return response;
      } catch (error) {
        if (attempt >= attempts) throw error;
        stats.retries += 1;
        await sleep(500 * 2 ** (attempt - 1));
      }
    }
  }) as typeof fetch;

  return { politeFetch, stats };
}

interface CardSource {
  setIds(): Promise<string[]>;
  cards(setId: string): Promise<MirrorableCard[]>;
  close(): Promise<void>;
}

interface CardRow {
  series_id: string;
  set_id: string;
  local_id: string;
  image_languages_json: unknown;
  tcgdex_image: string | null;
  external_ids_json: unknown;
}

function toMirrorable(row: CardRow): MirrorableCard {
  return {
    seriesId: row.series_id,
    setId: row.set_id,
    localId: row.local_id,
    imageLanguages: parseImageLanguages(row.image_languages_json),
    tcgdexImageUrl: row.tcgdex_image,
    externalIds: row.external_ids_json,
  };
}

/** Public catalogue tables via Supabase PostgREST (anon key; same data the app reads). */
function createRestCardSource(baseUrl: string, anonKey: string): CardSource {
  const headers = { apikey: anonKey, Authorization: `Bearer ${anonKey}` };
  async function getAll<T>(path: string): Promise<T[]> {
    const rows: T[] = [];
    for (let offset = 0; ; offset += 1000) {
      const response = await fetch(`${baseUrl.replace(/\/$/, '')}/rest/v1/${path}`, {
        headers: { ...headers, Range: `${offset}-${offset + 999}` },
      });
      if (!response.ok) throw new Error(`Supabase REST ${response.status} for ${path.split('?')[0]}`);
      const page = (await response.json()) as T[];
      rows.push(...page);
      if (page.length < 1000) return rows;
    }
  }
  return {
    async setIds() {
      return (await getAll<{ id: string }>('tcg_sets?select=id&order=id')).map((row) => row.id);
    },
    async cards(setId) {
      const select =
        'series_id,set_id,local_id,image_languages_json,tcgdex_image:external_ids_json->tcgdex->>image,external_ids_json';
      return (
        await getAll<CardRow>(`tcg_cards?select=${select}&set_id=eq.${encodeURIComponent(setId)}&order=local_id`)
      ).map(toMirrorable);
    },
    async close() {},
  };
}

async function createPgCardSource(): Promise<CardSource> {
  const client = new Client({ connectionString: getMirrorDatabaseUrl() });
  await client.connect();
  return {
    async setIds() {
      return (await client.query<{ id: string }>('select id from public.tcg_sets order by id')).rows.map(
        (row) => row.id,
      );
    },
    async cards(setId) {
      const result = await client.query<CardRow>(
        "select series_id, set_id, local_id, image_languages_json, external_ids_json->'tcgdex'->>'image' as tcgdex_image, external_ids_json from public.tcg_cards where set_id = $1",
        [setId],
      );
      return result.rows.map(toMirrorable);
    },
    close: () => client.end(),
  };
}

async function main() {
  await loadProjectEnvFiles();
  if (getCardImageStoreKind() !== 'r2') {
    throw new Error('Set CARD_IMAGE_STORE=r2 and the R2_* variables (this script only targets R2)');
  }
  const config = getR2Config()!;
  const concurrency = Number(arg('concurrency') ?? 8);
  const { politeFetch, stats } = createPoliteFetch({
    maxClassA: Number(arg('max-class-a') ?? 200_000),
    maxBytes: Number(arg('max-gb') ?? 8) * 1024 ** 3,
    endpointPrefix: `https://${config.accountId}.r2.cloudflarestorage.com/`,
  });
  const mirror = createCardImageMirror({
    ...createR2Deps(config, { fetch: politeFetch, onObjects: (keys) => recordMirroredCardImages(config.bucket, keys) }),
    logger: (message) => console.warn(`[mirror] ${message}`),
    transformSourceImage: convertSourceImageToWebp,
  });

  const languages = list(arg('lang')).length ? list(arg('lang')) : ['en'];
  const qualities = (list(arg('quality')).length ? list(arg('quality')) : ['high', 'low']) as CardImageQuality[];
  const from = arg('from') ?? null;

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
  const source = supabaseUrl && anonKey ? createRestCardSource(supabaseUrl, anonKey) : await createPgCardSource();
  const requested = new Set(list(arg('set')));
  const setIds = (await source.setIds()).filter(
    (id) => (!requested.size || requested.has(id)) && (!from || id >= from),
  );

  const startedAt = Date.now();
  const totals = { sets: 0, planned: 0, alreadyMirrored: 0, uploaded: 0, failed: 0 };
  const incomplete: Array<{ setId: string; failed: number; errors?: string[] }> = [];
  console.log(
    `[mirror] ${setIds.length} sets, languages ${languages.join(',')}, qualities ${qualities.join(',')}, concurrency ${concurrency}`,
  );

  for (const setId of setIds) {
    let last;
    for (let pass = 1; pass <= 3; pass += 1) {
      if (mirror.isBlobBlocked()) await sleep(60_000);
      last = await mirrorSetImages(mirror, setId, await source.cards(setId), { languages, qualities, concurrency });
      if (pass === 1 && last) {
        totals.planned += last.planned;
        totals.alreadyMirrored += last.alreadyMirrored;
      }
      if (last) totals.uploaded += last.uploaded;
      if (!last || last.complete) break;
    }
    totals.sets += 1;
    if (last && !last.complete) {
      totals.failed += last.failed;
      incomplete.push({ setId, failed: last.failed, errors: last.errors });
    }
    console.log(
      `[mirror] ${setId}: planned ${last?.planned ?? 0}, existing ${last?.alreadyMirrored ?? 0}, uploaded ${last?.uploaded ?? 0}, failed ${last?.failed ?? 0}` +
        ` | total uploaded ${totals.uploaded}, ${(stats.bytesUploaded / 1024 ** 2).toFixed(1)} MB, classA ${stats.classA}`,
    );
  }

  await source.close();
  console.log(
    JSON.stringify(
      { ...totals, incomplete, ...stats, durationSeconds: Math.round((Date.now() - startedAt) / 1000) },
      null,
      2,
    ),
  );
  if (incomplete.length) process.exitCode = 2;
}

if (import.meta.main) {
  main().catch((error) => {
    console.error('[mirror] Failed:', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
