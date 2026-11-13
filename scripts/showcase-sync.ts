// Copies each filled page of @cal's "Themed pages" binder into its own public @showcase binder.
// Read-only on the source. Writes go through the developer API as the showcase account, with a
// short-lived key that is revoked when the run ends. Per-page names, slugs and views: showcase-pages.json.
//
//   bun run scripts/showcase-sync.ts --dry-run      print the plan, write nothing
//   bun run scripts/showcase-sync.ts --bootstrap    first run: create the account, licence and username
//   bun run scripts/showcase-sync.ts                sync again after the source pages change
import { randomBytes, randomUUID } from 'node:crypto';
import { Client } from 'pg';
import config from './showcase-pages.json';
import { createAdminClient } from '../lib/supabase/admin';
import { createDeveloperKey } from '../lib/server/developer-access/key-secret';
import { DEVELOPER_OPERATIONS } from '../lib/developer-api/operations';
import { DEVELOPER_PERMISSIONS } from '../lib/developer-api/permissions';
import { loadProjectEnvFiles } from '../lib/load-project-env';

const API = 'https://app.holofolder.com/app/api/v1';
const KEY_NAME = 'showcase-sync';
const PRESET_NAMES = {
  blank: 'Blank',
  'selected-printings': 'Selected printings',
  'selected-species': 'Selected species',
};
type Preset = keyof typeof PRESET_NAMES;
type Identity = { kind: 'card'; cardId: string; language?: string; finish?: string };
type Target = Identity | { kind: 'pokemon'; pokemonId: number } | null;
type Pocket = { identity: Identity | null; target: Target };
type PageConfig = (typeof config.pages)[number] & { view: { preset: Preset } };
type Slot = {
  id: string;
  version: number;
  target: Target;
  item_id: string | null;
  item_version: number | null;
  placement_version: number | null;
  identity: Identity | null;
};
type Binder = { id: string; name: string; rows: number; cols: number; version: number; layout_revision: number };

const dryRun = process.argv.includes('--dry-run');
const bootstrap = process.argv.includes('--bootstrap');
const say = (line: string) => console.log((dryRun ? '[dry-run] ' : '') + line);
// Key order differs between jsonb and literals, so compare fields, not JSON text.
const same = (a: Target, b: Target) =>
  a === b ||
  (!!a &&
    !!b &&
    a.kind === b.kind &&
    (a.kind === 'pokemon'
      ? a.pokemonId === (b as { pokemonId: number }).pokemonId
      : a.cardId === (b as Identity).cardId &&
        a.language === (b as Identity).language &&
        a.finish === (b as Identity).finish));

async function main() {
  await loadProjectEnvFiles();
  const url = new URL(process.env.POSTGRES_URL_NON_POOLING ?? process.env.DATABASE_URL ?? '');
  url.searchParams.delete('sslmode');
  const db = new Client({ connectionString: url.toString(), ssl: { rejectUnauthorized: false } });
  await db.connect();
  // Every read runs in a read-only transaction with its own timeout, so the source can never be written.
  const read = async <T>(sql: string, params: unknown[] = []): Promise<T[]> => {
    await db.query("BEGIN READ ONLY; SET LOCAL statement_timeout = '15s'");
    try {
      return (await db.query(sql, params)).rows as T[];
    } finally {
      await db.query('ROLLBACK');
    }
  };
  let key: { id: string; key: string } | null = null;
  try {
    const pages = config.pages as PageConfig[];
    const sourcePages = await readSource(read);
    const desired = new Map<number, Pocket[]>();
    for (const page of pages) {
      const pockets = sourcePages.get(page.page);
      if (!pockets) {
        say(`page ${page.page} (${page.slug}) is empty in the source, skipped`);
        continue;
      }
      desired.set(page.page, await withTargets(read, pockets, page.view.preset, page.slug));
    }
    for (const index of sourcePages.keys())
      if (!pages.some((p) => p.page === index))
        say(`page ${index} has cards but no entry in showcase-pages.json, skipped`);

    let ownerId: string | undefined = (
      await read<{ id: string }>('SELECT id FROM auth.users WHERE email = $1', [config.showcase.email])
    )[0]?.id;
    if (!ownerId && !bootstrap) throw new Error('No showcase account yet. Run with --bootstrap first.');
    if (bootstrap) ownerId = await bootstrapAccount(db, read, ownerId);
    if (!ownerId) {
      for (const page of pages) if (desired.has(page.page)) say(`create ${page.slug}: ${describe(page)}`);
      return;
    }
    if (!dryRun) key = await createKey(db, ownerId);
    const api = apiClient(key);
    if (bootstrap) {
      const [identity] = await read<{ username: string | null }>(
        'SELECT username FROM account_identities WHERE user_id = $1',
        [ownerId],
      );
      if (identity?.username !== config.showcase.username) {
        say(`set username @${config.showcase.username}`);
        if (!dryRun)
          await api('update_identity', {
            username: config.showcase.username,
            displayName: config.showcase.displayName,
          });
      }
    }
    for (const page of pages) {
      const pockets = desired.get(page.page);
      if (pockets) await syncPage(read, api, ownerId, page, pockets);
    }
  } finally {
    if (key) await db.query('UPDATE developer_api_keys SET revoked_at = now() WHERE id = $1', [key.id]);
    await db.end();
  }
}

