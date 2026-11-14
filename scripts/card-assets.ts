/**
 * Card image sourcing: which source each card's image comes from, and why. Read card-assets/AGENTS.md first.
 *
 *   bun run card-assets plan [--set a,b] [--game pokemon/tcg]   rewrite the ledger from the database and rules.csv
 *   bun run card-assets verify [--bucket <name>]                check sources, rules, atlas, ledger freshness and
 *                                                               what the app serves; --bucket also checks R2 coverage
 *   bun run card-assets atlas                                   refresh the pinned PTCG Image Atlas data.json
 *   bun run card-assets migrate-bucket [--apply]                copy cards/... from binderdex-card-images to
 *                                                               pokemon/tcg/cards/... in holofolder-assets
 *   bun run card-assets discover malie                          find malie.io renders for the sets in malie-sets.csv
 *   bun run card-assets publish [--set a,b] [--apply] [--concurrency 6]  upload the ledger's chosen images and record them on
 *                                                               the cards, so the app shows them
 *   bun run card-assets renditions [--set a,b] [--apply]        store the small copy (<key>.low.webp) beside every
 *                                                               chosen fallback-source image that lacks one
 *   bun run card-assets mirror-tcgdex [--set a,b] …             copy TCGdex images (and fallbacks) into R2
 *   bun run card-assets mirror-pokemoncom [--set a,b] …         copy pokemon.com's official images into R2
 *   bun run card-assets fill-gaps [--apply]                     fill catalog gaps (images, aliases, promo sets)
 *   bun run card-assets inventory                               rebuild card_image_inventory from an R2 LIST
 *   bun run card-assets fingerprints [--lang en,ja] [--set a,b] [--report] [--publish]
 *                                                               build the picture-matching index from the R2 images
 *   bun run card-assets lattice [--report]                      compare with Card Lattice: what it has that we don't;
 *                                                               --report: what we hold that it and TCGdex don't
 *
 * This is the one entry point for collecting, uploading and recording card images; the subcommands above live in
 * scripts/card-assets/.
 *
 * plan, verify and atlas read Postgres (POSTGRES_URL_NON_POOLING or DATABASE_URL) in a read-only transaction and
 * write only files under card-assets/. migrate-bucket copies R2 objects server side and records them in
 * card_image_inventory; it needs R2_ACCOUNT_ID, R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY for a token that can
 * read the source bucket and write the destination. publish needs CARD_IMAGE_STORE=r2 and the app's R2_* variables,
 * writes card rows and the inventory, and revalidates the app's mirror cache when CARD_DB_SYNC_SECRET is set.
 */
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { AwsClient } from 'aws4fetch';
import { Client } from 'pg';
import { parseListedObjects, planBucketCopy, type ListedObject } from '../lib/card-assets/bucket-migration';
import { createCardImageMirror } from '../lib/card-image-blob';
import { getSourceImageLowPathname, parseSourceCardImageUrl, pickCardImageUrl } from '../lib/card-image-sources';
import { createR2Deps, getR2Config } from '../lib/card-image-r2';
import { getCardImageStoreKind } from '../lib/card-image-store';
import { convertSourceImageToWebp, renderLowRendition } from '../lib/card-image-transform';
import {
  matchMalieEntries,
  MALIE_EXPORT_BASE,
  MALIE_EXPORT_INDEX,
  MALIE_LISTING_BASE,
  parseTcgoListing,
  parseTcglExport,
  type MalieEntry,
} from '../lib/card-assets/malie';
import {
  crossCheckAtlas,
  LEDGER_COLUMNS,
  ledgerRow,
  parseCsv,
  parseRules,
  parseSources,
  toCsv,
  type AtlasData,
  type LedgerRow,
  type MirrorCardRow,
} from '../lib/card-assets/ledger';
import { getMirrorDatabaseUrl } from '../lib/card-db-sync';
import { run as importTcgdex } from './card-assets/import-tcgdex';
import { run as compareLattice } from './card-assets/lattice';
import { run as fillGaps } from './card-assets/fill-gaps';
import { run as buildFingerprints } from './card-assets/fingerprints';
import { run as rebuildInventory } from './card-assets/inventory';
import { run as mirrorPokemonCom } from './card-assets/mirror-pokemoncom';
import { run as mirrorSets } from './card-assets/mirror-sets';
import { run as mirrorTcgdex } from './card-assets/mirror-tcgdex';
import { developerImageKey } from '../lib/developer-api/image-identity';
import { loadProjectEnvFiles } from '../lib/load-project-env';
import { buildTcgdexAssetImageUrl, pickImageLanguage } from '../lib/tcgdex-shared';
import {
  CARD_IMAGE_BLOB_PREFIX,
  LEGACY_CARD_IMAGE_BLOB_PREFIX,
  getCardImageBlobPathname,
  parseTcgdexCardImageUrl,
} from '../lib/tcgdex-card-image';

