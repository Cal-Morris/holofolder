// Creates and fills the @demo account that the demo videos are filmed on. Idempotent: rerun it any time.
//
//   bun marketing/video/seed-demo.ts
//
// The account is demo@holofolder.com with a comped licence and the username @demo. Its password lives in the
// macOS keychain (service holofolder-demo-account) so record.ts can sign in on the simulator. Writes go through
// the developer API with a short-lived key, revoked when the run ends, like scripts/showcase-sync.ts.
// The collection is a real demo collection: a Kanto binder (generation 1 preset) filled from the 151 set,
// with a few chase cards left empty and on the want list, and a National Dex binder with a card for every Pokémon. Nothing here is a price; prices come from the app.
/* oxlint-disable react-doctor/async-await-in-loop -- API writes must run in order against one revision */
import { execFile } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { promisify } from 'node:util';
import { Client } from 'pg';
import { createAdminClient } from '../../lib/supabase/admin';
import { createDeveloperKey } from '../../lib/server/developer-access/key-secret';
import { DEVELOPER_OPERATIONS } from '../../lib/developer-api/operations';
import { DEVELOPER_PERMISSIONS } from '../../lib/developer-api/permissions';
import { loadProjectEnvFiles } from '../../lib/load-project-env';

const API = 'https://app.holofolder.com/app/api/v1';
const EMAIL = 'demo@holofolder.com';
const USERNAME = 'demo';
const DISPLAY_NAME = 'Holo Folder demo';
const KEYCHAIN = 'holofolder-demo-account';
const KEY_NAME = 'demo-seed';
const FINISH_SQL = "CASE WHEN (c.variants_json->>'normal')::boolean THEN 'normal' ELSE 'holo' END AS finish";
const CARD_COLUMNS = `c.id, c.name_en, d.dex_id AS dex, c.local_id, c.rarity, c.illustrator, ${FINISH_SQL}`;
interface BinderSpec {
  name: string;
  slug: string;
  preset: string;
  set: string; // shown on wants
  // Candidate printings per Pokémon, in preference order; the first is used, the last for showpieces.
  cardsSql: string;
  cardsParams: unknown[];
  hunting: number[]; // left empty and put on the want list, so Show mode has something to hunt
  showpieces: number[]; // pockets that hold the last candidate (an illustration rare) instead of the first
  grid: { rows: number; cols: number };
  // Read-only: take each Pokémon's card from this public binder where it has one (Cal asked for his @cal/national picks).
  copyFrom?: { username: string; slug: string };
}
const BINDERS: BinderSpec[] = [
  {
    name: 'Kanto',
    slug: 'kanto',
    preset: 'generation-1',
    set: '151',
    cardsSql: `SELECT ${CARD_COLUMNS} FROM tcg_cards c JOIN tcg_card_dex_ids d ON d.card_id = c.id
               WHERE c.set_id = 'sv03.5' AND d.dex_id <= 151 ORDER BY d.dex_id, c.local_id_sort`,
    cardsParams: [],
    hunting: [6, 9, 3, 151, 150, 94, 149, 143, 65, 145],
    showpieces: [1, 4, 7, 25, 39, 52, 54, 63, 92, 113, 129, 133, 147],
    grid: { rows: 3, cols: 3 },
  },
  {
    // Every Pokémon: its most recent ordinary English printing (one Pokémon per card, so no tag teams).
    name: 'National Dex',
    slug: 'national-dex',
    preset: 'national-dex',
    set: '',
    cardsSql: `WITH single AS (SELECT card_id, min(dex_id) AS dex_id FROM tcg_card_dex_ids GROUP BY card_id HAVING count(*) = 1)
               SELECT DISTINCT ON (d.dex_id) ${CARD_COLUMNS}
               FROM single d JOIN tcg_cards c ON c.id = d.card_id JOIN tcg_sets s ON s.id = c.set_id
               WHERE c.image_languages_json ? 'en'
               ORDER BY d.dex_id, (c.rarity IN ('Common', 'Uncommon', 'Rare')) DESC, s.release_date DESC NULLS LAST`,
    cardsParams: [],
    hunting: [],
    showpieces: [],
    grid: { rows: 4, cols: 4 },
    copyFrom: { username: 'cal', slug: 'national' },
  },
];