type Read = <T>(sql: string, params?: unknown[]) => Promise<T[]>;

/** Pages of the source binder that hold at least one card, each as its full list of pockets. */
async function readSource(read: Read) {
  const [binder] = await read<{ rows: number; cols: number }>(
    `SELECT b.binder_rows AS rows, b.binder_cols AS cols FROM binders b
     JOIN account_identities a ON a.user_id = b.owner_user_id
     WHERE b.id = $1 AND a.username = $2`,
    [config.source.binderId, config.source.username],
  );
  if (!binder?.rows || !binder.cols) throw new Error('Source binder not found or has no grid');
  const rows = await read<{ position: string; identity: Identity | null; grading: unknown }>(
    `SELECT s.position, i.identity, i.grading FROM binder_slots s
     LEFT JOIN inventory_placements p ON p.slot_id = s.id
     LEFT JOIN inventory_items i ON i.id = p.inventory_item_id
     WHERE s.collection_id = $1 ORDER BY s.position`,
    [config.source.binderId],
  );
  const size = binder.rows * binder.cols;
  const pages = new Map<number, (Identity | null)[]>();
  rows.forEach((row, index) => {
    // ponytail: graded copies would need insertAssign with grading; none exist in the source today.
    if (row.grading) throw new Error(`Source pocket ${row.position} holds a graded copy, which this script can't copy`);
    const page = Math.floor(index / size);
    if (!pages.has(page)) pages.set(page, Array(size).fill(null));
    pages.get(page)![index % size] = row.identity;
  });
  for (const [page, pockets] of pages) if (pockets.every((p) => !p)) pages.delete(page);
  return pages;
}

/** Pocket goals for the chosen preset, using the same target shapes as the binder creation wizard. */
async function withTargets(read: Read, cards: (Identity | null)[], preset: Preset, slug: string): Promise<Pocket[]> {
  if (!(preset in PRESET_NAMES)) throw new Error(`${slug}: unknown preset ${preset}`);
  if (preset === 'selected-species') {
    const ids = cards.filter(Boolean).map((c) => c!.cardId);
    const dex = await read<{ card_id: string; ids: number[] }>(
      'SELECT card_id, array_agg(DISTINCT dex_id) AS ids FROM tcg_card_dex_ids WHERE card_id = ANY($1) GROUP BY card_id',
      [ids],
    );
    const species = new Map(dex.map((d) => [d.card_id, d.ids]));
    const pockets = cards.map((identity) => {
      if (!identity) return { identity, target: null };
      const ids = species.get(identity.cardId);
      if (ids?.length !== 1) throw new Error(`${slug}: ${identity.cardId} isn't exactly one species`);
      return { identity, target: { kind: 'pokemon' as const, pokemonId: Number(ids[0]) } };
    });
    const picked = pockets.flatMap((p) => (p.target ? [JSON.stringify(p.target)] : []));
    if (new Set(picked).size !== picked.length) throw new Error(`${slug}: selected-species needs each species once`);
    return pockets;
  }
  // Like the wizard's printingTarget: card and language only, so any finish of that printing fills it.
  return cards.map((identity) => ({
    identity,
    target:
      preset === 'selected-printings' && identity
        ? { kind: 'card' as const, cardId: identity.cardId, language: identity.language }
        : null,
  }));
}

function describe(page: PageConfig) {
  const v = page.view;
  return `"${page.name}", ${v.rows}x${v.cols}, ${v.preset}, prices ${v.showPrices ? 'on' : 'off'}`;
}

async function bootstrapAccount(db: Client, read: Read, existing: string | undefined) {
  let ownerId = existing;
  if (!ownerId) {
    say(`create account ${config.showcase.email}`);
    if (dryRun) return undefined;
    const { data, error } = await createAdminClient().auth.admin.createUser({
      email: config.showcase.email,
      // Nobody signs in with it; the account is only written through this script's short-lived key.
      password: randomBytes(32).toString('base64url'),
      email_confirm: true,
      user_metadata: { display_name: config.showcase.displayName },
    });
    if (error || !data.user) throw new Error('Could not create the showcase account: ' + error?.message);
    ownerId = data.user.id;
  }
  const licence = await read('SELECT 1 FROM perpetual_licences WHERE owner_user_id = $1', [ownerId]);
  if (!licence.length) {
    // 'manual' is the comped-licence source the billing check allows ('grandfathered' or 'manual').
    say('grant a comped lifetime licence');
    if (!dryRun)
      await db.query(
        "INSERT INTO perpetual_licences(owner_user_id, source) VALUES ($1, 'manual') ON CONFLICT DO NOTHING",
        [ownerId],
      );
  }
  return ownerId;
}