const ATLAS_REPO = 'nstrelow/ptcg-image-atlas';
const USER_AGENT = 'HoloFolderCardAssets/1.0 (+https://holofolder.com)';
const LANG = 'en';

function arg(name: string) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const game = arg('game') ?? 'pokemon/tcg';
if (!/^[a-z0-9-]+\/[a-z0-9-]+$/.test(game)) throw new Error('--game must look like <brand>/<game>, e.g. pokemon/tcg');
const root = path.resolve('card-assets', game);
const ledgerDir = path.join(root, 'ledger', LANG);

async function loadConfig() {
  const sources = parseSources(await readFile(path.join(root, 'sources.csv'), 'utf8'));
  const rules = parseRules(await readFile(path.join(root, 'rules.csv'), 'utf8'), sources);
  const atlas = JSON.parse(await readFile(path.join(root, 'atlas', 'data.json'), 'utf8')) as AtlasData;
  // Discovered images, per card: discovered/<source>.csv with card_id and url columns.
  const discovered = new Map<string, string[]>();
  for (const file of (await readdir(path.join(root, 'discovered')).catch(() => [] as string[]))
    .filter((name) => name.endsWith('.csv'))
    .sort()) {
    for (const row of parseCsv(await readFile(path.join(root, 'discovered', file), 'utf8'))) {
      if (row.card_id && row.url) discovered.set(row.card_id, [...(discovered.get(row.card_id) ?? []), row.url]);
    }
  }
  return { sources, rules, atlas, discovered };
}

async function withDb<T>(run: (db: Client) => Promise<T>) {
  const db = new Client({ connectionString: getMirrorDatabaseUrl() });
  await db.connect();
  try {
    await db.query('begin read only');
    await db.query("set local statement_timeout = '120s'");
    return await run(db);
  } finally {
    await db.query('rollback').catch(() => {});
    await db.end();
  }
}

async function loadCards(db: Client, sets: string[] | null) {
  const { rows } = await db.query<MirrorCardRow>(
    `select id, series_id, set_id, local_id, name_en, image_languages_json, external_ids_json
       from public.tcg_cards ${sets ? 'where set_id = any($1)' : ''}
      order by set_id, local_id_sort nulls last, local_id, id`,
    sets ? [sets] : [],
  );
  return rows;
}

function buildLedgers(cards: readonly MirrorCardRow[], config: Awaited<ReturnType<typeof loadConfig>>) {
  const ledgers = new Map<string, LedgerRow[]>();
  for (const card of cards) {
    const rows = ledgers.get(card.set_id) ?? [];
    rows.push(ledgerRow(card, config.rules, config.sources, LANG, config.discovered.get(card.id)));
    ledgers.set(card.set_id, rows);
  }
  return ledgers;
}

function ledgerFile(setId: string) {
  return path.join(ledgerDir, `${setId}.csv`);
}

/** What the app serves today for this card (lib/tcg-mirror.ts calls pickCardImageUrl the same way). */
function appImage(card: MirrorCardRow, { withPublished = true } = {}) {
  const imageLanguage = pickImageLanguage(card.image_languages_json, LANG);
  const externalIds = withPublished ? card.external_ids_json : withoutPublished(card.external_ids_json);
  return (
    pickCardImageUrl(
      externalIds,
      imageLanguage,
      imageLanguage && buildTcgdexAssetImageUrl(imageLanguage, card.series_id, card.set_id, card.local_id),
      LANG,
    ) ?? ''
  );
}

function withoutPublished(externalIds: unknown) {
  if (!externalIds || typeof externalIds !== 'object' || Array.isArray(externalIds)) return externalIds;
  const { assets: _assets, ...rest } = externalIds as Record<string, unknown>;
  return rest;
}

