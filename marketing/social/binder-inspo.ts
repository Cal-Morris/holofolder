// Card picking for the weekly binder inspiration series (see README.md).
//
//   bun run marketing/social/binder-inspo.ts find [--name 'dragonite|dratini'] [--type Dragon] [--artist 'Saito'] [--dex 252-386]
//       [--rarity 'Illustration rare,Special illustration rare'] [--lang en] [--limit 60]
//   bun run marketing/social/binder-inspo.ts check [slug,slug]
//
// `find` lists candidates from our catalogue with their image on assets.holofolder.com and whether it loads.
// `check` resolves every card of the inspo pages in scripts/showcase-pages.json, fails on any missing image,
// and writes out/binder-inspo.json (card names, numbers and image URLs) for `render.mjs`. Read only.
/* oxlint-disable react-doctor/async-await-in-loop -- one image check at a time, gentle on the asset host */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';
import config from '../../scripts/showcase-pages.json';
import { pickCardAssetUrl } from '../../lib/card-image-url';
import { buildTcgdexAssetImageUrl, pickImageLanguage } from '../../lib/tcgdex-shared';
import { loadProjectEnvFiles } from '../../lib/load-project-env';

type Row = {
  id: string;
  series_id: string;
  set_id: string;
  local_id: string;
  name_json: Record<string, string>;
  name_en: string | null;
  rarity: string | null;
  illustrator: string | null;
  image_languages_json: unknown;
  external_ids_json: unknown;
  set_name: string | null;
  official: number | null;
};
type InspoPage = { slug: string; name: string; cards: { cardId: string; language?: string }[] };

const OUT = process.env.SOCIAL_OUT || join(new URL('.', import.meta.url).pathname, 'out');
const arg = (flag: string) => {
  const i = process.argv.indexOf(flag);
  return i > 0 ? process.argv[i + 1] : undefined;
};

const imageOf = (row: Row, language: string) => {
  const imageLanguage = pickImageLanguage(row.image_languages_json, language);
  return pickCardAssetUrl(
    row.external_ids_json,
    imageLanguage,
    imageLanguage && buildTcgdexAssetImageUrl(imageLanguage, row.series_id, row.set_id, row.local_id),
    language,
  );
};
// A GET of the first bytes, because a HEAD can be answered from cache for an object that has gone.
const loads = async (url: string | undefined) =>
  !!url &&
  (await fetch(url, { headers: { range: 'bytes=0-1023' }, signal: AbortSignal.timeout(15000) })
    .then((r) => r.ok && (r.headers.get('content-type') ?? '').startsWith('image/'))
    .catch(() => false));

const SELECT = `SELECT c.id, c.series_id, c.set_id, c.local_id, c.name_json, c.name_en, c.rarity, c.illustrator,
  c.image_languages_json, c.external_ids_json, s.name_en AS set_name, s.official_card_count AS official
  FROM tcg_cards c JOIN tcg_sets s ON s.id = c.set_id`;

async function find(db: Client) {
  const lang = arg('--lang') ?? 'en';
  const rarity = (arg('--rarity') ?? 'Illustration rare,Special illustration rare').split(',');
  const where = ['c.image_languages_json ? $1', 'c.rarity = ANY($2)'];
  const params: unknown[] = [lang, rarity];
  for (const [flag, sql] of [
    ['--name', 'c.name_en ~* $'],
    ['--type', 'c.types_json ? $'],
    ['--artist', 'c.illustrator ~* $'],
  ] as const) {
    const value = arg(flag);
    if (value) where.push(sql + params.push(value));
  }
  const dex = arg('--dex')?.split('-').map(Number);
  if (dex)
    where.push(
      `EXISTS (SELECT 1 FROM tcg_card_dex_ids d WHERE d.card_id = c.id AND d.dex_id BETWEEN $${params.push(dex[0])} AND $${params.push(dex[1] ?? dex[0])})`,
    );
  const { rows } = await db.query<Row>(
    `${SELECT} WHERE ${where.join(' AND ')} ORDER BY s.release_date DESC NULLS LAST, c.local_id_sort LIMIT ${Number(arg('--limit') ?? 60)}`,
    params,
  );
  for (const row of rows) {
    const url = imageOf(row, lang);
    console.log(
      [(await loads(url)) ? 'ok  ' : 'MISS', row.id, row.name_en, row.rarity, row.illustrator, row.set_name, url].join(
        ' | ',
      ),
    );
  }
}

async function check(db: Client) {
  const only = process.argv[3]?.split(',');
  // Inspo pages fill all nine pockets. Pages with empty pockets (e.g. the Michi scenery page) aren't inspo posts.
  const pages = (config.pages as unknown as InspoPage[]).filter(
    (p) => p.cards?.every(Boolean) && (!only || only.includes(p.slug)),
  );
  const result: Record<string, unknown> = {};
  let missing = 0;
  for (const page of pages) {
    const { rows } = await db.query<Row>(`${SELECT} WHERE c.id = ANY($1)`, [page.cards.map((c) => c.cardId)]);
    const byId = new Map(rows.map((r) => [r.id, r]));
    const cards = [];
    for (const { cardId, language = 'en' } of page.cards) {
      const row = byId.get(cardId);
      const image = row && imageOf(row, language);
      if (!row || !(await loads(image))) {
        console.log(`MISS ${page.slug}: ${cardId} ${image ?? '(no image)'}`);
        missing++;
        continue;
      }
      cards.push({
        id: cardId,
        name: row.name_json?.[language] || row.name_en,
        number: `${row.local_id}${row.official ? `/${row.official}` : ''}`,
        set: row.set_name,
        rarity: row.rarity,
        illustrator: row.illustrator,
        image,
      });
    }
    result[page.slug] = { name: page.name, cards };
    console.log(`${page.slug}: ${cards.length}/${page.cards.length} images load`);
  }
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, 'binder-inspo.json'), JSON.stringify(result, null, 2));
  if (missing) throw new Error(`${missing} cards have no working image, swap them before rendering`);
}

async function main() {
  await loadProjectEnvFiles();
  const url = new URL(process.env.POSTGRES_URL_NON_POOLING ?? process.env.DATABASE_URL ?? '');
  url.searchParams.delete('sslmode');
  const db = new Client({ connectionString: url.toString(), ssl: { rejectUnauthorized: false } });
  await db.connect();
  try {
    await db.query("SET default_transaction_read_only = on; SET statement_timeout = '15s'");
    if (process.argv[2] === 'find') await find(db);
    else if (process.argv[2] === 'check') await check(db);
    else console.log('usage: bun run marketing/social/binder-inspo.ts find|check (see the header)');
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  } finally {
    await db.end();
  }
}

if (import.meta.main) void main();
