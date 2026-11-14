import type { SupabaseClient } from '@supabase/supabase-js';
import { cacheLife, cacheTag } from 'next/cache';
import type { BinderShareRecord } from '@/lib/binder-share';
import type { PublicBinder, PublicDisplaySlot, PublicShareIdentity } from '@/lib/public-binder';
import { normalizeUsername, normalizeBinderSlug, isMissingIdentitySchema } from '@/lib/public-binder-identity';
import { isSlotRevision, normalizeSlotTarget } from '@/lib/domain/binder-slots';
import { normalizeInventoryIdentity, type InventoryIdentity } from '@/lib/domain/inventory';
import { DEFAULT_BINDER_COLOR_ID, normalizeBinderColor, type BinderColor } from '@/lib/binder-colors';
import { isBinderGridSize } from '@/lib/binder-layout';
import { normalizeBinderName } from '@/lib/binders/model';
import { getPokemonSummary } from '@/lib/pokemon-catalog';
import { mapWithConcurrency } from '@/lib/card-db-sync-concurrency';
import { buildTcgdexAssetImageUrl, pickImageLanguage } from '@/lib/tcgdex-shared';
import { isCardImageSourceUrl, pickCardImageUrl } from '@/lib/card-image-sources';
import { isCardLanguage, type CardLanguage } from '@/lib/domain/cards';
import { MISSING_PUBLIC_BINDER_TAG, publicBinderTag } from '@/lib/server/public-binder-cache';

const KNOWN_GRADERS = new Set(['psa', 'ace', 'cgc', 'beckett']);

type Row = Record<string, unknown>;
const PAGE = 500;
// Batched reads run in one wave for typical binders instead of queueing behind 4 at a time.
const PARALLEL = 16;
const SHARE = 'owner_user_id,binder_id,token,is_enabled,show_prices';
const BINDER = 'id,owner_user_id,name,binder_rows,binder_cols,updated_at';
const ITEM =
  'id,owner_user_id,identity,public_grade:grading->grade,public_provider:grading->provider,private_certificate:grading->certificate,version';
const STATE = 'collection_id,owner_user_id,version,layout_revision';
const SLOTS = 'id,owner_user_id,collection_id,position,target,status,wanted_cards,version';
type PublicWant = NonNullable<PublicDisplaySlot['wantedCards']>[number];
const label = (v: unknown) =>
  typeof v === 'string' && v.trim() && v.length <= 200 && !/https?:|www\.|[<>]/i.test(v) ? v.trim() : undefined;
/** A recorded image survives only when it is an https card-image source the app already proxies. */
function wantImage(v: unknown) {
  try {
    const url = new URL(String(v));
    return url.protocol === 'https:' && (url.hostname === 'assets.tcgdex.net' || isCardImageSourceUrl(url))
      ? url.toString()
      : undefined;
  } catch {
    return undefined;
  }
}
export class PublicBinderUnavailable extends Error {
  constructor() {
    super('Public binder unavailable');
  }
}
/** No enabled share answers to this address: safe to cache as a 404, unlike a failed read. */
class PublicBinderMissing extends PublicBinderUnavailable {}
const fail = (): never => {
  throw new PublicBinderUnavailable();
};
const missing = (): never => {
  throw new PublicBinderMissing();
};
const object = (v: unknown): Row => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Row) : fail());
const rows = (v: unknown): Row[] => (Array.isArray(v) ? v.map(object) : fail());
const id = (v: unknown): string => (typeof v === 'string' && v.length > 0 && v.length <= 200 ? v : fail());
const same = (a: unknown, b: unknown) => {
  if (JSON.stringify(a) !== JSON.stringify(b)) fail();
};
const chunks = <T>(values: T[], size: number) =>
  Array.from({ length: Math.ceil(values.length / size) }, (_, i) => values.slice(i * size, i * size + size));
const color = (v: unknown): BinderColor => normalizeBinderColor(v) ?? DEFAULT_BINDER_COLOR_ID;