function publishedImage(card: MirrorCardRow) {
  const assets = (card.external_ids_json as { assets?: Record<string, { image?: unknown }> } | null)?.assets;
  const image = assets?.[LANG]?.image;
  return typeof image === 'string' ? image : null;
}

function summarize(ledgers: Map<string, LedgerRow[]>) {
  const rows = [...ledgers.values()].flat();
  const count = (pick: (row: LedgerRow) => string) => {
    const counts = new Map<string, number>();
    for (const row of rows) counts.set(pick(row), (counts.get(pick(row)) ?? 0) + 1);
    return Object.fromEntries([...counts].sort((a, b) => b[1] - a[1]));
  };
  return {
    cards: rows.length,
    sets: ledgers.size,
    bySource: count((row) => row.source || 'none'),
    byKind: count((row) => row.kind || 'none'),
    weak: {
      none: rows.filter((row) => !row.source).length,
      foreignPrint: rows.filter((row) => row.image_language && row.image_language !== LANG).length,
      retailPhoto: rows.filter((row) => row.kind === 'retail-photo').length,
    },
  };
}

async function plan() {
  await loadProjectEnvFiles();
  const config = await loadConfig();
  const sets =
    arg('set')
      ?.split(',')
      .map((id) => id.trim())
      .filter(Boolean) ?? null;
  const cards = await withDb((db) => loadCards(db, sets));
  const ledgers = buildLedgers(cards, config);
  await mkdir(ledgerDir, { recursive: true });
  if (!sets) {
    // A full plan also removes ledgers for sets that no longer exist.
    for (const file of await readdir(ledgerDir))
      if (file.endsWith('.csv') && !ledgers.has(file.slice(0, -4))) await rm(path.join(ledgerDir, file));
  }
  for (const [setId, rows] of ledgers) await writeFile(ledgerFile(setId), toCsv(LEDGER_COLUMNS, rows));
  console.log(JSON.stringify(summarize(ledgers), null, 2));
}

async function verify() {
  await loadProjectEnvFiles();
  const config = await loadConfig();
  const problems: string[] = [];
  const atlasCheck = crossCheckAtlas(config.sources, config.atlas);
  problems.push(...atlasCheck.errors);
  for (const warning of atlasCheck.warnings) console.warn(`warning: ${warning}`);

  const bucket = arg('bucket');
  const { cards, stored } = await withDb(async (db) => ({
    cards: await loadCards(db, null),
    stored: bucket
      ? new Set(
          (
            await db.query<{ object_key: string }>(
              'select object_key from public.card_image_inventory where bucket = $1',
              [bucket],
            )
          ).rows.map((row) => row.object_key),
        )
      : null,
  }));
  const ledgers = buildLedgers(cards, config);

  const committed = new Set(
    (await readdir(ledgerDir).catch(() => [] as string[]))
      .filter((file) => file.endsWith('.csv'))
      .map((file) => file.slice(0, -4)),
  );
  const stale: string[] = [];
  for (const [setId, rows] of ledgers) {
    const current = await readFile(ledgerFile(setId), 'utf8').catch(() => null);
    if (current !== toCsv(LEDGER_COLUMNS, rows)) stale.push(setId);
    committed.delete(setId);
  }
  stale.push(...[...committed].map((setId) => `${setId} (no longer in the database)`));
  if (stale.length)
    problems.push(
      `ledger is out of date for ${stale.length} set(s), run plan: ${stale.slice(0, 20).join(', ')}${stale.length > 20 ? ', …' : ''}`,
    );

  // Rules the app doesn't serve yet: expected after a rule change until it's published, so reported, not failed.
  const byId = new Map(cards.map((card) => [card.id, card]));
  const rows = [...ledgers.values()].flat();
  const unpublished = rows.filter((row) => row.url !== appImage(byId.get(row.card_id)!));
  console.log(
    JSON.stringify(
      {
        cards: rows.length,
        differsFromApp: unpublished.length,
        differsFromAppExamples: unpublished
          .slice(0, 10)
          .map((row) => ({ card: row.card_id, ledger: row.url, app: appImage(byId.get(row.card_id)!) })),
        ...(stored
          ? {
              notInBucket: rows.filter((row) => {
                const key = row.url && developerImageKey(row.url);
                return key && !stored.has(key);
              }).length,
              bucket,
            }
          : {}),
      },
      null,
      2,
    ),
  );

  if (problems.length) {
    for (const problem of problems) console.error(`error: ${problem}`);
    process.exitCode = 1;
  }
}