const exec = promisify(execFile);
type Identity = { kind: 'card'; cardId: string; language: string; finish: string };
type Slot = {
  id: string;
  version: number;
  target: { kind: string; pokemonId?: number } | null;
  item_id: string | null;
  item_version: number | null;
  placement_version: number | null;
  card_id: string | null;
  wants: number;
  want_complete: boolean | null;
};
type Binder = { id: string; version: number; layout_revision: number; rows: number; cols: number };
type Api = (name: string, input: Record<string, unknown>) => Promise<Record<string, unknown>>;

export async function demoPassword(): Promise<string> {
  try {
    return (await exec('security', ['find-generic-password', '-s', KEYCHAIN, '-a', EMAIL, '-w'])).stdout.trim();
  } catch {
    const password = randomBytes(18).toString('base64url');
    await exec('security', ['add-generic-password', '-s', KEYCHAIN, '-a', EMAIL, '-w', password]);
    return password;
  }
}

async function main() {
  await loadProjectEnvFiles();
  const url = new URL(process.env.POSTGRES_URL_NON_POOLING ?? process.env.DATABASE_URL ?? '');
  url.searchParams.delete('sslmode');
  const db = new Client({ connectionString: url.toString(), ssl: { rejectUnauthorized: false } });
  await db.connect();
  const read = async <T>(sql: string, params: unknown[] = []): Promise<T[]> => {
    await db.query("BEGIN READ ONLY; SET LOCAL statement_timeout = '60s'");
    try {
      return (await db.query(sql, params)).rows as T[];
    } finally {
      await db.query('ROLLBACK');
    }
  };
  let keyId: string | null = null;
  try {
    const ownerId = await ensureAccount(db, read);
    const key = createDeveloperKey();
    await db.query(
      'UPDATE developer_api_keys SET revoked_at = now() WHERE actor_id = $1 AND name = $2 AND revoked_at IS NULL',
      [ownerId, KEY_NAME],
    );
    await db.query('SELECT create_developer_api_key($1, $2, $3, $4, $5, $6)', [
      key.id,
      ownerId,
      KEY_NAME,
      key.digest,
      [...DEVELOPER_PERMISSIONS],
      30,
    ]);
    keyId = key.id;
    const api = apiClient(key.key);

    const [identity] = await read<{ username: string | null }>(
      'SELECT username FROM account_identities WHERE user_id = $1',
      [ownerId],
    );
    if (identity?.username !== USERNAME) {
      console.log(`set username @${USERNAME}`);
      await api('update_identity', { username: USERNAME, displayName: DISPLAY_NAME });
    }
    for (const spec of BINDERS) await seedBinder(read, api, ownerId, spec);
    // Show mode's "Bought" button records purchases on the account; start every filming session at zero.
    const purchases = (await api('list_show_purchases', {})) as { data?: { id: string }[] };
    for (const p of purchases.data ?? []) await api('remove_show_purchase', { clientId: p.id });
    if (purchases.data?.length) console.log(`removed ${purchases.data.length} show purchases`);
  } finally {
    if (keyId) await db.query('UPDATE developer_api_keys SET revoked_at = now() WHERE id = $1', [keyId]);
    await db.end();
  }
}

async function ensureAccount(db: Client, read: Read): Promise<string> {
  const password = await demoPassword();
  let ownerId = (await read<{ id: string }>('SELECT id FROM auth.users WHERE email = $1', [EMAIL]))[0]?.id;
  if (!ownerId) {
    console.log(`create account ${EMAIL}`);
    const { data, error } = await createAdminClient().auth.admin.createUser({
      email: EMAIL,
      password,
      email_confirm: true,
      user_metadata: { display_name: DISPLAY_NAME },
    });
    if (error || !data.user) throw new Error('Could not create the demo account: ' + error?.message);
    ownerId = data.user.id;
  }
  // 'manual' is the comped-licence source the billing check allows, as for @showcase.
  await db.query("INSERT INTO perpetual_licences(owner_user_id, source) VALUES ($1, 'manual') ON CONFLICT DO NOTHING", [
    ownerId,
  ]);
  return ownerId;
}

