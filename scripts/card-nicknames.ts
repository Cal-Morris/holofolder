/**
 * bun run card-nicknames [--dry-run]
 *
 * Builds lib/card-nicknames.json, the nickname → card ids table card search uses (lib/card-nicknames.ts), from:
 * - lib/card-nicknames.csv: hand-picked nicknames for single cards ("moonbreon"), one row per nickname and card,
 *   with the card's English name so a wrong id is caught;
 * - RULES below: nicknames for a whole group of cards ("gold star", "alt art"), re-read from the mirror on every run,
 *   so new sets are picked up by running it again after `sync-card-db`.
 *
 * Reads Postgres (POSTGRES_URL_NON_POOLING or DATABASE_URL) in a read-only transaction and fails, writing nothing,
 * when a row names a card that's missing, has another name or has no Pokémon (search only shows Pokémon cards).
 * --dry-run reports what would change without writing.
 */
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Client } from 'pg';
import { getMirrorDatabaseUrl } from '../lib/card-db-sync';
import { normalizeNickname } from '../lib/card-nicknames';
import { loadProjectEnvFiles } from '../lib/load-project-env';

const ROOT = path.join(import.meta.dirname, '..');
const CSV_PATH = path.join(ROOT, 'lib/card-nicknames.csv');
const JSON_PATH = path.join(ROOT, 'lib/card-nicknames.json');

/** Pokémon cards only, like card search (the inner join drops Trainers and Energy). */
const POKEMON_CARDS = 'tcg_cards c WHERE EXISTS (SELECT 1 FROM tcg_card_dex_ids d WHERE d.card_id = c.id)';
const SWSH_MAIN_SETS = String.raw`c.set_id ~ '^swsh([5-9]|1[0-2])$'`;

/** Group nicknames: every Pokémon card matching `where` (SQL over tcg_cards c) gets each of `nicknames`. */
const RULES: Array<{ nicknames: string[]; where: string }> = [
  { nicknames: ['gold star', 'goldstar'], where: `c.name_en LIKE '%☆%'` },
  { nicknames: ['delta species', 'delta'], where: `c.name_en LIKE '%δ%'` },
  { nicknames: ['amazing rare'], where: `c.rarity = 'Amazing Rare'` },
  { nicknames: ['poncho'], where: `c.name_en LIKE 'Poncho-wearing %'` },
  { nicknames: ['tag team', 'tag teams'], where: `c.name_en ~ '&.* GX$'` },
  // XY Mega Evolutions are printed "M Charizard EX"; newer ones already say "Mega".
  { nicknames: ['mega'], where: `c.name_en ~ '^M [A-Z]'` },
  // The small shinies of the shiny-vault sets, not the GX, V or ex ones.
  {
    nicknames: ['baby shiny', 'baby shinies'],
    where: `c.set_id IN ('sma', 'swsh4.5', 'swsh4.5sv', 'sv04.5') AND c.rarity = 'Shiny rare' AND c.name_en !~ ' (GX|V|VMAX|ex)$'`,
  },
  { nicknames: ['shiny vault'], where: `c.set_id IN ('sma', 'swsh4.5', 'swsh4.5sv') AND c.local_id LIKE 'SV%'` },
  { nicknames: ['trainer gallery', 'tg'], where: `c.local_id LIKE 'TG%'` },
  { nicknames: ['galarian gallery', 'gg'], where: `c.local_id LIKE 'GG%'` },
  {
    // e-Card Crystal type: the last holos of Aquapolis and Skyridge.
    nicknames: ['crystal', 'crystal type'],
    where: `(c.set_id = 'ecard2' AND c.local_id IN ('148', '149', '150'))
      OR (c.set_id = 'ecard3' AND c.local_id IN ('145', '146', '147', '148', '149', '150'))`,
  },
  {
    // Sword & Shield alternate arts. A V's alt art is the full art right after another full art of the same name
    // (the standard one); a VMAX or VSTAR alt art is a secret rare drawn by someone other than the illustrator
    // of its regular printing. Gallery subsets (TG, GG) are their own nicknames.
    nicknames: ['alt art', 'alternate art', 'alt'],
    where: `${SWSH_MAIN_SETS} AND c.local_id ~ '^\\d+$' AND (
      (c.rarity = 'Ultra Rare' AND c.name_en ~ ' V$' AND EXISTS (
        SELECT 1 FROM tcg_cards f WHERE f.set_id = c.set_id AND f.name_en = c.name_en AND f.rarity = 'Ultra Rare'
          AND f.local_id = (c.local_id::int - 1)::text))
      OR (c.rarity = 'Secret Rare' AND c.name_en ~ ' (VMAX|VSTAR)$' AND EXISTS (
        SELECT 1 FROM tcg_cards r WHERE r.set_id = c.set_id AND r.name_en = c.name_en AND r.rarity LIKE 'Holo Rare V%'
          AND r.illustrator IS DISTINCT FROM c.illustrator))
    )`,
  },
];

