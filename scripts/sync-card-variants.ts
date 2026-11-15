import { isDeepStrictEqual } from 'node:util';
import { Client } from 'pg';
import { getMirrorDatabaseUrl, type MirrorCardRow, type MirrorSetRow } from '../lib/card-db-sync';
import { loadProjectEnvFiles } from '../lib/load-project-env';
import {
  applyTcgplayerVariants,
  fetchTcgplayerVariants,
  newTcgplayerLinks,
  TCGPLAYER_LINK_SOURCE,
  tcgplayerCard,
} from '../lib/tcgplayer-variants';

/**
 * Backfills TCGplayer finishes (lib/tcgplayer-variants.ts) onto cards already in the mirror, and stores each new
 * card ↔ TCGplayer product link. Card syncs do both for the sets they touch; this covers everything synced before
 * that. Cards whose number match contradicts an id we hold are listed as conflicts and left alone. Dry run unless `--apply`; `--set a,b` limits
 * it. Afterwards, expire the `card-catalog` cache (sync any one set through /api/admin/sync-card-db).
 */
const args = process.argv.slice(2);
const applying = args.includes('--apply');
const only = args.includes('--set') ? new Set(args[args.indexOf('--set') + 1].split(',')) : null;

async function main() {
  await loadProjectEnvFiles();
  const client = new Client({ connectionString: getMirrorDatabaseUrl() });
  await client.connect();
  try {
    const sets = (
      await client.query<Pick<MirrorSetRow, 'id' | 'name_en' | 'release_date'>>(
        'select id, name_en, release_date::text from public.tcg_sets order by id',
      )
    ).rows.filter((s) => !only || only.has(s.id));
    const cards = (
      await client.query<
        Pick<MirrorCardRow, 'id' | 'set_id' | 'local_id' | 'name_en' | 'variants_json' | 'external_ids_json'>
      >(
        'select id, set_id, local_id, name_en, variants_json, external_ids_json from public.tcg_cards where set_id = any($1::text[])',
        [sets.map((s) => s.id)],
      )
    ).rows;
    const stored = await client.query<{ card_id: string; source_card_id: string; source_set_id: string | null }>(
      'select card_id, source_card_id, source_set_id from public.tcg_card_external_sources where source = $1',
      [TCGPLAYER_LINK_SOURCE],
    );
    const links = new Map(stored.rows.map((row) => [row.card_id, row]));
    const { matches, conflicts } = await fetchTcgplayerVariants(
      sets,
      cards.map((card) => tcgplayerCard(card, links.get(card.id))),
      console.log,
    );
    const fresh = newTcgplayerLinks(matches, new Set(links.keys()));
    const changed = cards
      .map((card) => applyTcgplayerVariants(card, matches.get(card.id)?.variants))
      .filter((card, index) => !isDeepStrictEqual(card, cards[index]));
    const gained = (flag: 'normal' | 'holo' | 'reverse') =>
      changed.filter((c) => c.variants_json[flag] && !cards.find((o) => o.id === c.id)?.variants_json[flag]).length;
    console.log(
      `${sets.length} sets, ${cards.length} cards, ${matches.size} matched on TCGplayer ` +
        `(${[...matches.values()].filter((m) => m.by === 'id').length} by an id we hold), ${changed.length} to update ` +
        `(+normal ${gained('normal')}, +holo ${gained('holo')}, +reverse ${gained('reverse')}), ` +
        `${fresh.length} new links, ${conflicts.length} conflicts`,
    );
    if (conflicts.length) console.log(`Conflicts (left on TCGdex's flags): ${conflicts.sort().join(', ')}`);
    if (!applying) console.log('Dry run. Pass --apply to write.');
    else {
      await client.query(
        `insert into public.tcg_card_external_sources (card_id, source, source_card_id, source_set_id, raw_json)
         select card_id, source, source_card_id, source_set_id, raw_json
         from jsonb_to_recordset($1::jsonb) as r(card_id text, source text, source_card_id text, source_set_id text, raw_json jsonb)
         on conflict (card_id, source) do nothing`,
        [JSON.stringify(fresh)],
      );
      await client.query(
        `update public.tcg_cards c set variants_json = r.variants_json, external_ids_json = r.external_ids_json
       from jsonb_to_recordset($1::jsonb) as r(id text, variants_json jsonb, external_ids_json jsonb) where c.id = r.id`,
        [
          JSON.stringify(
            changed.map(({ id, variants_json, external_ids_json }) => ({ id, variants_json, external_ids_json })),
          ),
        ],
      );
      console.log(`Updated ${changed.length} cards and stored ${fresh.length} links.`);
    }
  } finally {
    await client.end();
  }
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