async function refreshAtlas() {
  const headers = {
    'User-Agent': 'HoloFolderCardAssets/1.0 (+https://holofolder.com)',
    Accept: 'application/vnd.github+json',
  };
  const commit = await fetch(`https://api.github.com/repos/${ATLAS_REPO}/commits/main`, { headers }).then(
    (response) => {
      if (!response.ok) throw new Error(`atlas commit lookup: HTTP ${response.status}`);
      return response.json() as Promise<{ sha: string; commit: { committer: { date: string } } }>;
    },
  );
  const response = await fetch(`https://raw.githubusercontent.com/${ATLAS_REPO}/${commit.sha}/data.json`, { headers });
  if (!response.ok) throw new Error(`atlas data.json: HTTP ${response.status}`);
  const text = await response.text();
  const atlas = JSON.parse(text) as AtlasData;
  await mkdir(path.join(root, 'atlas'), { recursive: true });
  await writeFile(path.join(root, 'atlas', 'data.json'), text);
  const licence = await fetch(`https://raw.githubusercontent.com/${ATLAS_REPO}/${commit.sha}/LICENSE`, { headers });
  if (!licence.ok) throw new Error(`atlas LICENSE: HTTP ${licence.status}`);
  await writeFile(path.join(root, 'atlas', 'LICENSE'), await licence.text());
  await writeFile(
    path.join(root, 'atlas', 'SOURCE'),
    `https://github.com/${ATLAS_REPO}/blob/${commit.sha}/data.json\ncommitted ${commit.commit.committer.date}\nMIT licence, by Luna (${ATLAS_REPO}). Pinned copy; refresh with: bun run card-assets atlas\n`,
  );
  const sources = parseSources(await readFile(path.join(root, 'sources.csv'), 'utf8'));
  const known = new Set(sources.map((source) => source.atlasId).filter(Boolean));
  console.log(
    JSON.stringify(
      {
        commit: commit.sha,
        atlasSources: atlas.sources.length,
        notInSourcesCsv: atlas.sources.filter((source) => !known.has(source.id)).map((source) => source.id),
      },
      null,
      2,
    ),
  );
}

