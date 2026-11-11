import { execFileSync } from 'node:child_process';
import { readdir, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Client } from 'pg';
import { buildSourceCardRows, hasSourceSetConflict } from '../../lib/card-db-source-import';
import { getMirrorDatabaseUrl, mapWithConcurrency, upsertRestSetPayload, type TCGCard } from '../../lib/card-db-sync';
import { loadProjectEnvFiles } from '../../lib/load-project-env';
import { buildTcgdexAssetImageUrl } from '../../lib/tcgdex-shared';

function arg(name: string) { const i = process.argv.indexOf(`--${name}`); return i < 0 ? undefined : process.argv[i + 1]; }

/** Add missing cards/languages from both trees of sync-card-db's upstream, without truncating. */
export async function run() {
  await loadProjectEnvFiles();
  const repo = arg('repo');
  const language = arg('lang') ?? 'all';
  if (!repo || !/^(all|[a-z]{2}(?:-[a-z]{2})?)$/.test(language)) throw new Error('Use --repo <tcgdex/cards-database checkout> --lang <all|language>');
  const requested = new Set((arg('set') ?? '').split(',').filter(Boolean));
  if (!requested.size && !process.argv.includes('--missing')) throw new Error('Select --set <IDs> or --missing');
  const commit = execFileSync('git', ['-C', repo, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  if (execFileSync('git', ['-C', repo, 'status', '--porcelain', '--', 'data', 'data-asia'], { encoding: 'utf8' }).trim()) throw new Error('Source checkout must be clean');
  const response = await fetch('https://assets.tcgdex.net/datas.json', { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`Asset manifest HTTP ${response.status}`);
  const manifest = await response.json() as Record<string, Record<string, Record<string, Record<string, string>>>>;
  const db = new Client({ connectionString: getMirrorDatabaseUrl() });
  await db.connect();
  const skipped: Array<{set: string; reason: string}> = [];
  const report: Array<{ set: string; cards: number; images: number; languages: string[] }> = [];

  try {
    if (process.argv.includes('--apply')) {
      const lock = await db.query<{ locked: boolean }>('select pg_try_advisory_lock($1) as locked', [10250418]);
      if (!lock.rows[0].locked) throw new Error('A catalog sync is already running');
    }
    // Merge the existing evidence before using the normal upsert, preserving curated IDs and images.
    const existingCards = new Map((await db.query<{ id: string; set_id: string; local_id: string; series_id: string; name_json: Record<string,string>; image_languages_json: string[]; external_ids_json: Record<string,unknown> }>('select id,set_id,local_id,series_id,name_json,image_languages_json,external_ids_json from public.tcg_cards')).rows.map(r => [r.id, r]));
    const existingSets = new Map((await db.query<{ id: string; series_id: string; name_json: Record<string,string>; name_en: string | null; official_card_count: number | null; release_date: string | null; raw_json: Record<string,unknown> }>('select id,series_id,name_json,name_en,official_card_count,release_date::text as release_date,raw_json from public.tcg_sets')).rows.map(r => [r.id, r]));
    for (const tree of ['data', 'data-asia']) {
      const root = path.resolve(repo, tree);
      for (const series of (await readdir(root, { withFileTypes: true })).filter(e => e.isDirectory()).sort((a,b) => a.name.localeCompare(b.name))) {
        const seriesRoot = path.join(root, series.name);
        for (const set of (await readdir(seriesRoot, { withFileTypes: true })).filter(e => e.isDirectory()).sort((a,b) => a.name.localeCompare(b.name))) {
          const setRoot = path.join(seriesRoot, set.name);
          const rows = [];
          for (const file of (await readdir(setRoot)).filter(f => f.endsWith('.ts')).sort()) {
            const source = (await import(pathToFileURL(path.join(setRoot, file)).href)).default as TCGCard;
            if (source.set.serie.id === 'tcgp' || (requested.size && !requested.has(source.set.id))) continue;
            if (typeof source.name !== 'object') throw new Error(`Missing localized names: ${file}`);
            const names = Object.keys(source.name).filter(l => source.name && typeof source.name === 'object' && source.name[l]);
            const primary = language === 'all' ? names.find(l => source.set.name[l] && source.set.serie.name[l]) : language;
            if (!primary || !source.name[primary]) continue;
            const localId = path.basename(file, '.ts');
            const row = buildSourceCardRows(source, localId, primary, commit, false, path.relative(repo, path.join(setRoot,file)));
            row.card.image_languages_json = Object.keys(manifest).filter(l => typeof manifest[l]?.[source.set.serie.id]?.[source.set.id]?.[localId] === 'string');
            const previous = existingCards.get(row.card.id);
            const previousSet = existingSets.get(row.set.id);
            if (previousSet && (previousSet.series_id !== row.set.series_id || (tree === 'data-asia' && previousSet.raw_json.sourcePath !== row.set.raw_json.sourcePath && hasSourceSetConflict(previousSet, row.set)))) {
              skipped.push({set: row.set.id, reason: `Upstream reuses this ID for different set metadata in ${tree}`});
              rows.length = 0; break;
            }
            if (previous && (previous.set_id !== row.card.set_id || previous.local_id !== localId || previous.series_id !== row.card.series_id)) throw new Error(`Card identity collision: ${row.card.id}`);
            if (!requested.has(row.set.id) && previous && Object.keys(row.card.name_json).every(l => previous.name_json[l]) && row.card.image_languages_json.every(l => previous.image_languages_json.includes(l))) continue;
            if (previous) {
              row.card.name_json = { ...previous.name_json, ...row.card.name_json };
              row.card.image_languages_json = [...new Set([...previous.image_languages_json, ...row.card.image_languages_json])];
              row.card.external_ids_json = { ...previous.external_ids_json, ...row.card.external_ids_json, tcgdex: { ...(previous.external_ids_json.tcgdex as object), ...(row.card.external_ids_json.tcgdex as object) } };
            }
            if (previousSet) { row.set.name_json = { ...previousSet.name_json, ...row.set.name_json }; row.set.name_en = previousSet.name_en ?? row.set.name_en; row.set.raw_json = { ...previousSet.raw_json, ...row.set.raw_json }; }
            rows.push(row);
          }
          if (!rows.length) continue;

          // Probe selected sets when the manifest lags. Never declare a guessed URL available.
          if (requested.has(rows[0].set.id)) await mapWithConcurrency(rows, 6, async row => {
            for (const l of Object.keys(row.card.name_json).filter(l => language === 'all' || l === language)) {
              if (row.card.image_languages_json.includes(l)) continue;
              const image = buildTcgdexAssetImageUrl(l, row.card.series_id, row.card.set_id, row.card.local_id);
              const r = await fetch(image, { method: 'HEAD', signal: AbortSignal.timeout(20_000) });
              if (r.status === 404) continue;
              if (!r.ok || !r.headers.get('content-type')?.startsWith('image/')) throw new Error(`Image probe failed: ${image} HTTP ${r.status}`);
              row.card.image_languages_json.push(l);
            }
          });
          const entry = { set: rows[0].set.id, cards: rows.length, images: rows.reduce((n,r) => n+r.card.image_languages_json.length,0), languages: [...new Set(rows.flatMap(r => Object.keys(r.card.name_json)))].sort() };
          console.log(JSON.stringify(entry));
          if (process.argv.includes('--apply')) {
            await db.query('BEGIN');
            try {
              await db.query('select pg_advisory_xact_lock($1)', [10250418]);
              await upsertRestSetPayload(db, { series: [rows[0].series], sets: [rows[0].set], cards: rows.map(r => r.card), dexLinks: rows.flatMap(r => r.dexLinks), externalSources: [] }, undefined, false);
              await db.query('COMMIT');
            } catch (error) { await db.query('ROLLBACK'); throw error; }
          }
          report.push(entry);
          for (const row of rows) existingCards.set(row.card.id, row.card);
          existingSets.set(rows[0].set.id, rows[0].set);
        }
      }
    }
    if (requested.size && !report.length) console.log('Selected sets already complete or unavailable in this source checkout.');
  } finally {
    await db.end();
    await mkdir('.cache/card-gap-fill', { recursive: true });
    await writeFile('.cache/card-gap-fill/source-import.json', JSON.stringify({ commit, language, applied: process.argv.includes('--apply'), skipped, sets: report }, null, 2));
  }
  console.log(JSON.stringify({ skipped, sets: report.length, cards: report.reduce((n,r) => n+r.cards,0), images: report.reduce((n,r) => n+r.images,0), applied: process.argv.includes('--apply') }));
}
