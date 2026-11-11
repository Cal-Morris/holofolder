/** Mirror set symbols/logos; --prepare <dir> downloads for a connector upload, --apply uploads with R2 credentials. */
import { Client } from 'pg';
import sharp from 'sharp';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { getMirrorDatabaseUrl } from '../../lib/card-db-sync';
import { loadProjectEnvFiles } from '../../lib/load-project-env';
import { createR2Deps, getR2Config } from '../../lib/card-image-r2';
import { pickSetArtwork } from '../../lib/set-browse';
import { pickLocalizedText } from '../../lib/tcgdex-shared';

const manifestPath = 'card-assets/pokemon/tcg/set-artwork.json';
type Asset = { source: string; url: string };
type Artwork = { symbol?: Asset; logo?: Asset };
const normalize = (name: string) => name.toLowerCase().replace(/é/g, 'e').replace(/sun & moon/g, 'sm').replace(/[^a-z0-9]/g, '');
// Catalogue and PokéSymbols use different names for these same products.
const names: Record<string, string> = {
  '30th-c': '30th Celebration: Classic Collection', svp: 'Scarlet & Violet Black Star Promos',
  sve: 'Scarlet & Violet Energies', base1: 'Base', hgss4: 'HS-Triumphant', hgss3: 'HS-Undaunted', hgss2: 'HS-Unleashed',
  'tk-bw-z': 'Black & White Trainer Kit Zoroark', 'tk-bw-e': 'Black & White Trainer Kit Excadrill',
  'tk-dp-l': 'Diamond & Pearl Trainer Kit Lucario', 'tk-dp-m': 'Diamond & Pearl Trainer Kit Manaphy',
};

export function parseSetSymbols(html: string) {
  const symbols = new Map<string, string>();
  for (const match of html.matchAll(/<img alt="([^"]+)"[^>]+src="(\/images\/tcg\/sets\/symbols\/[a-z0-9-]+\.png)"/g)) {
    const name = match[1].replace(/&amp;/g, '&').replace(/&#x27;|&#39;/g, "'");
    symbols.set(normalize(name), `https://pokesymbols.com${match[2]}`);
  }
  return symbols;
}

export async function run() {
  await loadProjectEnvFiles();
  const prepareIndex = process.argv.indexOf('--prepare');
  const directory = prepareIndex >= 0 ? process.argv[prepareIndex + 1] : null;
  const apply = process.argv.includes('--apply');
  if (!directory && !apply) throw new Error('Use --prepare <directory> or --apply');
  const config = apply ? getR2Config() : null;
  if (apply && (!config || config.bucket !== 'holofolder-assets' || config.publicBaseUrl !== 'https://assets.holofolder.com/'))
    throw new Error('Configure the public holofolder-assets R2 bucket');
  const store = config ? createR2Deps(config) : null;
  const response = await fetch('https://pokesymbols.com/tcg/sets');
  if (!response.ok) throw new Error(`PokéSymbols index: ${response.status}`);
  const symbols = parseSetSymbols(await response.text());
  if (symbols.size < 100) throw new Error('PokéSymbols index format changed');
  const db = new Client({ connectionString: getMirrorDatabaseUrl() });
  await db.connect();
  let rows: Array<{ id: string; name_json: unknown; name_en: string; raw_json: Record<string, unknown> }>;
  try { rows = (await db.query('select id, name_json, name_en, raw_json from tcg_sets order by id')).rows; }
  finally { await db.end(); }
  const manifest: Record<string, Artwork> = JSON.parse(await readFile(manifestPath, 'utf8').catch(() => '{}'));
  const prepared: Array<{ key: string; file: string }> = [];
  if (directory) await mkdir(directory, { recursive: true });
  let bytes = 0;
  const missing: string[] = [];
  for (const set of rows) {
    const raw = set.raw_json ?? {};
    const fallback = pickSetArtwork({ tcgdexSymbol: raw.symbol, tcgdexLogo: raw.logo, pokemonTcgImages: (raw.supplementalSources as { pokemon_tcg?: { images?: unknown } })?.pokemon_tcg?.images });
    const symbol = symbols.get(normalize(names[set.id] ?? pickLocalizedText(set.name_json, 'en') ?? set.name_en));
    const artwork: Artwork = { ...manifest[set.id] };
    for (const kind of ['symbol', 'logo'] as const) {
      const sources = [...new Set([kind === 'symbol' ? symbol : undefined, fallback[kind]].filter((v): v is string => Boolean(v)))];
      for (const source of sources) {
        const origin = new URL(source);
        if (!['pokesymbols.com', 'assets.tcgdex.net', 'images.pokemontcg.io', 'images.scrydex.com'].includes(origin.hostname)) continue;
        const image = await fetch(source, { signal: AbortSignal.timeout(15_000) });
        if (!image.ok) continue;
        if (!image.headers.get('content-type')?.startsWith('image/')) throw new Error(`Invalid image: ${source}`);
        const body = await image.arrayBuffer();
        if (body.byteLength > 5_000_000) throw new Error(`Oversized set artwork: ${set.id}`);
        const converted = await sharp(body).trim().resize({ width: kind === 'symbol' ? 128 : 320, height: kind === 'symbol' ? 128 : 160, fit: 'inside' }).webp({ quality: 90 }).toBuffer();
        bytes += converted.byteLength;
        if (bytes > 20_000_000) throw new Error('Set artwork exceeds the 20 MB budget');
        const hash = createHash('sha256').update(converted).digest('hex').slice(0, 16);
        const key = `pokemon/tcg/sets/${set.id}/${kind}-${hash}.webp`;
        const url = `https://assets.holofolder.com/${key}`;
        if (store && !(await store.head(key))) await store.put(key, Uint8Array.from(converted).buffer, 'image/webp', { metadata: { source: origin.hostname, 'source-url': source, 'source-sha256': createHash('sha256').update(new Uint8Array(body)).digest('hex') } });
        if (directory) { const file = `${directory}/${set.id}-${kind}.webp`; await writeFile(file, converted); prepared.push({ key, file }); }
        artwork[kind] = { source, url };
        break;
      }
    }
    if (artwork.symbol || artwork.logo) manifest[set.id] = artwork;
    if (!artwork.symbol) missing.push(set.id);
  }
  const sorted = Object.fromEntries(Object.entries(manifest).sort(([a], [b]) => a.localeCompare(b)));
  const output = `${JSON.stringify(sorted, null, 2)}\n`;
  if (directory) { await writeFile(`${directory}/manifest.json`, output); await writeFile(`${directory}/uploads.json`, JSON.stringify(prepared)); }
  if (apply) await writeFile(manifestPath, output);
  console.log(JSON.stringify({ sets: rows.length, artwork: Object.keys(manifest).length, bytes, missingSymbols: missing, prepared: prepared.length, applied: apply }));
}