async function migrateBucket() {
  await loadProjectEnvFiles();
  const from = arg('from') ?? 'binderdex-card-images';
  const to = arg('to') ?? 'holofolder-assets';
  const apply = process.argv.includes('--apply');
  const concurrency = Number(arg('concurrency') ?? 8);
  const [accountId, accessKeyId, secretAccessKey] = ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY'].map(
    (name) => process.env[name]?.trim() ?? '',
  );
  if (!/^[a-f0-9]{32}$/i.test(accountId) || !accessKeyId || !secretAccessKey)
    throw new Error(
      'Set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY (a token that reads the source and writes the destination)',
    );
  const client = new AwsClient({ accessKeyId, secretAccessKey, service: 's3', region: 'auto', retries: 3 });
  const endpoint = `https://${accountId}.r2.cloudflarestorage.com`;

  async function list(bucket: string, prefix: string) {
    const objects: ListedObject[] = [];
    let token: string | null = null;
    do {
      const query = new URLSearchParams({ 'list-type': '2', prefix, 'max-keys': '1000' });
      if (token) query.set('continuation-token', token);
      const response = await client.fetch(`${endpoint}/${bucket}?${query}`);
      if (!response.ok) throw new Error(`LIST ${bucket}: HTTP ${response.status} ${await response.text()}`);
      const page = parseListedObjects(await response.text());
      objects.push(...page.objects);
      token = page.nextContinuationToken;
    } while (token);
    return objects;
  }

  const destinationPrefix = `${CARD_IMAGE_BLOB_PREFIX}/`;
  const source = await list(from, `${LEGACY_CARD_IMAGE_BLOB_PREFIX}/`);
  let destination = await list(to, destinationPrefix);
  let plan = planBucketCopy(source, destination);
  console.log(
    JSON.stringify(
      {
        from,
        to,
        sourceObjects: source.length,
        destinationObjects: destination.length,
        toCopy: plan.copy.length,
        toCopyBytes: plan.copy.reduce((sum, item) => sum + item.size, 0),
        alreadyThere: plan.matching,
        mismatched: plan.mismatched.length,
        apply,
      },
      null,
      2,
    ),
  );
  if (!apply) {
    if (plan.copy.length || plan.mismatched.length) process.exitCode = 1;
    return;
  }

  let next = 0;
  let copied = 0;
  const failures: string[] = [];
  await Promise.all(
    Array.from({ length: Math.min(concurrency, plan.copy.length) }, async () => {
      while (next < plan.copy.length) {
        const item = plan.copy[next++];
        // Server-side CopyObject: no download, one Class A operation; metadata and Cache-Control are copied.
        const response = await client.fetch(`${endpoint}/${to}/${item.to}`, {
          method: 'PUT',
          headers: { 'x-amz-copy-source': `/${from}/${item.from}` },
        });
        if (response.ok) copied++;
        else failures.push(`${item.from}: HTTP ${response.status}`);
        if ((copied + failures.length) % 2000 === 0)
          console.log(`copied ${copied}, failed ${failures.length} of ${plan.copy.length}`);
      }
    }),
  );
  if (failures.length) console.error(failures.slice(0, 20).join('\n'));

  destination = await list(to, destinationPrefix);
  plan = planBucketCopy(source, destination);
  // Record every copied object for the developer API, so the new bucket's inventory is complete before the switch.
  const keys = destination.map((object) => object.key);
  const db = new Client({ connectionString: getMirrorDatabaseUrl() });
  await db.connect();
  try {
    for (let i = 0; i < keys.length; i += 1000) {
      await db.query(
        `insert into public.card_image_inventory (bucket, object_key, observed_at)
         select $1, key, now() from unnest($2::text[]) as key
         on conflict (bucket, object_key) do update set observed_at = excluded.observed_at`,
        [to, keys.slice(i, i + 1000)],
      );
    }
  } finally {
    await db.end();
  }
  console.log(
    JSON.stringify(
      {
        copied,
        failed: failures.length,
        destinationObjects: destination.length,
        inventoryRows: keys.length,
        stillMissing: plan.copy.length,
        mismatched: plan.mismatched.length,
      },
      null,
      2,
    ),
  );
  if (failures.length || plan.copy.length || plan.mismatched.length) process.exitCode = 1;
}

async function fetchOk(url: string) {
  const response = await fetch(url, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(60_000) });
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return response;
}

/** Finds malie.io renders for every set in malie-sets.csv and writes discovered/malie.csv. */
async function discover() {
  if (process.argv[3] !== 'malie') throw new Error('Usage: bun run card-assets discover malie');
  await loadProjectEnvFiles();
  const mapping = parseCsv(await readFile(path.join(root, 'malie-sets.csv'), 'utf8'));
  const cards = await withDb((db) => loadCards(db, [...new Set(mapping.map((row) => row.set_id))]));
  const bySet = new Map<string, MirrorCardRow[]>();
  for (const card of cards) bySet.set(card.set_id, [...(bySet.get(card.set_id) ?? []), card]);
  const index =
    ((await (await fetchOk(MALIE_EXPORT_INDEX)).json()) as Record<string, Record<string, { path?: string }>>)[
      'en-US'
    ] ?? {};
  const pages = new Map<string, MalieEntry[]>();
  const rows: Record<string, string>[] = [];
  const report: Array<{ set: string; code: string; cards: number; matched: number; nameMismatch: number }> = [];
  for (const { set_id: setId, format, code } of mapping) {
    const key = `${format}:${code}`;
    if (!pages.has(key)) {
      if (format === 'tcgl') {
        const exportPath = index[code]?.path;
        pages.set(key, exportPath ? parseTcglExport(await (await fetchOk(MALIE_EXPORT_BASE + exportPath)).json()) : []);
      } else if (format === 'tcgo') {
        pages.set(
          key,
          parseTcgoListing(await (await fetchOk(`${MALIE_LISTING_BASE}${encodeURIComponent(code)}.html`)).text(), code),
        );
      } else {
        throw new Error(`malie-sets.csv: unknown format "${format}" for ${setId}`);
      }
    }
    const setCards = bySet.get(setId) ?? [];
    const { matches, nameMismatch } = matchMalieEntries(setCards, pages.get(key)!);
    for (const [cardId, entry] of matches) {
      // Only URLs the image store can serve; anything odd is left out rather than widened.
      if (parseSourceCardImageUrl(entry.url)?.source === 'malie')
        rows.push({ card_id: cardId, url: entry.url, malie_number: entry.number, malie_name: entry.name });
    }
    report.push({ set: setId, code, cards: setCards.length, matched: matches.size, nameMismatch });
  }
  rows.sort((a, b) => a.card_id.localeCompare(b.card_id));
  await mkdir(path.join(root, 'discovered'), { recursive: true });
  await writeFile(
    path.join(root, 'discovered', 'malie.csv'),
    toCsv(['card_id', 'url', 'malie_number', 'malie_name'], rows),
  );
  const weak = report.filter((entry) => entry.matched < entry.cards);
  console.log(
    JSON.stringify(
      {
        sets: report.length,
        cards: cards.length,
        matched: rows.length,
        setsWithUnmatchedCards: weak.map(
          (entry) =>
            `${entry.set} ${entry.matched}/${entry.cards}${entry.nameMismatch ? ` (${entry.nameMismatch} name mismatches)` : ''}`,
        ),
      },
      null,
      2,
    ),
  );
}

