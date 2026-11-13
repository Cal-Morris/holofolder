/**
 * bun run card-assets fingerprints [--lang en,ja] [--set a,b] [--dry-run] [--report] [--recheck] [--publish]
 *                                  [--out .cache/card-fingerprints] [--concurrency 16] [--workers N]
 *
 * Builds the picture-matching index: one DINOv3 ViT-S/16 fingerprint per card and language from the images mirrored
 * in R2 (see lib/card-assets/fingerprints.ts for the file format). Incremental: it resumes from the local output
 * folder, or from the published manifest when that folder is empty, and only embeds cards that are new or whose
 * image object changed (another key, or with --recheck another ETag). --set limits embedding to those sets; other
 * sets keep their rows.
 *
 * Reads Postgres (cards and card_image_inventory, read-only) and the images over R2_PUBLIC_BASE_URL (one Class B
 * read per embedded card, none for unchanged ones; --recheck adds one HEAD per card). Writes only --out unless
 * --publish, which uploads the changed language files and the manifest: at most 3 Class A writes per changed
 * language plus 1. --publish needs CARD_IMAGE_STORE=r2 and the app's R2_* variables.
 *
 * --db also mirrors the index into public.tcg_card_embeddings (see fingerprints-db.ts): new or changed cards only,
 * so a re-run with nothing changed writes nothing, and an empty table is backfilled from the index without
 * embedding again. With --dry-run it only reports what it would write.
 *
 * Fingerprints come from lib/card-picture-fingerprint.ts on onnxruntime-web's WASM build, the code the scan worker and
 * the server matcher run, in --workers Node processes (fingerprint-worker.mjs; default half the CPUs). An index built
 * by another runtime (FINGERPRINT_RUNTIME) is rebuilt from scratch, and with --db every row is rewritten.
 */
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { Client } from 'pg';
import {
  buildFingerprintManifest,
  decodeFingerprintFiles,
  encodeFingerprintFiles,
  FINGERPRINT_MODEL,
  FINGERPRINT_PREFIX,
  FINGERPRINT_RUNTIME,
  fingerprintImageKeys,
  isPrintedIn,
  parseFingerprintManifest,
  pickStoredKey,
  planFingerprintUpdate,
  quantizeInt8,
  type FingerprintCard,
  type FingerprintEntry,
  type FingerprintLanguageFiles,
  type FingerprintManifest,
  type WantedImage,
} from '../../lib/card-assets/fingerprints';
import { getMirrorDatabaseUrl } from '../../lib/card-db-sync';
import { PICTURE_MODEL_BASE_URL, PICTURE_MODEL_FILES } from '../../lib/card-picture-fingerprint';
import { createR2Deps, getR2BucketEndpoint, getR2Config, normalizePublicBaseUrl } from '../../lib/card-image-r2';
import { loadProjectEnvFiles } from '../../lib/load-project-env';
import { createPoliteFetch } from './mirror-tcgdex';
import { syncEmbeddings, type EmbeddingLanguage } from './fingerprints-db';