/** The only production entry accepts a public identity, never a caller's owner or collection scope.
 * Injected client is a trusted server/test dependency and is never cached. Otherwise a cheap uncached read of
 * the share, binder, revisions, settings and username (the stamp) runs first, so a disabled share or any edit
 * takes effect at once, and the full payload is cached under that stamp. No hosted mutation. */
export async function loadPublicBinder(identity: PublicShareIdentity, client?: SupabaseClient): Promise<PublicBinder> {
  if (client) return (await readPublicBinder(identity, client)).binder!;
  const db = (await import('@/lib/supabase/admin')).createAdminClient();
  const { stamp } = await readPublicBinder(identity, db, true);
  try {
    return await cachedPublicBinder(identity, stamp);
  } catch {
    // A write landed between the stamp and the cached read: read it fresh, uncached.
    return (await readPublicBinder(identity, db)).binder!;
  }
}

type NamedShareRows = {
  identities: { user_id: unknown; username: unknown }[];
  slugs: { owner_user_id: unknown; binder_id: unknown; slug: unknown; is_active: unknown }[];
  shares: { owner_user_id: unknown; binder_id: unknown; is_enabled: unknown }[];
};

/** The (username, slug) of every enabled named share: the same join as resolve_named_binder_share, done in memory. */
export function namedPublicBinderParams({ identities, slugs, shares }: NamedShareRows) {
  const usernames = new Map(identities.map((i) => [i.user_id, i.username]));
  const enabled = new Set(shares.filter((s) => s.is_enabled === true).map((s) => `${s.owner_user_id}:${s.binder_id}`));
  const params = new Map<string, { username: string; binderSlug: string }>();
  for (const slug of slugs) {
    const username = usernames.get(slug.owner_user_id);
    if (
      slug.is_active !== true ||
      typeof username !== 'string' ||
      typeof slug.slug !== 'string' ||
      normalizeUsername(username) !== username ||
      normalizeBinderSlug(slug.slug) !== slug.slug ||
      !enabled.has(`${slug.owner_user_id}:${slug.binder_id}`)
    )
      continue;
    params.set(`${username}/${slug.slug}`, { username, binderSlug: slug.slug });
  }
  return [...params.values()];
}

/** Build-time list of named shares to prerender. Never fails the build: no credentials, e2e builds or a read error
 * return none, and those shares render on their first visit instead. */
export async function listNamedPublicBinderParams() {
  if (
    process.env.HOLOFOLDER_E2E === '1' ||
    !process.env.NEXT_PUBLIC_SUPABASE_URL ||
    !process.env.SUPABASE_SERVICE_ROLE_KEY
  )
    return [];
  try {
    const db = (await import('@/lib/supabase/admin')).createAdminClient();
    const [identities, slugs, shares] = await Promise.all([
      db.from('account_identities').select('user_id,username').not('username', 'is', null).limit(1000),
      db.from('binder_public_slugs').select('owner_user_id,binder_id,slug,is_active').eq('is_active', true).limit(1000),
      db.from('binder_shares').select('owner_user_id,binder_id,is_enabled').eq('is_enabled', true).limit(1000),
    ]);
    if (identities.error || slugs.error || shares.error) return [];
    return namedPublicBinderParams({ identities: identities.data, slugs: slugs.data, shares: shares.data });
  } catch {
    return [];
  }
}

/** Named shares (`/@username/slug`) skip the stamp: the payload is cached until the owner's next write expires
 * `publicBinderTag` (lib/server/public-binder-cache.ts), so the page itself can be served from cache. */
export async function loadNamedPublicBinder(username: string, binderSlug: string): Promise<PublicBinder | null> {
  'use cache: remote';
  // Card names and images come from the mirror, which a card sync revalidates.
  cacheTag('tcg-mirror');
  try {
    if (normalizeUsername(username) !== username || normalizeBinderSlug(binderSlug) !== binderSlug) missing();
    const db = (await import('@/lib/supabase/admin')).createAdminClient();
    const read = await readPublicBinder({ username, binderSlug }, db);
    cacheLife('days');
    cacheTag(publicBinderTag(read.owner!));
    return read.binder!;
  } catch (error) {
    // Failed reads throw and are never cached. A missing share is cached briefly, until a share or name changes.
    if (!(error instanceof PublicBinderMissing)) throw error;
    cacheLife('minutes');
    cacheTag(MISSING_PUBLIC_BINDER_TAG);
    return null;
  }
}