type R2Deps = ReturnType<typeof createR2Deps>;

/**
 * Stores `<key>.low.webp` (SOURCE_IMAGE_LOW_WIDTH wide) beside a stored fallback-source image. Returns the new key.
 * Pass `body` when the image is already in hand: right after an upload, the public URL can still answer with a 404
 * that Cloudflare cached from the pre-upload existence check.
 */
async function storeLowRendition(deps: R2Deps, key: string, body?: ArrayBuffer) {
  const low = getSourceImageLowPathname(key);
  if (!low) return null;
  if (await deps.head(low)) return low;
  let source = body;
  if (!source) {
    const response = await deps.fetch(`${deps.baseUrl}${key}`);
    if (!response.ok) throw new Error(`reading ${key}: HTTP ${response.status}`);
    source = await response.arrayBuffer();
  }
  await deps.put(low, await renderLowRendition(source), 'image/webp');
  return low;
}

async function recordInventory(db: Client, bucket: string, keys: readonly string[]) {
  if (!keys.length) return;
  await db.query(
    `insert into public.card_image_inventory (bucket, object_key, observed_at)
     select $1, key, now() from unnest($2::text[]) as key
     on conflict (bucket, object_key) do update set observed_at = excluded.observed_at`,
    [bucket, keys],
  );
}

/**
 * Makes the app show the ledger's choices. For every card whose chosen image differs from what the app would pick on
 * its own, the image is uploaded to R2 (if it isn't there yet) and recorded as external_ids_json.assets.<lang>;
 * cards whose choice now matches the default lose their published entry. Dry run unless --apply.
 */