function arg(name: string) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}
const flag = (name: string) => process.argv.includes(`--${name}`);
const list = (value: string | undefined) =>
  (value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

const CHECKPOINT_EVERY = 2000;

type Previous = { manifest: FingerprintManifest | null; read: (file: string) => Promise<Uint8Array> };

export async function run() {
  await loadProjectEnvFiles();
  const languages = list(arg('lang') ?? 'en,ja');
  const sets = list(arg('set'));
  const dryRun = flag('dry-run');
  const publish = flag('publish');
  const out = path.resolve(arg('out') ?? '.cache/card-fingerprints');
  const concurrency = Math.max(1, Number(arg('concurrency') ?? 16));
  const workers = Math.max(1, Number(arg('workers') ?? Math.ceil(availableParallelism() / 2)));
  if (!languages.every((language) => /^[a-z]{2}(?:-[a-z]{2})?$/.test(language)))
    throw new Error('--lang takes language codes, e.g. en,ja');
  const bucket = process.env.R2_BUCKET?.trim() || 'holofolder-assets';
  const publicBase = normalizePublicBaseUrl(process.env.R2_PUBLIC_BASE_URL) ?? 'https://assets.holofolder.com/';
  const r2 = publish ? getR2Config() : null;
  if (publish && (!r2 || process.env.CARD_IMAGE_STORE !== 'r2'))
    throw new Error('--publish needs CARD_IMAGE_STORE=r2 and the R2_* variables');
  if (publish && dryRun) throw new Error('--publish and --dry-run together make no sense');

  const { politeFetch, stats } = createPoliteFetch({
    maxClassA: 0,
    maxBytes: 0,
    endpointPrefix: publicBase,
  });

  const { cards, stored } = await readDatabase(bucket);
  const previous = await loadPrevious(out, publicBase, politeFetch);
  const setById = new Map(cards.map((card) => [card.id, card.set_id]));
  const scope = sets.length ? (id: string) => sets.includes(setById.get(id) ?? '') : undefined;

  if (flag('report')) await report(cards, stored, languages, out);

  const plans = new Map<string, ReturnType<typeof planFingerprintUpdate>>();
  for (const language of languages) {
    const wanted: WantedImage[] = [];
    for (const card of cards) {
      if (!isPrintedIn(card, language)) continue;
      const key = pickStoredKey(fingerprintImageKeys(card, language), stored);
      if (key) wanted.push({ id: card.id, key });
    }
    const before = await readLanguage(previous, language);
    const etags = flag('recheck') ? await headEtags(wanted.filter((want) => scope?.(want.id) ?? true), publicBase, politeFetch, concurrency) : undefined;
    const plan = planFingerprintUpdate(wanted, before, { inScope: scope, etags });
    plans.set(language, plan);
    console.log(
      JSON.stringify({
        language,
        withImage: wanted.length,
        previous: before.length,
        keep: plan.keep.length,
        embed: plan.embed.length,
        dropped: plan.dropped.length,
      }),
    );
  }
  const db = flag('db');
  if (dryRun) {
    if (db)
      await syncEmbeddings(
        languages.map((language) => {
          const plan = plans.get(language)!;
          return {
            language,
            rows: [...plan.keep, ...plan.embed],
            fresh: new Map(plan.embed.map((want) => [want.id, new Float32Array()])),
          };
        }),
        { dryRun },
      );
    return;
  }

  const languageFiles: Record<string, FingerprintLanguageFiles> = Object.fromEntries(
    Object.entries(previous.manifest?.languages ?? {}).filter(([language]) => !languages.includes(language)),
  );
  // Languages this run doesn't build keep their files: copy them into the local folder when resuming from R2.
  for (const files of Object.values(languageFiles))
    for (const file of [files.vectors, files.ids, files.sources])
      await writeFile(path.join(await ensureDir(out), file), await previous.read(file));

  const embedder = [...plans.values()].some((plan) => plan.embed.length) ? await loadEmbedder(workers) : null;
  const started = performance.now();
  let embedded = 0;
  const failures: string[] = [];
  const dbLanguages: EmbeddingLanguage[] = [];
  try {
    for (const language of languages) {
      const plan = plans.get(language)!;
      const rows = [...plan.keep];
      const fresh = new Map<string, Float32Array>();
      dbLanguages.push({ language, rows, fresh });
      let saving = Promise.resolve();
      const save = () =>
        (saving = saving.then(async () => {
          const { info, files } = encodeFingerprintFiles(language, rows, FINGERPRINT_MODEL.dim);
          languageFiles[language] = info;
          await writeLocal(out, buildFingerprintManifest(languageFiles, new Date()), files);
        }));
      // `concurrency` downloads in flight; each image then waits for a free worker process.
      const embedOne = async (want: WantedImage) => {
        try {
          const response = await politeFetch(`${publicBase}${want.key}`);
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          const etag = (response.headers.get('etag') ?? '').replaceAll('"', '');
          const vector = await embedder!.embed(new Uint8Array(await response.arrayBuffer()));
          rows.push({ id: want.id, key: want.key, etag, vector: quantizeInt8(vector) });
          if (db) fresh.set(want.id, vector);
        } catch (error) {
          failures.push(`${language} ${want.id}: ${error instanceof Error ? error.message : String(error)}`);
          return;
        }
        embedded++;
        if (embedded % 500 === 0)
          console.log(
            `embedded ${embedded} (${((performance.now() - started) / embedded).toFixed(1)} ms/card), ${language} ${rows.length - plan.keep.length}/${plan.embed.length}`,
          );
        if (embedded % CHECKPOINT_EVERY === 0) await save();
      };
      let next = 0;
      await Promise.all(
        Array.from({ length: concurrency }, async () => {
          while (next < plan.embed.length) await embedOne(plan.embed[next++]);
        }),
      );
      await save();
    }
  } finally {
    embedder?.close();
  }

  const manifest = JSON.parse(await readFile(path.join(out, 'manifest.json'), 'utf8')) as FingerprintManifest;
  console.log(
    JSON.stringify(
      {
        out,
        embedded,
        msPerCard: embedded ? Number(((performance.now() - started) / embedded).toFixed(1)) : null,
        failures: failures.length,
        firstFailures: failures.slice(0, 20),
        languages: manifest.languages,
        imageReads: stats.classB,
      },
      null,
      2,
    ),
  );
  if (failures.length) process.exitCode = 1;
  if (db) await syncEmbeddings(dbLanguages, { dryRun: false });
  if (publish) await publishFiles(out, manifest, publicBase, r2!);
}

async function ensureDir(dir: string) {
  await mkdir(dir, { recursive: true });
  return dir;
}

async function readDatabase(bucket: string) {
  const db = new Client({ connectionString: getMirrorDatabaseUrl() });
  await db.connect();
  try {
    await db.query('begin read only');
    await db.query("set local statement_timeout = '120s'");
    const cards = (
      await db.query<FingerprintCard>(
        `select id, set_id, series_id, local_id, name_json, image_languages_json, external_ids_json
           from public.tcg_cards order by set_id, local_id_sort nulls last, local_id, id`,
      )
    ).rows;
    // What the bucket holds, as recorded by every mirror write: no R2 LIST needed.
    const stored = new Set(
      (
        await db.query<{ object_key: string }>(
          `select object_key from public.card_image_inventory where bucket = $1`,
          [bucket],
        )
      ).rows.map((row) => row.object_key),
    );
    return { cards, stored };
  } finally {
    await db.query('rollback').catch(() => {});
    await db.end();
  }
}

async function loadPrevious(out: string, publicBase: string, fetchImpl: typeof fetch): Promise<Previous> {
  const local = await readFile(path.join(out, 'manifest.json'), 'utf8').catch(() => null);
  if (local) {
    const manifest = parseFingerprintManifest(JSON.parse(local));
    if (!manifest) throw new Error(`${out}/manifest.json is not a ${FINGERPRINT_MODEL.slug} v1 manifest`);
    if (manifest.runtime !== FINGERPRINT_RUNTIME) return rebuildAll(`${out}/manifest.json`, manifest.runtime);
    return { manifest, read: async (file) => new Uint8Array(await readFile(path.join(out, file))) };
  }
  const base = `${publicBase}${FINGERPRINT_PREFIX}/`;
  const response = await fetchImpl(`${base}manifest.json`, { cache: 'no-store' });
  if (response.status === 404 || response.status === 403) return { manifest: null, read: () => Promise.reject() };
  if (!response.ok) throw new Error(`Published manifest: HTTP ${response.status}`);
  const manifest = parseFingerprintManifest(await response.json());
  if (!manifest) throw new Error('The published manifest is not one this script wrote');
  if (manifest.runtime !== FINGERPRINT_RUNTIME) return rebuildAll('the published manifest', manifest.runtime);
  return {
    manifest,
    read: async (file) => {
      const fileResponse = await fetchImpl(`${base}${file}`);
      if (!fileResponse.ok) throw new Error(`${file}: HTTP ${fileResponse.status}`);
      return new Uint8Array(await fileResponse.arrayBuffer());
    },
  };
}

function rebuildAll(where: string, runtime: string | undefined): Previous {
  console.log(`${where} was built by ${runtime ?? 'onnxruntime-node'}, not ${FINGERPRINT_RUNTIME}: embedding every card`);
  return { manifest: null, read: () => Promise.reject(new Error('no previous index')) };
}

async function readLanguage(previous: Previous, language: string): Promise<FingerprintEntry[]> {
  const files = previous.manifest?.languages[language];
  if (!files) return [];
  const [vectors, ids, sources] = await Promise.all([files.vectors, files.ids, files.sources].map(previous.read));
  const text = new TextDecoder();
  return decodeFingerprintFiles(vectors, text.decode(ids), text.decode(sources), FINGERPRINT_MODEL.dim);
}

async function headEtags(wanted: readonly WantedImage[], publicBase: string, fetchImpl: typeof fetch, concurrency: number) {
  const etags = new Map<string, string>();
  let next = 0;
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (next < wanted.length) {
        const { key } = wanted[next++];
        const response = await fetchImpl(`${publicBase}${key}`, { method: 'HEAD' });
        const etag = response.headers.get('etag');
        if (response.ok && etag) etags.set(key, etag.replaceAll('"', ''));
      }
    }),
  );
  return etags;
}