async function createKey(db: Client, ownerId: string) {
  // A key left over from a run that was killed still expires, but revoke it now anyway.
  await db.query(
    'UPDATE developer_api_keys SET revoked_at = now() WHERE actor_id = $1 AND name = $2 AND revoked_at IS NULL',
    [ownerId, KEY_NAME],
  );
  const key = createDeveloperKey();
  await db.query('SELECT create_developer_api_key($1, $2, $3, $4, $5, $6)', [
    key.id,
    ownerId,
    KEY_NAME,
    key.digest,
    [...DEVELOPER_PERMISSIONS],
    30,
  ]);
  return key;
}

type Api = (name: string, input: Record<string, unknown>) => Promise<Record<string, unknown>>;
function apiClient(key: { key: string } | null): Api {
  let minute = 0,
    writes = 0;
  return async (name, input) => {
    if (!key) throw new Error('No API key in dry-run');
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
    if (++writes > 18) {
      await new Promise((resolve) => setTimeout(resolve, 60500 - (Date.now() % 60000)));
      [minute, writes] = [Math.floor(Date.now() / 60000), 1];
    }
    const response = await fetch(API + path, {
      method: operation.method,
      headers: { Authorization: `Bearer ${key.key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60000),
    });
    const result = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (!response.ok) throw new Error(`${name} failed (${response.status}): ${JSON.stringify(result)}`);
    return result;
  };
}

async function syncPage(read: Read, api: Api, ownerId: string, page: PageConfig, pockets: Pocket[]) {
  const { rows, cols, preset, showPrices } = page.view;
  const findBinder = async () =>
    // Matched by slug; by name too, so a run that died before setting the slug is adopted, not duplicated.
    (
      await read<Binder>(
        `SELECT b.id, b.name, b.binder_rows AS rows, b.binder_cols AS cols, s.version::int, s.layout_revision::int
         FROM binders b JOIN storage_collection_state s ON s.collection_id = b.id
         LEFT JOIN binder_public_slugs p ON p.binder_id = b.id AND p.is_active
         WHERE b.owner_user_id = $1 AND (p.slug = $2 OR b.name = $3)
         ORDER BY (p.slug = $2) DESC NULLS LAST LIMIT 1`,
        [ownerId, page.slug, page.name],
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
    say(`create ${page.slug}: ${describe(page)}`);
    if (dryRun) {
      say(`  fill ${pockets.filter((p) => p.identity).length} cards, enable share`);
      return;
    }
    const collectionId = randomUUID();
    await api('create_storage_collection', {
      version: 1,
      operationId: `showcase-create-${collectionId}`,
      inventoryRevision: await revision(),
      collectionId,
      name: page.name,
      kind: 'binder',
      defaultPresentation: 'binder',
      location: null,
      grid: { rows, cols },
      manifest: {
        source: { id: preset, version: '1' },
        name: PRESET_NAMES[preset],
        entries: pockets.map((p, i) => ({ id: `pocket-${i + 1}`, target: p.target })),
      },
      slotIds: pockets.map(() => randomUUID()),
    });
    binder = (await findBinder())!;
  }
  const id = binder.id;
  if (binder.name !== page.name) {
    say(`${page.slug}: rename "${binder.name}" to "${page.name}"`);
    if (!dryRun) await api('update_binder', { id, name: page.name });
  }
  if (binder.rows !== rows || binder.cols !== cols) {
    say(`${page.slug}: grid ${binder.rows}x${binder.cols} to ${rows}x${cols}`);
    if (!dryRun) {
      const review = await api('set_binder_layout', { id, rows, cols, dryRun: true });
      await api('set_binder_layout', {
        id,
        rows,
        cols,
        operationId: `showcase-layout-${randomUUID()}`,
        ...(review.preconditions as Record<string, unknown>),
      });
    }
  }

  const slots = () =>
    read<Slot>(
      `SELECT s.id, s.version::int, s.target, p.inventory_item_id AS item_id, i.version::int AS item_version,
              p.version::int AS placement_version, i.identity
       FROM binder_slots s LEFT JOIN inventory_placements p ON p.slot_id = s.id
       LEFT JOIN inventory_items i ON i.id = p.inventory_item_id
       WHERE s.collection_id = $1 ORDER BY s.position`,
      [id],
    );
  const pre = (s: Slot) => ({
    id: s.id,
    version: s.version,
    inventoryItemId: s.item_id,
    itemVersion: s.item_version,
    placementVersion: s.placement_version,
  });
  const inventory = async (commands: unknown[]) => {
    const b = (await findBinder())!;
    return api('execute_inventory_commands', {
      operationId: `showcase-inv-${randomUUID()}`,
      inventoryRevision: await revision(),
      collections: [{ collectionId: id, version: b.version, layoutRevision: b.layout_revision }],
      commands,
    });
  };

  // 1. Remove copies that no longer match their pocket, and pockets past the end of the page.
  let current = await slots();
  const stale = current.filter((s, i) => s.item_id && (i >= pockets.length || !same(s.identity, pockets[i].identity)));
  const extra = current.slice(pockets.length);
  if (stale.length || extra.length) {
    say(`${page.slug}: remove ${stale.length} changed cards, ${extra.length} extra pockets`);
    if (!dryRun) {
      if (stale.length)
        await inventory(
          stale.map((s) => ({
            kind: 'removeOwned',
            item: { itemId: s.item_id, itemVersion: s.item_version, placement: { collectionId: id, slot: pre(s) } },
          })),
        );
      current = await slots();
      if (extra.length)
        await inventory([
          {
            kind: 'removeSlots',
            slots: current.slice(pockets.length).map((s) => ({ collectionId: id, slot: pre(s) })),
          },
        ]);
    }
  }
  // 2. Add missing pockets and set each pocket's goal for the preset.
  if (!dryRun) current = await slots();
  const missing = Math.max(0, pockets.length - current.length);
  const retarget = current.slice(0, pockets.length).filter((s, i) => !same(s.target, pockets[i].target));
  if (missing || retarget.length) {
    say(`${page.slug}: add ${missing} pockets, change ${retarget.length} pocket goals`);
    if (!dryRun) {
      if (missing)
        await slotsCommand(api, id, await revision(), (await findBinder())!, [
          { kind: 'create', ids: Array.from({ length: missing }, () => randomUUID()), beforeSlotId: null },
        ]);
      current = await slots();
      const updates = current
        .slice(0, pockets.length)
        .flatMap((s, i) =>
          same(s.target, pockets[i].target) ? [] : [{ kind: 'update', slot: pre(s), target: pockets[i].target }],
        );
      if (updates.length) await slotsCommand(api, id, await revision(), (await findBinder())!, updates);
    }
  }
  // 3. Put each card in its pocket as a new copy (finish and language from the source copy).
  if (!dryRun) current = await slots();
  const fills = pockets.flatMap((p, i) => {
    const s = current[i];
    return p.identity && !(s && s.item_id && same(s.identity, p.identity)) ? [{ p, s }] : [];
  });
  if (fills.length) {
    say(`${page.slug}: add ${fills.length} cards`);
    if (!dryRun)
      await inventory(
        fills.map(({ p, s }) => ({
          kind: 'assign',
          selection: { kind: 'catalog', identity: p.identity, newItemId: randomUUID() },
          destination: { collectionId: id, slot: pre(s) },
          occupied: 'cancel',
          fulfillWant: null,
        })),
      );
  }
  // 4. Public slug and read-only share.
  const [share] = await read<{ slug: string | null; enabled: boolean | null; prices: boolean | null }>(
    `SELECT p.slug, s.is_enabled AS enabled, s.show_prices AS prices FROM binders b
     LEFT JOIN binder_public_slugs p ON p.binder_id = b.id AND p.is_active
     LEFT JOIN binder_shares s ON s.binder_id = b.id WHERE b.id = $1`,
    [id],
  );
  if (share?.slug !== page.slug) {
    say(`${page.slug}: set public slug`);
    if (!dryRun) await api('update_binder_identity', { binderId: id, slug: page.slug });
  }
  if (!share?.enabled || share.prices !== showPrices) {
    say(`${page.slug}: share on, prices ${showPrices ? 'on' : 'off'}`);
    if (!dryRun) await api('update_sharing', { binderId: id, enabled: true, showPrices });
  }
  say(`${page.slug}: in sync, https://holofolder.com/@${config.showcase.username}/${page.slug}`);
}

function slotsCommand(api: Api, collectionId: string, inventoryRevision: number, b: Binder, commands: unknown[]) {
  return api('execute_slot_commands', {
    collectionId,
    operationId: `showcase-slots-${randomUUID()}`,
    inventoryRevision,
    collectionVersion: b.version,
    layoutRevision: b.layout_revision,
    commands,
  });
}

if (import.meta.main)
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