async function publish() {
  await loadProjectEnvFiles();
  const apply = process.argv.includes('--apply');
  const sets =
    arg('set')
      ?.split(',')
      .map((id) => id.trim())
      .filter(Boolean) ?? null;
  const config = await loadConfig();
  const cards = await withDb((db) => loadCards(db, sets));
  const ledgers = buildLedgers(cards, config);
  for (const [setId, rows] of ledgers) {
    if ((await readFile(ledgerFile(setId), 'utf8').catch(() => null)) !== toCsv(LEDGER_COLUMNS, rows))
      throw new Error(`The ledger for ${setId} is out of date: run plan and review the diff first`);
  }
  const byId = new Map(cards.map((card) => [card.id, card]));
  const changes: Array<{ card: MirrorCardRow; row: LedgerRow; image: string | null }> = [];
  for (const row of [...ledgers.values()].flat()) {
    const card = byId.get(row.card_id)!;
    const image = row.url && row.url !== appImage(card, { withPublished: false }) ? row.url : null;
    if (image !== publishedImage(card)) changes.push({ card, row, image });
  }
  const toPublish = changes.filter((change) => change.image);
  const toClear = changes.filter((change) => !change.image);
  const bySource: Record<string, number> = {};
  for (const change of toPublish) bySource[change.row.source] = (bySource[change.row.source] ?? 0) + 1;
  console.log(
    JSON.stringify(
      { apply, cards: cards.length, toPublish: toPublish.length, toClear: toClear.length, bySource },
      null,
      2,
    ),
  );
  if (!apply || !changes.length) return;

  const r2 = getCardImageStoreKind() === 'r2' ? getR2Config() : null;
  if (!r2) throw new Error("Set CARD_IMAGE_STORE=r2 and the R2_* variables for the app's bucket");
  const deps = createR2Deps(r2);
  const mirror = createCardImageMirror({
    ...deps,
    logger: (message) => console.warn(`[publish] ${message}`),
    transformSourceImage: convertSourceImageToWebp,
  });
  const db = new Client({ connectionString: getMirrorDatabaseUrl() });
  await db.connect();
  try {
    const stored = new Set(
      (
        await db.query<{ object_key: string }>('select object_key from public.card_image_inventory where bucket = $1', [
          r2.bucket,
        ])
      ).rows.map((row) => row.object_key),
    );
    const ready: typeof toPublish = [];
    const failed: string[] = [];
    let next = 0;
    await Promise.all(
      Array.from({ length: Number(arg('concurrency') ?? 6) }, async () => {
        while (next < toPublish.length) {
          const change = toPublish[next++];
          const url = new URL(change.image!);
          const tcgdex = parseTcgdexCardImageUrl(url);
          const source = tcgdex ? null : parseSourceCardImageUrl(url);
          const key = tcgdex ? getCardImageBlobPathname(tcgdex) : source?.pathname;
          if (!key) {
            failed.push(`${change.card.id}: not a storable image URL`);
            continue;
          }
          let original: ArrayBuffer | undefined;
          if (!stored.has(key)) {
            try {
              const image = tcgdex ? await mirror.loadImage(tcgdex) : await mirror.loadSourceImage(source!);
              original = image.body;
              await image.pendingUpload?.();
              if (!(await deps.head(key))) throw new Error('not in the bucket after upload');
              stored.add(key);
              await recordInventory(db, r2.bucket, [key]);
            } catch (error) {
              failed.push(`${change.card.id}: ${error instanceof Error ? error.message : String(error)}`);
              continue;
            }
          }
          // Lists and thumbnails load the small copy; a missing one only costs a fallback to the full image.
          const low = source && getSourceImageLowPathname(key);
          if (low && !stored.has(low)) {
            try {
              await storeLowRendition(deps, key, original);
              stored.add(low);
              await recordInventory(db, r2.bucket, [low]);
            } catch (error) {
              console.warn(`[publish] small copy of ${key}: ${error instanceof Error ? error.message : String(error)}`);
            }
          }
          ready.push(change);
          if (ready.length % 500 === 0) console.log(`ready ${ready.length} of ${toPublish.length}`);
        }
      }),
    );
    await db.query('begin');
    const ids = ready.map((change) => change.card.id);
    const values = ready.map((change) =>
      JSON.stringify({ image: change.image, source: change.row.source, rule: change.row.rule }),
    );
    await db.query(
      `update public.tcg_cards c
          set external_ids_json = jsonb_set(coalesce(c.external_ids_json, '{}'::jsonb), '{assets}',
                coalesce(c.external_ids_json->'assets', '{}'::jsonb) || jsonb_build_object($3::text, v.value::jsonb))
         from unnest($1::text[], $2::text[]) as v(id, value)
        where c.id = v.id`,
      [ids, values, LANG],
    );
    await db.query(
      "update public.tcg_cards set external_ids_json = external_ids_json #- array['assets', $2::text] where id = any($1)",
      [toClear.map((change) => change.card.id), LANG],
    );
    await db.query('commit');
    console.log(
      JSON.stringify(
        { published: ready.length, cleared: toClear.length, failed: failed.length, failures: failed.slice(0, 20) },
        null,
        2,
      ),
    );
    if (failed.length) process.exitCode = 1;
  } catch (error) {
    await db.query('rollback').catch(() => {});
    throw error;
  } finally {
    await db.end();
  }

  // The app caches mirror reads for days; any real sync revalidates the whole tcg-mirror tag.
  // Call the Vercel origin directly: Framer's proxy on holofolder.com strips the Authorization header.
  const secret = process.env.CARD_DB_SYNC_SECRET?.trim();
  const site = process.env.CARD_ASSETS_SITE ?? 'https://app.holofolder.com';
  if (!secret) {
    console.warn(
      'CARD_DB_SYNC_SECRET is not set: revalidate the mirror cache with a real POST /app/api/admin/sync-card-db?set=<id>&images=0',
    );
    return;
  }
  const setId = changes[0].card.set_id;
  const response = await fetch(`${site}/app/api/admin/sync-card-db?set=${encodeURIComponent(setId)}&images=0`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${secret}` },
  });
  console.log(`revalidated the mirror cache via a sync of ${setId}: HTTP ${response.status}`);
}

/** Backfills the small copy beside every chosen fallback-source image that is stored but has none. */
async function renditions() {
  await loadProjectEnvFiles();
  const apply = process.argv.includes('--apply');
  const sets =
    arg('set')
      ?.split(',')
      .map((id) => id.trim())
      .filter(Boolean) ?? null;
  const config = await loadConfig();
  const cards = await withDb((db) => loadCards(db, sets));
  const rows = [...buildLedgers(cards, config).values()].flat();
  const r2 = getCardImageStoreKind() === 'r2' ? getR2Config() : null;
  if (!r2) throw new Error("Set CARD_IMAGE_STORE=r2 and the R2_* variables for the app's bucket");
  const db = new Client({ connectionString: getMirrorDatabaseUrl() });
  await db.connect();
  try {
    const stored = new Set(
      (
        await db.query<{ object_key: string }>('select object_key from public.card_image_inventory where bucket = $1', [
          r2.bucket,
        ])
      ).rows.map((row) => row.object_key),
    );
    const keys = [
      ...new Set(
        rows.flatMap((row) => {
          const key = row.url ? parseSourceCardImageUrl(row.url)?.pathname : undefined;
          return key ? [key] : [];
        }),
      ),
    ];
    const todo = keys.filter((key) => stored.has(key) && !stored.has(getSourceImageLowPathname(key)!));
    console.log(
      JSON.stringify(
        {
          apply,
          sourceImages: keys.length,
          notStoredYet: keys.filter((key) => !stored.has(key)).length,
          missingSmallCopy: todo.length,
        },
        null,
        2,
      ),
    );
    if (!apply) return;
    const deps = createR2Deps(r2);
    const done: string[] = [];
    const failed: string[] = [];
    let next = 0;
    await Promise.all(
      Array.from({ length: 8 }, async () => {
        while (next < todo.length) {
          const key = todo[next++];
          try {
            const low = await storeLowRendition(deps, key);
            if (low) done.push(low);
          } catch (error) {
            failed.push(`${key}: ${error instanceof Error ? error.message : String(error)}`);
          }
          if ((done.length + failed.length) % 1000 === 0)
            console.log(`stored ${done.length}, failed ${failed.length} of ${todo.length}`);
        }
      }),
    );
    for (let i = 0; i < done.length; i += 1000) await recordInventory(db, r2.bucket, done.slice(i, i + 1000));
    console.log(JSON.stringify({ stored: done.length, failed: failed.length, failures: failed.slice(0, 20) }, null, 2));
    if (failed.length) process.exitCode = 1;
  } finally {
    await db.end();
  }
}

const commands: Record<string, () => Promise<void>> = {
  plan,
  verify,
  atlas: refreshAtlas,
  'migrate-bucket': migrateBucket,
  discover,
  publish,
  renditions,
  'mirror-tcgdex': mirrorTcgdex,
  'mirror-sets': mirrorSets,
  'mirror-pokemoncom': mirrorPokemonCom,
  'fill-gaps': fillGaps,
  'import-tcgdex': importTcgdex,
  inventory: rebuildInventory,
  fingerprints: buildFingerprints,
  lattice: compareLattice,
};
const command = commands[process.argv[2] ?? ''];
if (!command) {
  console.error(
    `Usage: bun run card-assets <${Object.keys(commands).join('|')}> [options]. See card-assets/AGENTS.md.`,
  );
  process.exitCode = 2;
} else {
  command().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