/** Fetches the model and runtime the app uses (lib/card-picture-fingerprint.ts) into a local cache, once. */
async function modelFolder() {
  const dir = await ensureDir(path.resolve('.cache/card-picture-model'));
  for (const name of Object.values(PICTURE_MODEL_FILES)) {
    if (existsSync(path.join(dir, name))) continue;
    const response = await fetch(`${PICTURE_MODEL_BASE_URL}${name}`);
    if (!response.ok) throw new Error(`${name}: HTTP ${response.status}`);
    await writeFile(path.join(dir, name), new Uint8Array(await response.arrayBuffer()));
  }
  return dir;
}

/**
 * `workers` Node processes running fingerprint-worker.mjs, each one image at a time on a single WASM thread (what
 * the browser does, so the numbers match exactly); an image goes to the process with the shortest queue.
 */
async function loadEmbedder(workers: number) {
  const dir = await modelFolder();
  const script = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fingerprint-worker.mjs');
  const waiting = new Map<number, { resolve: (vector: Float32Array) => void; reject: (error: Error) => void }>();
  const pool = Array.from({ length: workers }, () => {
    const child = spawn('node', ['--disable-warning=MODULE_TYPELESS_PACKAGE_JSON', script, dir], { stdio: ['pipe', 'pipe', 'inherit'] });
    const worker = { child, queued: 0 };
    child.on('exit', (code) => {
      if (code) for (const { reject } of waiting.values()) reject(new Error(`fingerprint worker exited with ${code}`));
    });
    void (async () => {
      for await (const line of createInterface({ input: child.stdout })) {
        const { n, vector, error } = JSON.parse(line) as { n: number; vector?: number[]; error?: string };
        worker.queued--;
        const pending = waiting.get(n);
        waiting.delete(n);
        if (vector) pending?.resolve(Float32Array.from(vector));
        else pending?.reject(new Error(error ?? 'no fingerprint'));
      }
    })();
    return worker;
  });
  let next = 0;
  return {
    embed(image: Uint8Array) {
      const n = next++;
      const worker = pool.reduce((best, candidate) => (candidate.queued < best.queued ? candidate : best));
      worker.queued++;
      return new Promise<Float32Array>((resolve, reject) => {
        waiting.set(n, { resolve, reject });
        worker.child.stdin.write(`${JSON.stringify({ n, image: Buffer.from(image).toString('base64') })}\n`);
      });
    },
    close() {
      for (const { child } of pool) child.stdin.end();
    },
  };
}