type Read = <T>(sql: string, params?: unknown[]) => Promise<T[]>;

async function seedBinder(read: Read, api: Api, ownerId: string, spec: BinderSpec) {
  const { hunting: HUNTING, showpieces: SHOWPIECES } = spec;
  const findBinder = async () =>
    (
      await read<Binder>(
        `SELECT b.id, s.version::int, s.layout_revision::int, b.binder_rows AS rows, b.binder_cols AS cols FROM binders b
         JOIN storage_collection_state s ON s.collection_id = b.id
         WHERE b.owner_user_id = $1 AND b.name = $2 LIMIT 1`,
        [ownerId, spec.name],
      )
    )[0];
  const revision = async () =>
    Number(
      (
        await read<{ r: string }>(
          'SELECT inventory_revision AS r FROM inventory_owner_state WHERE owner_user_id = $1',
          [ownerId],
        )
      )[0]?.r ?? 0,
    );

  let binder = await findBinder();
  if (!binder) {
    console.log(`create the ${spec.name} binder (${spec.preset}, ${spec.grid.rows}x${spec.grid.cols})`);
    const preview = await api('preview_storage_preset', { presetId: spec.preset, version: '1' });
    const manifest = preview.manifest as { entries: unknown[] };
    const collectionId = randomUUID();
    await api('create_storage_collection', {
      version: 1,
      operationId: `demo-create-${collectionId}`,
      inventoryRevision: await revision(),
      collectionId,
      name: spec.name,
      kind: 'binder',
      defaultPresentation: 'binder',
      location: null,
      grid: spec.grid,
      manifest,
      slotIds: manifest.entries.map(() => randomUUID()),
    });
    binder = (await findBinder())!;
  }
  const id = binder.id;
  if (binder.rows !== spec.grid.rows || binder.cols !== spec.grid.cols) {
    console.log(`${spec.name}: grid to ${spec.grid.rows}x${spec.grid.cols}`);
    const { rows, cols } = spec.grid;
    const review = await api('set_binder_layout', { id, rows, cols, dryRun: true });
    await api('set_binder_layout', {
      id,
      rows,
      cols,
      operationId: `demo-layout-${randomUUID()}`,
      ...(review.preconditions as Record<string, unknown>),
    });
  }
  const slots = () =>
    read<Slot>(
      `SELECT s.id, s.version::int, s.target, p.inventory_item_id AS item_id, i.version::int AS item_version,
              p.version::int AS placement_version, i.identity->>'cardId' AS card_id,
              coalesce(jsonb_array_length(s.wanted_cards), 0) AS wants,
              (s.wanted_cards->0 ? 'card_image' AND s.wanted_cards->0 ? 'card_finish') AS want_complete
       FROM binder_slots s LEFT JOIN inventory_placements p ON p.slot_id = s.id
       LEFT JOIN inventory_items i ON i.id = p.inventory_item_id
       WHERE s.collection_id = $1 ORDER BY s.position`,
      [id],
    );
  const pre = (s: Slot) => ({
    id: s.id,
    version: s.version,
    inventoryItemId: null,
    itemVersion: null,
    placementVersion: null,
  });

  const cards = await read<{
    id: string;
    name_en: string;
    dex: number;
    local_id: string;
    rarity: string | null;
    illustrator: string | null;
    finish: 'normal' | 'holo';
  }>(spec.cardsSql, spec.cardsParams);
  const byDex = new Map<number, typeof cards>();
  for (const c of cards) byDex.set(c.dex, [...(byDex.get(c.dex) ?? []), c]);
  const source = new Map<number, { id: string; finish: string }>();
  if (spec.copyFrom)
    for (const r of await read<{ dex: number; id: string; finish: string | null }>(
      `SELECT (s.target->>'pokemonId')::int AS dex, i.identity->>'cardId' AS id, i.identity->>'finish' AS finish
       FROM binders b JOIN account_identities a ON a.user_id = b.owner_user_id
       JOIN binder_public_slugs ps ON ps.binder_id = b.id AND ps.is_active AND ps.slug = $2
       JOIN binder_slots s ON s.collection_id = b.id JOIN inventory_placements p ON p.slot_id = s.id
       JOIN inventory_items i ON i.id = p.inventory_item_id
       WHERE a.username = $1 AND s.target->>'kind' = 'pokemon' AND i.identity->>'kind' = 'card'`,
      [spec.copyFrom.username, spec.copyFrom.slug],
    ))
      source.set(r.dex, { id: r.id, finish: r.finish ?? byDex.get(r.dex)?.[0]?.finish ?? 'holo' });
  const pick = (dex: number): { id: string; finish: string } | undefined => {
    if (source.has(dex)) return source.get(dex);
    const all = byDex.get(dex) ?? [];
    return SHOWPIECES.includes(dex) ? all.at(-1) : all[0];
  };

  // Copies that aren't the card this pocket should hold now (e.g. after switching to the source binder's picks).
  const changed = (await slots()).filter(
    (s) => s.item_id && s.target?.kind === 'pokemon' && pick(s.target.pokemonId!)?.id !== s.card_id,
  );
  // Same split-on-rejection approach as `assign` below: a rejected batch is halved until the odd one out is found.
  const swapOut = async (batch: Slot[]): Promise<void> => {
    const b = (await findBinder())!;
    try {
      await api('execute_inventory_commands', {
        operationId: `demo-swap-${randomUUID()}`,
        inventoryRevision: await revision(),
        collections: [{ collectionId: id, version: b.version, layoutRevision: b.layout_revision }],
        commands: batch.map((u) => ({
          kind: 'removeOwned',
          item: {
            itemId: u.item_id,
            itemVersion: u.item_version,
            placement: {
              collectionId: id,
              slot: {
                id: u.id,
                version: u.version,
                inventoryItemId: u.item_id,
                itemVersion: u.item_version,
                placementVersion: u.placement_version,
              },
            },
          },
        })),
      });
    } catch (error) {
      if (!String(error).includes('invalid_input')) throw error;
      if (batch.length === 1) {
        console.log(`${spec.name}: keep ${batch[0].card_id}, it can't be removed`);
        return;
      }
      const half = Math.ceil(batch.length / 2);
      await swapOut(batch.slice(0, half));
      await swapOut(batch.slice(half));
    }
  };
  // Removals are heavier than adds on the storage side and 503 in batches of 40, so go 15 at a time.
  for (let i = 0; i < changed.length; i += 15) {
    console.log(`${spec.name}: swap out ${Math.min(15, changed.length - i)} cards, ${changed.length - i} to go`);
    await swapOut(changed.slice(i, i + 15));
  }

  const current = await slots();
  const fills = current.filter(
    (s) =>
      !s.item_id && s.target?.kind === 'pokemon' && !HUNTING.includes(s.target.pokemonId!) && pick(s.target.pokemonId!),
  );
  // Batches are all-or-nothing, and a few catalogue printings don't fit their pocket (the storage rules reject them
  // with invalid_input), so split a rejected batch in half until the odd card out is found, then skip it.
  const assign = async (batch: Slot[]): Promise<void> => {
    const b = (await findBinder())!;
    try {
      await api('execute_inventory_commands', {
        operationId: `demo-inv-${randomUUID()}`,
        inventoryRevision: await revision(),
        collections: [{ collectionId: id, version: b.version, layoutRevision: b.layout_revision }],
        commands: batch.map((s) => ({
          kind: 'assign',
          selection: {
            kind: 'catalog',
            identity: {
              kind: 'card',
              cardId: pick(s.target!.pokemonId!)!.id,
              language: 'en',
              finish: pick(s.target!.pokemonId!)!.finish,
            } satisfies Identity,
            newItemId: randomUUID(),
          },
          destination: { collectionId: id, slot: pre(s) },
          occupied: 'cancel',
          fulfillWant: null,
        })),
      });
    } catch (error) {
      if (!String(error).includes('invalid_input')) throw error;
      if (batch.length === 1) {
        console.log(`${spec.name}: skip ${pick(batch[0].target!.pokemonId!)!.id}, it doesn't fit its pocket`);
        return;
      }
      const half = Math.ceil(batch.length / 2);
      await assign(batch.slice(0, half));
      await assign(batch.slice(half));
    }
  };
  for (let i = 0; i < fills.length; i += 40) {
    console.log(`${spec.name}: add ${Math.min(40, fills.length - i)} cards, ${fills.length - i} to go`);
    await assign(fills.slice(i, i + 40));
  }

  // Copies from before finishes were set get one now.
  const finishById = new Map(cards.map((c) => [c.id, c.finish]));
  const unfinished = await read<
    { item_id: string; item_version: number; placement_version: number; card_id: string } & Slot
  >(
    `SELECT s.id, s.version::int, i.id AS item_id, i.version::int AS item_version, p.version::int AS placement_version,
            i.identity->>'cardId' AS card_id
     FROM binder_slots s JOIN inventory_placements p ON p.slot_id = s.id JOIN inventory_items i ON i.id = p.inventory_item_id
     WHERE s.collection_id = $1 AND i.identity->>'finish' IS NULL`,
    [id],
  );
  for (let i = 0; i < unfinished.length; i += 1) {
    // One copy per request: a batch of finish changes is rejected as a whole.
    const batch = unfinished.slice(i, i + 1);
    if (i % 10 === 0) console.log(`${spec.name}: set finishes, ${unfinished.length - i} to go`);
    await new Promise((resolve) => setTimeout(resolve, 1500)); // gentle: the storage RPC returns 503 under a burst
    const b = (await findBinder())!;
    await api('execute_inventory_commands', {
      operationId: `demo-finish-${randomUUID()}`,
      inventoryRevision: await revision(),
      collections: [{ collectionId: id, version: b.version, layoutRevision: b.layout_revision }],
      commands: batch.map((u) => ({
        kind: 'setFinish',
        item: {
          itemId: u.item_id,
          itemVersion: u.item_version,
          placement: {
            collectionId: id,
            slot: {
              id: u.id,
              version: u.version,
              inventoryItemId: u.item_id,
              itemVersion: u.item_version,
              placementVersion: u.placement_version,
            },
          },
        },
        finish: finishById.get(u.card_id) ?? 'holo',
      })),
    });
  }

  // A chase pocket must stay empty: remove any copy that filming put there (e.g. Show mode's add button).
  const strays = await read<{
    id: string;
    version: number;
    item_id: string;
    item_version: number;
    placement_version: number;
  }>(
    `SELECT s.id, s.version::int, i.id AS item_id, i.version::int AS item_version, p.version::int AS placement_version
     FROM binder_slots s JOIN inventory_placements p ON p.slot_id = s.id JOIN inventory_items i ON i.id = p.inventory_item_id
     WHERE s.collection_id = $1 AND (s.target->>'pokemonId')::int = ANY($2)`,
    [id, HUNTING],
  );
  for (const u of strays) {
    console.log(`${spec.name}: empty a chase pocket again`);
    const b = (await findBinder())!;
    const slot = {
      id: u.id,
      version: u.version,
      inventoryItemId: u.item_id,
      itemVersion: u.item_version,
      placementVersion: u.placement_version,
    };
    await api('execute_inventory_commands', {
      operationId: `demo-stray-${randomUUID()}`,
      inventoryRevision: await revision(),
      collections: [{ collectionId: id, version: b.version, layoutRevision: b.layout_revision }],
      commands: [
        {
          kind: 'removeOwned',
          item: { itemId: u.item_id, itemVersion: u.item_version, placement: { collectionId: id, slot } },
        },
      ],
    });
  }

  // The hunting list: each empty chase pocket wants the set's top printing of that Pokémon.
  const wantSlots = (await slots()).filter(
    (s) => !s.item_id && s.target?.kind === 'pokemon' && HUNTING.includes(s.target.pokemonId!) && !s.want_complete,
  );
  if (wantSlots.length) {
    console.log(`${spec.name}: want ${wantSlots.length} chase cards`);
    // The card image, as the app stores it on a want, so Show mode can draw the card.
    const images = new Map<string, string>();
    for (const s of wantSlots) {
      const cardId = byDex.get(s.target!.pokemonId!)!.at(-1)!.id;
      const card = await api('get_card', { id: cardId, language: 'en' });
      if (typeof card.image === 'string') images.set(cardId, card.image);
    }
    const b = (await findBinder())!;
    await api('execute_slot_commands', {
      collectionId: id,
      operationId: `demo-slots-${randomUUID()}`,
      inventoryRevision: await revision(),
      collectionVersion: b.version,
      layoutRevision: b.layout_revision,
      commands: wantSlots.map((s) => {
        const card = byDex.get(s.target!.pokemonId!)!.at(-1)!;
        return {
          kind: 'update',
          slot: pre(s),
          target: s.target,
          wantedCards: [
            {
              card_id: card.id,
              card_name: card.name_en,
              added_at: new Date().toISOString(),
              card_language: 'en',
              card_finish: 'holo',
              ...(images.has(card.id) ? { card_image: images.get(card.id) } : {}),
              card_set: spec.set,
              local_id: card.local_id,
              ...(card.rarity ? { rarity: card.rarity } : {}),
              ...(card.illustrator ? { illustrator: card.illustrator } : {}),
            },
          ],
        };
      }),
    });
  }
  await api('update_binder_identity', { binderId: id, slug: spec.slug });
  await api('update_sharing', { binderId: id, enabled: true, showPrices: true });
  console.log(`${spec.name} ready: https://holofolder.com/@${USERNAME}/${spec.slug}`);
}