async function cachedPublicBinder(identity: PublicShareIdentity, stamp: string): Promise<PublicBinder> {
  'use cache: remote';
  cacheLife('days');
  // Card names and images come from the mirror, which a card sync revalidates.
  cacheTag('tcg-mirror');
  const db = (await import('@/lib/supabase/admin')).createAdminClient();
  const read = await readPublicBinder(identity, db);
  // Only ever store a payload under the stamp it was read at; throwing keeps it out of the cache.
  if (read.stamp !== stamp) throw new PublicBinderUnavailable();
  return read.binder!;
}

/** Every write command bumps the collection's version and the owner's inventory revision in the same
 * transaction, so the stamp changes whenever anything the payload shows changes. */
async function readPublicBinder(
  identity: PublicShareIdentity,
  db: SupabaseClient,
  stampOnly = false,
): Promise<{ stamp: string; owner?: string; binder?: PublicBinder }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  let requests = 0;
  async function execute<T extends { error: unknown }>(query: PromiseLike<T>): Promise<T> {
    if (++requests > 4096 || controller.signal.aborted) return fail();
    const result = await query;
    if (controller.signal.aborted) return fail();
    return result;
  }
  async function run<T extends { error: unknown }>(query: PromiseLike<T>): Promise<T> {
    const result = await execute(query);
    if (result.error) return fail();
    return result;
  }
  async function permission(): Promise<BinderShareRecord> {
    if ('token' in identity) {
      if (!/^[a-zA-Z0-9_-]{1,200}$/.test(identity.token)) return fail();
      const result = await run(
        db
          .from('binder_shares')
          .select(SHARE)
          .eq('token', identity.token)
          .eq('is_enabled', true)
          .abortSignal(controller.signal)
          .maybeSingle(),
      );
      const share = result.data as BinderShareRecord | null;
      if (!share?.is_enabled || share.token !== identity.token || !share.owner_user_id) return missing();
      return share;
    }
    if (
      normalizeUsername(identity.username) !== identity.username ||
      normalizeBinderSlug(identity.binderSlug) !== identity.binderSlug
    )
      return missing();
    const result = await run(
      db
        .rpc('resolve_named_binder_share', {
          requested_username: identity.username,
          requested_slug: identity.binderSlug,
        })
        .abortSignal(controller.signal)
        .maybeSingle(),
    );
    const share = result.data as BinderShareRecord | null;
    if (!share?.is_enabled || !share.binder_id || !share.owner_user_id || !share.token) return missing();
    // RPC can grow independently. Retain only the permission fields in the server fence.
    return {
      owner_user_id: share.owner_user_id,
      binder_id: share.binder_id,
      token: share.token,
      is_enabled: share.is_enabled,
      show_prices: share.show_prices,
    };
  }
  try {
    const share = await permission(),
      owner = id(share.owner_user_id);
    // Historical binderless tokens resolve only the current default, never list other binders.
    async function binder() {
      let query = db.from('binders').select(BINDER).eq('owner_user_id', owner);
      query = share.binder_id ? query.eq('id', share.binder_id) : query.eq('is_default', true);
      const result = await run(query.abortSignal(controller.signal).maybeSingle());
      const value = object(result.data ?? missing());
      if (value.owner_user_id !== owner || (share.binder_id && value.id !== share.binder_id)) return missing();
      return value;
    }
    const initialBinder = await binder(),
      collection = id(initialBinder.id);
    const scoped = (table: string, projection: string) =>
      db
        .from(table)
        .select(projection)
        .eq('owner_user_id', owner)
        .eq('collection_id', collection)
        .abortSignal(controller.signal);
    async function state() {
      // Every binder is native slot storage; anything else fails closed.
      const row = object((await run(scoped('storage_collection_state', STATE).maybeSingle())).data);
      if (
        row.owner_user_id !== owner ||
        row.collection_id !== collection ||
        !isSlotRevision(row.version) ||
        !isSlotRevision(row.layout_revision)
      )
        return fail();
      return row;
    }
    async function revision() {
      const result = await run(
        db
          .from('inventory_owner_state')
          .select('inventory_revision')
          .eq('owner_user_id', owner)
          .abortSignal(controller.signal)
          .maybeSingle(),
      );
      if (!isSlotRevision(result.data?.inventory_revision)) return fail();
      return result.data.inventory_revision as number;
    }
    async function paged(table: string, projection: string, key: string) {
      const result: Row[] = [];
      for (let offset = 0; ; offset += PAGE) {
        const page = rows(
          (
            await run(
              scoped(table, projection)
                .order(key, { ascending: true })
                .range(offset, offset + PAGE - 1),
            )
          ).data,
        );
        if (page.length > PAGE) return fail();
        result.push(...page);
        if (page.length < PAGE) return result;
      }
    }
    async function username() {
      const result = await execute(
        db
          .from('account_identities')
          .select('username')
          .eq('user_id', owner)
          .abortSignal(controller.signal)
          .maybeSingle(),
      );
      if (result.error && !isMissingIdentitySchema(result.error)) return fail();
      return normalizeUsername(result.data?.username);
    }
    // Independent first reads; the final fence re-reads every one of them.
    const [initialState, settings, publicUsername, rev] = await Promise.all([
      state(),
      run(
        db
          .from('user_settings')
          .select('binder_rows,binder_cols,binder_color_id,binder_page_colors,binder_slot_glare_enabled,dark_mode')
          .eq('user_id', owner)
          .abortSignal(controller.signal)
          .maybeSingle(),
      ),
      username(),
      revision(),
    ]);
    const stamp = JSON.stringify([share, initialBinder, initialState, settings.data ?? null, publicUsername, rev]);
    if (stampOnly) return { stamp };
    const appearanceRow: Row = settings.data ? object(settings.data) : {};
    const pageColors: Record<string, BinderColor> = {};
    if (appearanceRow.binder_page_colors && typeof appearanceRow.binder_page_colors === 'object') {
      for (const [page, value] of Object.entries(appearanceRow.binder_page_colors))
        if (/^[1-9]\d{0,6}$/.test(page)) pageColors[page] = color(value);
    }
    // NULL binder geometry inherits the owner's settings (039), never an invented default.
    const grid = (value: unknown, fallback: unknown) =>
      isBinderGridSize(value) ? value : isBinderGridSize(fallback) ? fallback : fail();
    const base = {
      ...(publicUsername ? { username: publicUsername } : {}),
      name: normalizeBinderName(initialBinder.name) ?? 'Pokémon binder',
      rows: grid(initialBinder.binder_rows, appearanceRow.binder_rows),
      cols: grid(initialBinder.binder_cols, appearanceRow.binder_cols),
      appearance: {
        dark: appearanceRow.dark_mode !== false,
        color: color(appearanceRow.binder_color_id),
        pageColors,
        glare: appearanceRow.binder_slot_glare_enabled !== false,
      },
    };
    const grades = new Map<string, string>();
    const providers = new Map<string, string>();
    const catalogRows = new Map<string, Row>();
    const catalogLinks = new Map<string, number[]>();
    const catalog = new Map<
      string,
      { name: string; image?: string; ref: { id: string; language?: CardLanguage; pokemonIds?: number[] } }
    >();
    async function preloadCatalog(ids: string[]) {
      const unique = [...new Set(ids)];
      const projection = 'id,name_en,series_id,set_id,local_id,image_languages_json,external_ids_json';
      await mapWithConcurrency(chunks(unique, 100), PARALLEL, async (batch) => {
        const direct = rows(
          (await run(db.from('tcg_cards').select(projection).in('id', batch).abortSignal(controller.signal))).data,
        );
        const requested = new Set(batch);
        for (const row of direct) {
          const key = id(row.id);
          if (!requested.has(key) || catalogRows.has(key)) return fail();
          catalogRows.set(key, row);
        }
      });
      // Missing IDs may be recorded catalog aliases. Bound their concurrency and never fuzzy-match.
      await mapWithConcurrency(
        unique.filter((key) => !catalogRows.has(key)),
        12,
        async (key) => {
          const result = await run(
            db
              .from('tcg_cards')
              .select(projection)
              .contains('external_ids_json->catalog->aliasIds', JSON.stringify([key]))
              .abortSignal(controller.signal)
              .maybeSingle(),
          );
          if (result.data) catalogRows.set(key, object(result.data));
        },
      );
      const canonical = [...new Set([...catalogRows.values()].map((row) => id(row.id)))];
      await mapWithConcurrency(chunks(canonical, 100), PARALLEL, async (batch) => {
        const requested = new Set(batch);
        for (let start = 0; ; start += PAGE) {
          const page = rows(
            (
              await run(
                db
                  .from('tcg_card_dex_ids')
                  .select('card_id,dex_id')
                  .in('card_id', batch)
                  .order('card_id')
                  .order('dex_id')
                  .range(start, start + PAGE - 1)
                  .abortSignal(controller.signal),
              )
            ).data,
          );
          for (const link of page) {
            const key = id(link.card_id);
            if (
              !requested.has(key) ||
              typeof link.dex_id !== 'number' ||
              !Number.isSafeInteger(link.dex_id) ||
              link.dex_id <= 0
            )
              return fail();
            const links = catalogLinks.get(key) ?? [];
            if (links.includes(link.dex_id)) return fail();
            links.push(link.dex_id);
            catalogLinks.set(key, links);
          }
          if (page.length < PAGE) break;
        }
      });
    }
    function card(cardId: string, language: string = 'en') {
      const cacheKey = JSON.stringify([cardId, language]);
      if (catalog.has(cacheKey)) return catalog.get(cacheKey)!;
      const row = catalogRows.get(cardId);
      if (!row) return undefined;
      const canonical = id(row.id);
      const pokemonIds = catalogLinks.get(canonical) ?? [];
      const validLanguage = /^[a-z]{2}(?:-[a-z]{2})?$/.test(language);
      const imageLanguage = validLanguage ? pickImageLanguage(row.image_languages_json, language) : null;
      const segment = (v: unknown): v is string =>
        typeof v === 'string' && /^[a-zA-Z0-9._-]{1,64}$/.test(v) && !v.includes('..');
      const tcgdex =
        imageLanguage && segment(row.series_id) && segment(row.set_id) && segment(row.local_id)
          ? buildTcgdexAssetImageUrl(imageLanguage, row.series_id, row.set_id, row.local_id, 'high', 'webp')
          : null;
      // The same picker as every other surface (ledger, catalog, pokemon.com, other-language TCGdex, fallback sources).
      const image = validLanguage
        ? wantImage(pickCardImageUrl(row.external_ids_json, tcgdex ? imageLanguage : null, tcgdex, language))
        : undefined;
      const value = {
        name: typeof row.name_en === 'string' && row.name_en.trim() ? row.name_en : 'Unknown card',
        ...(image ? { image } : {}),
        // Public catalog reference: the canonical printing and the requested language, never the stored alias.
        ref: {
          id: canonical,
          ...(isCardLanguage(language) ? { language } : {}),
          ...(pokemonIds.length ? { pokemonIds: [...pokemonIds] } : {}),
        },
      };
      catalog.set(cacheKey, value);
      return value;
    }
    const wantIds = (raw: unknown) =>
      Array.isArray(raw)
        ? raw.flatMap((w) =>
            w && typeof w === 'object' && typeof (w as Row).card_id === 'string' ? [String((w as Row).card_id)] : [],
          )
        : [];
    /** Name and artwork only, in stored order. Never wanted_by, dates, notes, costs or provenance. */
    function wants(raw: unknown): PublicWant[] {
      if (!Array.isArray(raw)) return [];
      return raw.flatMap((entry) => {
        if (!entry || typeof entry !== 'object') return [];
        const want = entry as Row;
        if (typeof want.card_id !== 'string' || !want.card_id) return [];
        const found = card(want.card_id, typeof want.card_language === 'string' ? want.card_language : 'en');
        const name = found?.name ?? label(want.card_name);
        if (!name) return [];
        const image = found?.image ?? wantImage(want.card_image);
        return [
          {
            card_name: name,
            ...(image ? { card_image: image } : {}),
            ...(found
              ? {
                  card_id: found.ref.id,
                  ...(found.ref.language ? { card_language: found.ref.language } : {}),
                  ...(found.ref.pokemonIds ? { pokemonIds: found.ref.pokemonIds } : {}),
                }
              : {}),
          },
        ];
      });
    }
    const withWants = (list: PublicWant[]) => (list.length ? { wantedCards: list } : {});
    const slots: PublicDisplaySlot[] = [];
    const [stored, placements] = await Promise.all([
      paged('binder_slots', SLOTS, 'position'),
      paged('inventory_placements', 'inventory_item_id,owner_user_id,collection_id,slot_id,version', 'slot_id'),
    ]);
    if (
      new Set(stored.map((s) => s.id)).size !== stored.length ||
      new Set(placements.map((p) => p.slot_id)).size !== placements.length ||
      new Set(placements.map((p) => p.inventory_item_id)).size !== placements.length
    )
      return fail();
    if (
      stored.some(
        (s, i) =>
          s.owner_user_id !== owner ||
          s.collection_id !== collection ||
          !isSlotRevision(s.position) ||
          !isSlotRevision(s.version) ||
          (i > 0 && Number(s.position) <= Number(stored[i - 1].position)),
      )
    )
      return fail();
    if (
      placements.some(
        (p) =>
          p.owner_user_id !== owner ||
          p.collection_id !== collection ||
          !isSlotRevision(p.version) ||
          !stored.some((s) => s.id === p.slot_id),
      )
    )
      return fail();
    const items = new Map<string, InventoryIdentity>();
    const itemPages: Row[][] = [];
    await mapWithConcurrency(
      chunks(
        placements.map((p) => id(p.inventory_item_id)),
        100,
      ),
      PARALLEL,
      async (ids) => {
        const result = rows(
          (
            await run(
              db
                .from('inventory_items')
                .select(ITEM)
                .eq('owner_user_id', owner)
                .in('id', ids)
                .abortSignal(controller.signal),
            )
          ).data,
        );
        itemPages.push(result);
        if (result.length !== ids.length) return fail();
        const requested = new Set(ids);
        for (const row of result) {
          const identity = normalizeInventoryIdentity(row.identity);
          if (
            !identity ||
            row.owner_user_id !== owner ||
            !requested.has(id(row.id)) ||
            items.has(String(row.id)) ||
            !isSlotRevision(row.version)
          )
            return fail();
          // Internal matching needs only identity, never legacy/source JSON or acquisition fields.
          items.set(String(row.id), identity);
        }
        // Grade projection never retains certificates, label/slab images, links or asset IDs.
        for (const row of result) {
          const grade = row.public_grade;
          const certificate = typeof row.private_certificate === 'string' ? row.private_certificate : null;
          const provider =
            row.public_provider && typeof row.public_provider === 'object' ? (row.public_provider as Row) : null;
          const providerName =
            provider?.kind === 'known' && KNOWN_GRADERS.has(String(provider.id))
              ? String(provider.id).toUpperCase()
              : provider?.kind === 'custom'
                ? provider.name
                : null;
          if (
            typeof providerName === 'string' &&
            providerName.length <= 500 &&
            !/https?:|www\.|[<>]/i.test(providerName) &&
            (!certificate || !providerName.includes(certificate))
          )
            providers.set(String(row.id), providerName);
          if (
            typeof grade === 'string' &&
            grade.length <= 500 &&
            !/https?:|www\.|[<>]/i.test(grade) &&
            (!certificate || !grade.includes(certificate))
          )
            grades.set(String(row.id), grade);
        }
      },
    );
    await preloadCatalog(
      [...items.values()]
        .flatMap((identity) => (identity.kind === 'card' ? [identity.cardId] : []))
        .concat(
          stored.flatMap((s) => {
            const target = normalizeSlotTarget(s.target);
            return [...(target?.kind === 'card' ? [target.cardId] : []), ...wantIds(s.wanted_cards)];
          }),
        ),
    );
    // Slot ids are unique across placements (checked above).
    const placementsBySlot = new Map(placements.map((p) => [p.slot_id, p]));
    for (const [index, row] of stored.entries()) {
      const target = normalizeSlotTarget(row.target);
      if (target === undefined) return fail();
      const placement = placementsBySlot.get(row.id);
      if (!!placement !== (row.status === 'collected' || row.status === 'finalized')) return fail();
      const itemId = placement ? String(placement.inventory_item_id) : null;
      const identity = itemId ? items.get(itemId)! : target;
      const found = identity?.kind === 'card' ? card(identity.cardId, identity.language ?? 'en') : null;
      const pokemon = identity?.kind === 'pokemon' ? getPokemonSummary(identity.pokemonId) : null;
      const targetCard = target?.kind === 'card' ? card(target.cardId, target.language ?? 'en') : undefined;
      slots.push({
        id: `public-${index}`,
        target:
          target?.kind === 'card'
            ? {
                kind: 'card',
                ...(targetCard ? { cardId: targetCard.ref.id } : {}),
                ...(target.language ? { language: target.language } : {}),
                ...(target.finish ? { finish: target.finish } : {}),
              }
            : target,
        item: itemId ? { grading: grades.has(itemId) ? { grade: grades.get(itemId)! } : null } : null,
        card:
          identity?.kind === 'card'
            ? {
                name: found?.name ?? 'Unknown card',
                ...(found?.image ? { image: found.image } : {}),
                ...(found ? found.ref : {}),
              }
            : null,
        pokemon: pokemon ? { id: pokemon.id, name: pokemon.name } : null,
        ...(itemId && providers.has(itemId) ? { recordedProvider: providers.get(itemId)! } : {}),
        ...withWants(wants(row.wanted_cards)),
      });
    }
    const sorted = (values: Row[]) => values.toSorted((a, b) => String(a.id).localeCompare(String(b.id)));
    await Promise.all([
      paged('binder_slots', SLOTS, 'position').then((final) => same(stored, final)),
      paged('inventory_placements', 'inventory_item_id,owner_user_id,collection_id,slot_id,version', 'slot_id').then(
        (final) => same(placements, final),
      ),
      ...itemPages.map(async (page) =>
        same(
          sorted(page),
          sorted(
            rows(
              (
                await run(
                  db
                    .from('inventory_items')
                    .select(ITEM)
                    .eq('owner_user_id', owner)
                    .in(
                      'id',
                      page.map((r) => String(r.id)),
                    )
                    .abortSignal(controller.signal),
                )
              ).data,
            ),
          ),
        ),
      ),
      binder().then((final) => same(initialBinder, final)),
      state().then((final) => same(initialState, final)),
      run(
        db
          .from('user_settings')
          .select('binder_rows,binder_cols,binder_color_id,binder_page_colors,binder_slot_glare_enabled,dark_mode')
          .eq('user_id', owner)
          .abortSignal(controller.signal)
          .maybeSingle(),
      ).then((final) => same(appearanceRow, final.data ?? {})),
      username().then((final) => same(publicUsername, final)),
      revision().then((final) => same(rev, final)),
      permission().then((final) => same(share, final)),
    ]);
    return { stamp, owner, binder: { ...base, prices: share.show_prices === true, slots } };
  } catch (error) {
    if (error instanceof PublicBinderMissing) throw error;
    return fail();
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}