async function writeLocal(out: string, manifest: FingerprintManifest, files: Record<string, Uint8Array>) {
  await ensureDir(out);
  for (const [name, body] of Object.entries(files)) await writeFile(path.join(out, name), body);
  await writeFile(path.join(out, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  // Keep only what the manifest names (checkpoints leave superseded files behind).
  const keep = new Set(['manifest.json', ...Object.values(manifest.languages).flatMap((l) => [l.vectors, l.ids, l.sources])]);
  for (const name of await readdir(out))
    if (!keep.has(name) && /\.(?:bin|json)$/.test(name) && name !== 'coverage.json') await rm(path.join(out, name));
}

async function publishFiles(
  out: string,
  manifest: FingerprintManifest,
  publicBase: string,
  config: NonNullable<ReturnType<typeof getR2Config>>,
) {
  const deps = createR2Deps(config);
  const endpoint = `${getR2BucketEndpoint(config)}${FINGERPRINT_PREFIX}/`;
  // Ask the bucket, not a manifest: the previous manifest may come from the local build folder, which names files
  // that were never uploaded. One HEAD (Class B) per file; content-hashed names make "exists" mean "identical".
  const isPublished = async (name: string) =>
    (await fetch(`${publicBase}${FINGERPRINT_PREFIX}/${name}`, { method: 'HEAD' })).ok;
  const put = async (name: string, cacheControl: string) => {
    const body = await readFile(path.join(out, name));
    const response = await deps.fetch(`${endpoint}${name}`, {
      method: 'PUT',
      body: body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength),
      headers: {
        'content-type': name.endsWith('.bin') ? 'application/octet-stream' : 'application/json',
        'cache-control': cacheControl,
      },
    });
    if (!response.ok) throw new Error(`PUT ${name}: HTTP ${response.status}`);
  };
  let writes = 0;
  for (const files of Object.values(manifest.languages))
    for (const name of [files.vectors, files.ids, files.sources])
      if (!(await isPublished(name))) {
        await put(name, 'public, max-age=31536000, immutable');
        writes++;
      }
  // The manifest last, so it never names a file that isn't there yet. Short cache: phones check it for updates.
  await put('manifest.json', 'public, max-age=300');
  console.log(JSON.stringify({ published: `${FINGERPRINT_PREFIX}/manifest.json`, classAWrites: writes + 1 }));
}

async function report(cards: readonly FingerprintCard[], stored: ReadonlySet<string>, languages: string[], out: string) {
  type Row = { cards: number; inR2: number; tcgdexNotMirrored: number; noImage: number };
  const coverage: Record<string, { total: Row; sets: Record<string, Row> }> = {};
  for (const language of languages) {
    const total: Row = { cards: 0, inR2: 0, tcgdexNotMirrored: 0, noImage: 0 };
    const bySet: Record<string, Row> = {};
    for (const card of cards) {
      if (!isPrintedIn(card, language)) continue;
      const row = (bySet[card.set_id] ??= { cards: 0, inR2: 0, tcgdexNotMirrored: 0, noImage: 0 });
      const onTcgdex = Array.isArray(card.image_languages_json) && card.image_languages_json.includes(language);
      const kind = pickStoredKey(fingerprintImageKeys(card, language), stored)
        ? 'inR2'
        : onTcgdex
          ? 'tcgdexNotMirrored'
          : 'noImage';
      for (const target of [row, total]) {
        target.cards++;
        target[kind]++;
      }
    }
    const gaps = Object.fromEntries(Object.entries(bySet).filter(([, row]) => row.inR2 < row.cards));
    coverage[language] = { total, sets: gaps };
    console.log(`\n${language}: ${JSON.stringify(total)}`);
    console.log(`  sets with gaps (set: cards / in R2 / on TCGdex only / no image anywhere):`);
    for (const [set, row] of Object.entries(gaps).sort((a, b) => b[1].cards - b[1].inR2 - (a[1].cards - a[1].inR2)))
      console.log(`  ${set}: ${row.cards} / ${row.inR2} / ${row.tcgdexNotMirrored} / ${row.noImage}`);
  }
  await writeFile(path.join(await ensureDir(out), 'coverage.json'), `${JSON.stringify(coverage, null, 2)}\n`);
}