function parseCsv(text: string) {
  const [header, ...lines] = text.split(/\r?\n/).filter((line) => line.trim() && !line.startsWith('#'));
  if (header !== 'nickname,card_id,name') throw new Error(`${CSV_PATH}: header must be "nickname,card_id,name"`);
  return lines.map((line, index) => {
    const [nickname, cardId, ...name] = line.split(',');
    if (!nickname || !cardId || !name.length) throw new Error(`${CSV_PATH}:${index + 2}: expected 3 columns: ${line}`);
    return { nickname: normalizeNickname(nickname), cardId: cardId.trim(), name: name.join(',').trim() };
  });
}

async function main() {
  await loadProjectEnvFiles(ROOT);
  const dryRun = process.argv.includes('--dry-run');
  const rows = parseCsv(await readFile(CSV_PATH, 'utf8'));
  const db = new Client({ connectionString: getMirrorDatabaseUrl() });
  await db.connect();
  const table = new Map<string, Set<string>>();
  const add = (nickname: string, id: string) => {
    const key = normalizeNickname(nickname);
    if (!table.has(key)) table.set(key, new Set());
    table.get(key)!.add(id);
  };
  const problems: string[] = [];
  try {
    await db.query('BEGIN READ ONLY');
    const cards = await db.query<{ id: string; name_en: string | null; pokemon: boolean }>(
      `SELECT c.id, c.name_en, EXISTS (SELECT 1 FROM tcg_card_dex_ids d WHERE d.card_id = c.id) AS pokemon
       FROM tcg_cards c WHERE c.id = ANY($1)`,
      [[...new Set(rows.map((row) => row.cardId))]],
    );
    const byId = new Map(cards.rows.map((card) => [card.id, card]));
    for (const row of rows) {
      const card = byId.get(row.cardId);
      if (!card) problems.push(`${row.nickname}: no card ${row.cardId}`);
      else if (card.name_en?.toLowerCase() !== row.name.toLowerCase())
        problems.push(`${row.nickname}: ${row.cardId} is "${card.name_en}", not "${row.name}"`);
      else if (!card.pokemon) problems.push(`${row.nickname}: ${row.cardId} has no Pokémon, so search won't show it`);
      else add(row.nickname, row.cardId);
    }
    for (const rule of RULES) {
      const { rows: matches } = await db.query<{ id: string }>(`SELECT c.id FROM ${POKEMON_CARDS} AND (${rule.where})`);
      if (!matches.length) problems.push(`rule ${rule.nicknames[0]}: matched no cards`);
      for (const nickname of rule.nicknames) for (const { id } of matches) add(nickname, id);
    }
  } finally {
    await db.end();
  }
  if (problems.length) {
    console.error(`card-nicknames: ${problems.length} problem(s), nothing written:\n  ${problems.join('\n  ')}`);
    process.exit(1);
  }

  const next = Object.fromEntries(
    [...table.entries()]
      .toSorted(([a], [b]) => a.localeCompare(b))
      .map(([key, ids]) => [key, [...ids].toSorted((a, b) => a.localeCompare(b, 'en', { numeric: true }))]),
  );
  const previous: Record<string, string[]> = JSON.parse(await readFile(JSON_PATH, 'utf8').catch(() => '{}'));
  for (const [key, ids] of Object.entries(next)) {
    const before = new Set(previous[key] ?? []);
    const added = ids.filter((id) => !before.has(id)).length;
    const removed = [...before].filter((id) => !ids.includes(id)).length;
    if (added || removed) console.log(`${key}: ${ids.length} card(s) (+${added} -${removed})`);
  }
  for (const key of Object.keys(previous)) if (!(key in next)) console.log(`${key}: removed`);
  const cardCount = new Set(Object.values(next).flat()).size;
  console.log(
    `${Object.keys(next).length} nicknames over ${cardCount} cards${dryRun ? ' (dry run, not written)' : ''}`,
  );
  if (!dryRun) await writeFile(JSON_PATH, `${JSON.stringify(next, null, 2)}\n`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