function apiClient(key: string): Api {
  let minute = 0;
  let writes = 0;
  return async (name, input) => {
    const operation = DEVELOPER_OPERATIONS.find((op) => op.name === name)!;
    const body: Record<string, unknown> = { ...(operation.schema.parse(input) as Record<string, unknown>) };
    const path = operation.path.replace(/\{([^}]+)\}/g, (_m, field: string) => {
      const value = body[field];
      delete body[field];
      return encodeURIComponent(String(value));
    });
    // Stay under the API's 20 writes a minute.
    const now = Math.floor(Date.now() / 60000);
    if (now !== minute) [minute, writes] = [now, 0];
    if (operation.write && ++writes > 18) {
      await new Promise((resolve) => setTimeout(resolve, 60500 - (Date.now() % 60000)));
      [minute, writes] = [Math.floor(Date.now() / 60000), 1];
    }
    const send = () =>
      fetch(
        API + path + (operation.method === 'GET' ? `?${new URLSearchParams(body as Record<string, string>)}` : ''),
        {
          method: operation.method,
          headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
          body: operation.method === 'GET' ? undefined : JSON.stringify(body),
          signal: AbortSignal.timeout(60000),
        },
      );
    // 503 storage_unavailable and dropped connections are transient; the same operationId makes a retry safe.
    let response: Response | null = null;
    for (let retry = 0; retry < 4; retry++) {
      response = await send().catch(() => null);
      if (response && response.status !== 503) break;
      await new Promise((resolve) => setTimeout(resolve, 15000));
    }
    if (!response) throw new Error(`${name} failed: no response`);
    const result = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (!response.ok) throw new Error(`${name} failed (${response.status}): ${JSON.stringify(result)}`);
    return result;
  };
}

if (import.meta.main)
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
