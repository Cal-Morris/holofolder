import { isDeepStrictEqual } from 'node:util';
import { Client } from 'pg';
import { getMirrorDatabaseUrl, type MirrorCardRow, type MirrorSetRow } from '../lib/card-db-sync';
import { loadProjectEnvFiles } from '../lib/load-project-env';
import { applyTcgplayerVariants, fetchTcgplayerVariants } from '../lib/tcgplayer-variants';

/**
 * Backfills TCGplayer finishes (lib/tcgplayer-variants.ts) onto cards already in the mirror. Card syncs apply them
 * to the sets they touch; this covers everything synced before that. Dry run unless `--apply`; `--set a,b` limits
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
    const variants = await fetchTcgplayerVariants(sets, cards, console.log);
    const changed = cards
      .map((card) => applyTcgplayerVariants(card, variants.get(card.id)))
      .filter((card, index) => !isDeepStrictEqual(card, cards[index]));
    const gained = (flag: 'normal' | 'holo' | 'reverse') =>
      changed.filter((c) => c.variants_json[flag] && !cards.find((o) => o.id === c.id)?.variants_json[flag]).length;
    console.log(
      `${sets.length} sets, ${cards.length} cards, ${variants.size} matched on TCGplayer, ${changed.length} to update ` +
        `(+normal ${gained('normal')}, +holo ${gained('holo')}, +reverse ${gained('reverse')})`,
    );
    if (!applying) console.log('Dry run. Pass --apply to write.');
    else if (changed.length) {
      await client.query(
        `update public.tcg_cards c set variants_json = r.variants_json, external_ids_json = r.external_ids_json
       from jsonb_to_recordset($1::jsonb) as r(id text, variants_json jsonb, external_ids_json jsonb) where c.id = r.id`,
        [
          JSON.stringify(
            changed.map(({ id, variants_json, external_ids_json }) => ({ id, variants_json, external_ids_json })),
          ),
        ],
      );
      console.log(`Updated ${changed.length} cards.`);
    }
  } finally {
    await client.end();
  }
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
