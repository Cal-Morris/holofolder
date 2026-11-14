// Creates and fills the @demo account that the demo videos are filmed on. Idempotent: rerun it any time.
//
//   bun marketing/video/seed-demo.ts
//
// The account is demo@holofolder.com with a comped licence and the username @demo. Its password lives in the
// macOS keychain (service holofolder-demo-account) so record.ts can sign in on the simulator. Writes go through
// the developer API with a short-lived key, revoked when the run ends, like scripts/showcase-sync.ts.
// The collection is a real demo collection: a Kanto binder (generation 1 preset) filled from the 151 set,
// with a few chase cards left empty and on the want list. Nothing here is a price; prices come from the app.
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
const KANTO = { name: 'Kanto', slug: 'kanto', set: 'sv03.5' };
// Left empty in the Kanto binder and put on the want list, so Show mode has something to hunt.
const HUNTING = [6, 9, 3, 151, 150, 94, 149, 143, 65, 145];
// Pockets that hold the set's illustration rare instead of the regular card, for a binder worth flipping through.
const SHOWPIECES = [1, 4, 7, 25, 39, 52, 54, 63, 92, 113, 129, 133, 147];

const exec = promisify(execFile);
type Identity = { kind: 'card'; cardId: string; language: string; finish: 'normal' | 'holo' };
type Slot = {
  id: string;
  version: number;
  target: { kind: string; pokemonId?: number } | null;
  item_id: string | null;
  wants: number;
  want_complete: boolean | null;
};
type Binder = { id: string; version: number; layout_revision: number };
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
    await db.query("BEGIN READ ONLY; SET LOCAL statement_timeout = '15s'");
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
    await seedKanto(read, api, ownerId);
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

async function seedKanto(read: Read, api: Api, ownerId: string) {
  const findBinder = async () =>
    (
      await read<Binder>(
        `SELECT b.id, s.version::int, s.layout_revision::int FROM binders b
         JOIN storage_collection_state s ON s.collection_id = b.id
         WHERE b.owner_user_id = $1 AND b.name = $2 LIMIT 1`,
        [ownerId, KANTO.name],
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
    console.log('create the Kanto binder (generation 1, 3x3)');
    const preview = await api('preview_storage_preset', { presetId: 'generation-1', version: '1' });
    const manifest = preview.manifest as { entries: unknown[] };
    const collectionId = randomUUID();
    await api('create_storage_collection', {
      version: 1,
      operationId: `demo-create-${collectionId}`,
      inventoryRevision: await revision(),
      collectionId,
      name: KANTO.name,
      kind: 'binder',
      defaultPresentation: 'binder',
      location: null,
      grid: { rows: 3, cols: 3 },
      manifest,
      slotIds: manifest.entries.map(() => randomUUID()),
    });
    binder = (await findBinder())!;
  }
  const id = binder.id;
  const slots = () =>
    read<Slot>(
      `SELECT s.id, s.version::int, s.target, p.inventory_item_id AS item_id,
              coalesce(jsonb_array_length(s.wanted_cards), 0) AS wants,
              (s.wanted_cards->0 ? 'card_image' AND s.wanted_cards->0 ? 'card_finish') AS want_complete
       FROM binder_slots s LEFT JOIN inventory_placements p ON p.slot_id = s.id
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

  // One printing per Kanto Pokémon from the 151 set: the regular card, or the illustration rare for showpieces.
  // A finish is needed for the app to count a copy's price (ambiguous foil quotes are left out).
  const cards = await read<{
    id: string;
    name_en: string;
    dex: number;
    local_id: string;
    rarity: string | null;
    illustrator: string | null;
    finish: 'normal' | 'holo';
  }>(
    `SELECT c.id, c.name_en, d.dex_id AS dex, c.local_id, c.rarity, c.illustrator,
            CASE WHEN (c.variants_json->>'normal')::boolean THEN 'normal' ELSE 'holo' END AS finish
     FROM tcg_cards c JOIN tcg_card_dex_ids d ON d.card_id = c.id
     WHERE c.set_id = $1 AND d.dex_id <= 151 ORDER BY d.dex_id, c.local_id_sort`,
    [KANTO.set],
  );
  const byDex = new Map<number, typeof cards>();
  for (const c of cards) byDex.set(c.dex, [...(byDex.get(c.dex) ?? []), c]);
  const pick = (dex: number) => {
    const all = byDex.get(dex) ?? [];
    return SHOWPIECES.includes(dex) ? all.at(-1) : all[0];
  };

  const current = await slots();
  const fills = current.filter(
    (s) =>
      !s.item_id && s.target?.kind === 'pokemon' && !HUNTING.includes(s.target.pokemonId!) && pick(s.target.pokemonId!),
  );
  for (let i = 0; i < fills.length; i += 40) {
    const batch = fills.slice(i, i + 40);
    console.log(`Kanto: add ${batch.length} cards`);
    const b = (await findBinder())!;
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
    if (i % 10 === 0) console.log(`Kanto: set finishes, ${unfinished.length - i} to go`);
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
    console.log('Kanto: empty a chase pocket again');
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
    console.log(`Kanto: want ${wantSlots.length} chase cards`);
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
              card_set: '151',
              local_id: card.local_id,
              ...(card.rarity ? { rarity: card.rarity } : {}),
              ...(card.illustrator ? { illustrator: card.illustrator } : {}),
            },
          ],
        };
      }),
    });
  }
  await api('update_binder_identity', { binderId: id, slug: KANTO.slug });
  await api('update_sharing', { binderId: id, enabled: true, showPrices: true });
  console.log(`Kanto ready: https://holofolder.com/@${USERNAME}/${KANTO.slug}`);
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
