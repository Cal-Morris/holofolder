// bun run card-assets lattice [--report]: compares our catalogue with Card Lattice (https://cardlattice.com,
// CC0 data from https://github.com/cardlattice/cardlattice-data). Reads Postgres in a read-only transaction and writes
// only .cache/card-assets/lattice/.
//
// Default: what Card Lattice has that we don't (sets, cards, a language's name, illustrators), as candidates to add.
// --report: what we hold that Card Lattice and TCGdex don't, written as report.md to share with those projects.
import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Client } from 'pg';
import {
  compareWithLattice,
  LATTICE_DATA_BASE,
  parseLatticeCatalogue,
  parseLatticeManifest,
  type OurCard,
  type OurSet,
} from '../../lib/card-assets/lattice';
import { parseCsv } from '../../lib/card-assets/ledger';
import { GAP_SERIES_ID } from '../../lib/card-gap-fill';
import { getMirrorDatabaseUrl } from '../../lib/card-db-sync';
import { loadProjectEnvFiles } from '../../lib/load-project-env';

const OUT = path.resolve('.cache/card-assets/lattice');
const LEDGER = path.resolve('card-assets/pokemon/tcg/ledger/en');

async function fetchLattice() {
  const manifest = parseLatticeManifest(await (await fetch(`${LATTICE_DATA_BASE}manifest.json`)).json());
  const response = await fetch(`${LATTICE_DATA_BASE}${manifest.filename}`);
  if (!response.ok) throw new Error(`Card Lattice catalogue: HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.byteLength !== manifest.byteSize || createHash('sha256').update(bytes).digest('hex') !== manifest.sha256)
    throw new Error('Card Lattice catalogue does not match its manifest');
  return { manifest, catalogue: parseLatticeCatalogue(JSON.parse(bytes.toString('utf8'))) };
}

async function loadOurs() {
  const db = new Client({ connectionString: getMirrorDatabaseUrl() });
  await db.connect();
  try {
    await db.query('begin read only');
    await db.query("set local statement_timeout = '120s'");
    const sets = await db.query<{ id: string; name_json: Record<string, string> }>(
      'select id, name_json from public.tcg_sets',
    );
    const cards = await db.query<{
      id: string;
      set_id: string;
      series_id: string;
      local_id: string;
      name_json: Record<string, string>;
      illustrator: string | null;
      image_languages_json: string[];
    }>('select id, set_id, series_id, local_id, name_json, illustrator, image_languages_json from public.tcg_cards');
    return { sets: sets.rows, cards: cards.rows };
  } finally {
    await db.query('rollback').catch(() => {});
    await db.end();
  }
}

/** What we hold that TCGdex doesn't: cards we added from other sources, and English images it has no print for. */
async function tcgdexGaps(cards: Awaited<ReturnType<typeof loadOurs>>['cards']) {
  const byId = new Map(cards.map((card) => [card.id, card]));
  const englishImages: Array<{ cardId: string; source: string }> = [];
  for (const file of (await readdir(LEDGER)).filter((name) => name.endsWith('.csv'))) {
    for (const row of parseCsv(await readFile(path.join(LEDGER, file), 'utf8'))) {
      const card = byId.get(row.card_id);
      if (card && row.source && row.source !== 'tcgdex' && !card.image_languages_json.includes('en'))
        englishImages.push({ cardId: row.card_id, source: row.source });
    }
  }
  const supplements = cards
    .filter((card) => card.series_id === GAP_SERIES_ID)
    .map((card) => ({ cardId: card.id, setId: card.set_id }));
  return { supplements, englishImages };
}

const countBy = <T>(items: readonly T[], key: (item: T) => string) =>
  [...Map.groupBy(items, key)].map(([name, group]) => [name, group.length] as const).sort((a, b) => b[1] - a[1]);

export async function run() {
  await loadProjectEnvFiles();
  const report = process.argv.includes('--report');
  const [{ manifest, catalogue }, ours] = await Promise.all([fetchLattice(), loadOurs()]);
  const ourSets: OurSet[] = ours.sets.map((set) => ({ id: set.id, names: set.name_json }));
  const ourCards: OurCard[] = ours.cards.map((card) => ({
    id: card.id,
    setId: card.set_id,
    localId: card.local_id,
    names: card.name_json,
    illustrator: card.illustrator,
  }));
  const result = compareWithLattice(catalogue, ourSets, ourCards);
  await mkdir(OUT, { recursive: true });
  const source = { cardLatticeCommit: manifest.sourceCommit, generatedAt: new Date().toISOString() };

  if (!report) {
    const { missingSets, missingCards, missingLanguage, missingIllustrator } = result;
    await writeFile(
      path.join(OUT, 'gaps.json'),
      JSON.stringify({ ...source, missingSets, missingCards, missingLanguage, missingIllustrator }, null, 2),
    );
    console.log(
      JSON.stringify(
        {
          ...source,
          missingSets: missingSets.length,
          missingSetPrintings: missingSets.reduce((sum, set) => sum + set.printings, 0),
          missingSetsByLanguage: Object.fromEntries(countBy(missingSets, (set) => set.language)),
          missingCards: missingCards.length,
          missingCardsBySet: Object.fromEntries(countBy(missingCards, (card) => `${card.setId} ${card.language}`)),
          missingLanguage: Object.fromEntries(countBy(missingLanguage, (card) => card.language)),
          missingIllustrator: missingIllustrator.length,
          wrote: path.relative(process.cwd(), path.join(OUT, 'gaps.json')),
        },
        null,
        2,
      ),
    );
    return;
  }

  const tcgdex = await tcgdexGaps(ours.cards);
  const { setsNotInLattice, notInLattice, illustratorNotInLattice } = result;
  const latticeLanguages = new Set(catalogue.printings.map((printing) => printing.language));
  const lines = [
    '# What Holo Folder holds that other catalogues don’t',
    '',
    `Generated ${source.generatedAt} against Card Lattice ${manifest.sourceCommit.slice(0, 12)}. Card Lattice covers ${[...latticeLanguages].sort().join(', ')}; sets in other languages are listed by count only.`,
    '',
    '## Card Lattice',
    '',
    `### Sets we hold that Card Lattice doesn’t (${setsNotInLattice.length})`,
    '',
    '| Language | Sets | Cards |',
    '| --- | ---: | ---: |',
    ...[...Map.groupBy(setsNotInLattice, (set) => set.language)]
      .sort((a, b) => b[1].length - a[1].length)
      .map(
        ([language, sets]) => `| ${language} | ${sets.length} | ${sets.reduce((sum, set) => sum + set.cards, 0)} |`,
      ),
    '',
    ...setsNotInLattice
      .filter((set) => latticeLanguages.has(set.language))
      .sort((a, b) => a.language.localeCompare(b.language) || a.setId.localeCompare(b.setId))
      .map((set) => `- \`${set.setId}\` ${set.name} (${set.language}, ${set.cards} cards)`),
    '',
    `### Cards missing from sets Card Lattice has (${notInLattice.reduce((sum, set) => sum + set.numbers.length, 0)})`,
    '',
    ...notInLattice.map((set) => `- \`${set.setId}\` (${set.language}): ${set.numbers.join(', ')}`),
    '',
    `### Illustrators we know and Card Lattice doesn’t (${illustratorNotInLattice.length})`,
    '',
    'Per printing in report.json.',
    '',
    ...countBy(illustratorNotInLattice, (card) => `${card.setId} (${card.language})`).map(
      ([set, count]) => `- \`${set.split(' ')[0]}\` ${set.split(' ')[1]}: ${count} printings`,
    ),
    '',
    '## TCGdex',
    '',
    `### Cards we added from other sources (${tcgdex.supplements.length})`,
    '',
    ...countBy(tcgdex.supplements, (card) => card.setId).map(
      ([set, count]) => `- \`${set}\`: ${count} cards`,
    ),
    '',
    `### English images TCGdex has no print for (${tcgdex.englishImages.length})`,
    '',
    '| Source | Cards |',
    '| --- | ---: |',
    ...countBy(tcgdex.englishImages, (card) => card.source).map(([name, count]) => `| ${name} | ${count} |`),
    '',
  ];
  await writeFile(path.join(OUT, 'report.md'), lines.join('\n'));
  await writeFile(
    path.join(OUT, 'report.json'),
    JSON.stringify({ ...source, cardLattice: { setsNotInLattice, notInLattice, illustratorNotInLattice }, tcgdex }, null, 2),
  );
  console.log(
    JSON.stringify(
      {
        ...source,
        cardLattice: {
          setsNotInLattice: setsNotInLattice.length,
          cardsMissingFromItsSets: notInLattice.reduce((sum, set) => sum + set.numbers.length, 0),
          illustrators: illustratorNotInLattice.length,
        },
        tcgdex: { supplements: tcgdex.supplements.length, englishImages: tcgdex.englishImages.length },
        wrote: path.relative(process.cwd(), path.join(OUT, 'report.md')),
      },
      null,
      2,
    ),
  );
}
