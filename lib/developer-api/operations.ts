import {
  catalogCardSchema,
  catalogGroupSchema,
  catalogGroupDetailSchema,
  catalogPageSchema,
  similarCardsSchema,
  suggestedCardsSchema,
  identifyCardSchema,
} from './catalog';
import { IDENTIFY_DEFAULT_LIMIT, IDENTIFY_MAX_LIMIT, IDENTIFY_MAX_REQUEST_BYTES } from '@/lib/card-identify';
import { PRESET_OPERATIONS } from './presets';
import { NATIVE_READ_OPERATIONS } from './native-read';
import { DISPLAY_CURRENCIES, PRICING_REGIONS } from '@/lib/pricing-region';
import { z } from 'zod';
import type { DeveloperPermission } from './permissions';
import { CARD_LANGUAGES, CARD_FINISHES } from '@/lib/domain/cards';
import { NATIVE_DEVELOPER_OPERATIONS } from './storage';
const id = z.string().min(1).max(200),
  binderId = z.uuid(),
  language = z.enum(CARD_LANGUAGES).optional();
const paging = { limit: z.number().int().min(1).max(100).optional(), cursor: z.string().max(1024).optional() };
/** Opt-in detail. REST keeps full responses by default; MCP results go into a model's context, so lean by default. */
const include = (what: string) => z.boolean().optional().describe(`${what} Default: true on REST, false on MCP.`);
const includeDetails = include('Include details (the stored provider record).');
const includeRaw = include('Include the raw card or set list and supplemental sources.');
const includeHistory = include('Include history, trend points, buySignal and fxDate.');
const catalog = {
  ...paging,
  includeDetails,
  language,
  q: z.string().max(80).optional(),
  set: id.optional(),
  series: id.optional(),
  illustrator: z.string().max(200).optional(),
  pokemon: z.number().int().positive().max(9999).optional(),
};
export type DeveloperOperation = {
  name: string;
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  path: string;
  description: string;
  permissions: readonly DeveloperPermission[];
  write: boolean;
  schema: z.ZodObject | z.ZodUnion<readonly z.ZodObject[]>;
  maxBytes?: number;
  responseSchema?: z.ZodType;
  errorSchemas?: Readonly<Partial<Record<number, z.ZodType>>>;
  admission?: 'staged';
  idempotent?: boolean;
  destructive?: boolean;
};
export const DEVELOPER_OPERATIONS: readonly DeveloperOperation[] = [
  ...NATIVE_DEVELOPER_OPERATIONS,
  ...NATIVE_READ_OPERATIONS,
  ...PRESET_OPERATIONS,
  {
    name: 'list_cards',
    idempotent: true,
    responseSchema: catalogPageSchema(catalogCardSchema),
    method: 'GET',
    path: '/cards',
    description:
      'Browse all card printings, including Trainers and Energy, with pagination. q matches card names and collector nicknames ("moonbreon", "gold star rayquaza", "umbreon alt art"), and a rarity word at either end keeps that rarity ("charizard sir", "full art lugia"). Records declare game:pokemon; IDs are globally unique opaque application IDs, not provider-local keys.',
    permissions: ['catalog:read'],
    write: false,
    schema: z.strictObject(catalog),
  },
  {
    name: 'get_card',
    idempotent: true,
    responseSchema: catalogCardSchema,
    method: 'GET',
    path: '/cards/{id}',
    description:
      'Look up a printing by its exact global application ID. game:pokemon is the only implemented catalog. externalIds are provider-local evidence scoped by game and source, never aliases.',
    permissions: ['catalog:read'],
    write: false,
    schema: z.strictObject({ id, language, includeDetails }),
  },
  {
    name: 'get_similar_cards',
    idempotent: true,
    responseSchema: similarCardsSchema,
    method: 'GET',
    path: '/cards/{id}/similar',
    description:
      'Cards whose picture looks like this printing, from image fingerprints. sameArtwork lists other printings of the same artwork (reprints, other languages, Japanese prints), most similar first; similarLook lists the next nearest cards by colour and composition. similarity is the cosine similarity of the two pictures, 0 to 1. Both lists are empty when the card has no fingerprint yet.',
    permissions: ['catalog:read'],
    write: false,
    schema: z.strictObject({ id, language, includeDetails }),
  },
  {
    name: 'suggest_cards',
    idempotent: true,
    responseSchema: suggestedCardsSchema,
    method: 'POST',
    path: '/cards/suggest',
    description:
      'Cards that would fit alongside a group of cards, such as the cards on one binder page. Ranked by picture first (cards that look like several of the given cards come first, from image fingerprints; reprints of the same artwork are left out), then filled up with cards sharing a Pokémon, illustrator, energy type or set. pokemon adds Pokédex numbers for pockets kept for a Pokémon without a card. The given cards are never returned; leave out any others you already have yourself. At most 60 cards.',
    permissions: ['catalog:read'],
    write: false,
    schema: z.strictObject({
      cardIds: z.array(id).max(40).describe('Card IDs already on the page, e.g. ["base1-4", "base1-2"].'),
      pokemon: z.array(z.number().int().positive().max(9999)).max(40).optional().describe('Pokédex numbers.'),
      language,
      includeDetails,
    }),
  },
  {
    name: 'identify_card',
    idempotent: true,
    responseSchema: identifyCardSchema,
    method: 'POST',
    path: '/cards/identify',
    description: `Identify a card from a photo. Send the picture as base64 (JPEG, PNG or WebP, at most 3 MB; a card cropped to about 500-1000 px works best), optionally with the name and collector number you read from it. Returns the closest cards by picture, most similar first, with a confidence label. It never picks a card for you: confidence is "confirmed" only when your number and set total agree with one of the top five candidates and no other agrees as well, which is then marked confirmed. language limits the search to that print language's pictures (Japanese prints have their own; other languages share the English picture). Limited to 20 requests per minute per API key or connection.`,
    permissions: ['catalog:read'],
    write: false,
    maxBytes: IDENTIFY_MAX_REQUEST_BYTES,
    schema: z.strictObject({
      image: z
        .string()
        .min(1)
        .max(IDENTIFY_MAX_REQUEST_BYTES)
        .describe('The photo, base64 (a data: URL prefix is allowed).'),
      name: z.string().max(80).optional().describe('The card name as read, e.g. "Charizard ex".'),
      number: z.string().max(20).optional().describe('The collector number as printed, e.g. "025/165" or "TG05".'),
      language,
      limit: z
        .number()
        .int()
        .min(1)
        .max(IDENTIFY_MAX_LIMIT)
        .optional()
        .describe(`Candidates to return (default ${IDENTIFY_DEFAULT_LIMIT}).`),
      includeDetails,
    }),
  },
  {
    name: 'list_sets',
    idempotent: true,
    responseSchema: catalogPageSchema(catalogGroupSchema),
    method: 'GET',
    path: '/sets',
    description:
      'List card sets with game:pokemon and global application IDs. Filter by release year, for example 2017. Available symbol and logo URLs are served from the Holo Folder CDN.',
    permissions: ['catalog:read'],
    write: false,
    schema: z.strictObject({
      ...paging,
      language,
      series: id.optional(),
      year: z
        .string()
        .regex(/^(19|20)\d{2}$/)
        .optional(),
    }),
  },
  {
    name: 'get_set',
    idempotent: true,
    responseSchema: catalogGroupDetailSchema,
    method: 'GET',
    path: '/sets/{id}',
    description: 'Look up a card set by global application ID, with game:pokemon.',
    permissions: ['catalog:read'],
    write: false,
    schema: z.strictObject({ id, language, includeRaw }),
  },
  {
    name: 'list_series',
    idempotent: true,
    responseSchema: catalogPageSchema(catalogGroupSchema),
    method: 'GET',
    path: '/series',
    description: 'List card series with game:pokemon and global application IDs.',
    permissions: ['catalog:read'],
    write: false,
    schema: z.strictObject({ ...paging, language }),
  },
  {
    name: 'get_series',
    idempotent: true,
    responseSchema: catalogGroupDetailSchema,
    method: 'GET',
    path: '/series/{id}',
    description: 'Look up a card series by global application ID, with game:pokemon.',
    permissions: ['catalog:read'],
    write: false,
    schema: z.strictObject({ id, language, includeRaw }),
  },
  {
    name: 'list_languages',
    method: 'GET',
    path: '/languages',
    description: 'List supported card languages.',
    permissions: ['catalog:read'],
    write: false,
    schema: z.strictObject({}),
  },
  {
    name: 'list_pokemon',
    method: 'GET',
    path: '/pokemon',
    description: 'List Pokédex entries.',
    permissions: ['catalog:read'],
    write: false,
    schema: z.strictObject({ ...paging, q: z.string().max(80).optional() }),
  },
  {
    name: 'get_pokemon',
    method: 'GET',
    path: '/pokemon/{id}',
    description: 'Look up a Pokédex entry.',
    permissions: ['catalog:read'],
    write: false,
    schema: z.strictObject({ id: z.string().regex(/^\d{1,4}$/) }),
  },
  {
    name: 'list_illustrators',
    method: 'GET',
    path: '/illustrators',
    description: 'List card illustrators.',
    permissions: ['catalog:read'],
    write: false,
    schema: z.strictObject({ ...paging, q: z.string().max(80).optional() }),
  },
  {
    name: 'list_binders',
    method: 'GET',
    path: '/binders',
    description: 'List your accessible binders with slot counts.',
    permissions: ['binders:read'],
    write: false,
    schema: z.strictObject({}),
  },
  {
    name: 'create_binder',
    method: 'POST',
    path: '/binders',
    description: 'Create a named binder.',
    permissions: ['binders:write'],
    write: true,
    schema: z.strictObject({ name: z.string().min(1).max(40), idempotencyKey: z.string().min(8).max(100) }),
  },
  {
    name: 'update_binder',
    method: 'PATCH',
    path: '/binders/{id}',
    description:
      'Rename a binder or choose the card languages its card lists show (default English only). Send name, cardLanguages or both.',
    permissions: ['binders:write'],
    write: true,
    schema: z
      .strictObject({
        id: binderId,
        name: z.string().min(1).max(40).optional(),
        cardLanguages: z.array(z.enum(CARD_LANGUAGES)).min(1).max(CARD_LANGUAGES.length).optional(),
      })
      .refine((input) => input.name !== undefined || input.cardLanguages !== undefined, {
        message: 'Send name or cardLanguages.',
      }),
  },
  {
    name: 'set_binder_layout',
    method: 'PATCH',
    path: '/binders/{id}/layout',
    description:
      'Change a binder’s page grid (rows × columns, 1–8 each; grids other than 1×1, 2×2, 3×3, 3×4, 4×3 and 4×4 need Premium). Pockets are an ordered list paged by the grid, so no card leaves its pocket and nothing is removed: cards keep their order and only move between pages and spots. Send dryRun:true first to get the consequences (cards changing page or spot, page counts, plain-language summary) and the preconditions, then apply with those preconditions and a retry-stable operationId. A retry with the same body returns the stored receipt; anything that changed in between returns 409 to review again. Recorded in Activity and undoable.',
    permissions: ['collection:read', 'binders:read', 'collection:write', 'binders:write'],
    write: true,
    schema: z
      .strictObject({
        id: binderId,
        rows: z.number().int().min(1).max(8),
        cols: z.number().int().min(1).max(8),
        dryRun: z
          .boolean()
          .optional()
          .describe('true reviews the change and returns preconditions without changing anything.'),
        operationId: z
          .string()
          .min(8)
          .max(100)
          .refine((v) => v.trim() === v)
          .optional()
          .describe('Required to apply. Keep it across retries.'),
        inventoryRevision: z
          .number()
          .int()
          .min(0)
          .max(Number.MAX_SAFE_INTEGER)
          .optional()
          .describe('Required to apply, from the dry run.'),
        collectionVersion: z
          .number()
          .int()
          .min(0)
          .max(Number.MAX_SAFE_INTEGER)
          .optional()
          .describe('Required to apply, from the dry run.'),
        layoutRevision: z
          .number()
          .int()
          .min(0)
          .max(Number.MAX_SAFE_INTEGER)
          .optional()
          .describe('Required to apply: the binder’s current layout revision, from the dry run.'),
      })
      .refine(
        (input) =>
          input.dryRun === true ||
          [input.operationId, input.inventoryRevision, input.collectionVersion, input.layoutRevision].every(
            (value) => value !== undefined,
          ),
        { message: 'Apply needs operationId and the preconditions from a dry run.' },
      ),
  },
  {
    name: 'move_binder_page',
    method: 'POST',
    path: '/binders/{id}/pages/move',
    description:
      'Move a whole page of a binder to another page number, like Move page in the app’s layout editing: page `from` becomes page `to` and the pages in between shift by one. Pages are one-based and paged by the binder’s grid (list_binders). Only full pages move: a partial last page, or moving past one, returns 400 page_not_movable. Cards keep their pockets; only pocket order changes. Send a retry-stable operationId; a retry with the same body returns the stored receipt, and a change by someone else mid-request returns 409 to try again with a new operationId. Recorded in Activity and undoable.',
    permissions: ['collection:read', 'binders:read', 'collection:write', 'binders:write'],
    write: true,
    schema: z.strictObject({
      id: binderId,
      from: z.number().int().min(1).max(4096).describe('The page to move, one-based.'),
      to: z.number().int().min(1).max(4096).describe('The page number it should become, one-based.'),
      operationId: z
        .string()
        .min(8)
        .max(100)
        .refine((v) => v.trim() === v)
        .describe('Retry-stable: keep it across retries of this move.'),
    }),
  },
  {
    name: 'reorder_binders',
    method: 'PUT',
    path: '/binders/order',
    description: 'Reorder all your binders.',
    permissions: ['binders:write'],
    write: true,
    schema: z.strictObject({ order: z.array(binderId).min(1).max(100) }),
  },
  {
    name: 'delete_binder',
    method: 'DELETE',
    path: '/binders/{id}',
    description: 'Delete a binder. Populated binders need explicit confirmation.',
    permissions: ['binders:write'],
    write: true,
    schema: z.strictObject({ id: binderId, confirm: z.boolean().optional() }),
  },
  {
    name: 'get_settings',
    method: 'GET',
    path: '/settings',
    description: 'Read persisted binder settings.',
    permissions: ['settings:read'],
    write: false,
    schema: z.strictObject({ binderId: binderId.optional() }),
  },
  {
    name: 'get_prices',
    method: 'POST',
    path: '/prices/query',
    description:
      'Read existing price evidence without contacting providers. A card’s finish narrows finishPrices to the quotes that price it (rarity-named finishes take the holo quote; jumbo has none).',
    permissions: ['prices:read'],
    write: false,
    schema: z.strictObject({
      cards: z
        .array(z.strictObject({ cardId: id, language: language, finish: z.string().max(50).optional() }))
        .min(1)
        .max(25),
      includeHistory,
    }),
  },

  {
    name: 'update_settings',
    method: 'PUT',
    path: '/settings',
    description: 'Replace persisted collection settings and optionally a binder layout.',
    permissions: ['settings:write'],
    write: true,
    schema: z.strictObject({
      baseFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
      binderId: binderId.optional(),
      binderRows: z.number().int().min(1).max(8),
      binderCols: z.number().int().min(1).max(8),
      binderColorId: z.string().max(100),
      binderPageColors: z.record(z.string().max(10), z.string().max(100)),
      binderSlotGlareEnabled: z.boolean(),
      cardFinishEffectsEnabled: z.boolean(),
      darkMode: z.boolean(),
      showBinderValue: z.boolean(),
      pricingRegion: z.enum(PRICING_REGIONS).nullable(),
      preferredCurrency: z.enum(DISPLAY_CURRENCIES).nullable(),
      preferredCardLanguage: z.enum(CARD_LANGUAGES).nullable(),
    }),
  },
  {
    name: 'refresh_prices',
    method: 'POST',
    path: '/prices/refresh',
    description: 'Refresh a bounded batch of card prices with existing provider cooldowns.',
    permissions: ['prices:refresh'],
    write: true,
    schema: z.strictObject({
      cards: z
        .array(z.strictObject({ cardId: id, language }))
        .min(1)
        .max(5),
      includeHistory,
    }),
  },
  {
    name: 'get_price_checks',
    method: 'GET',
    path: '/price-checks/{id}',
    description: 'Read existing exact-printing market comparisons.',
    permissions: ['prices:read'],
    write: false,
    schema: z.strictObject({
      id,
      finish: z.enum(['normal', 'holo', 'reverse_holo', 'any']).optional(),
      source: z.enum(['ebay', 'soldcomps']).optional(),
      includeItems: include('Include individual sales and listings.'),
    }),
  },
  {
    name: 'refresh_price_checks',
    method: 'POST',
    path: '/price-checks/{id}',
    description:
      'Refresh eBay asking comparisons within provider limits. Set source to ebay; sold-comps refreshes are app-only.',
    permissions: ['prices:refresh'],
    write: true,
    schema: z.strictObject({
      id,
      finish: z.enum(['normal', 'holo', 'reverse_holo', 'any']).optional(),
      source: z.enum(['ebay', 'soldcomps']).optional(),
      includeItems: include('Include individual sales and listings.'),
    }),
  },
  {
    name: 'get_comparison_job',
    method: 'GET',
    path: '/comparison-jobs/{id}',
    description: 'Read a background comparison job.',
    permissions: ['prices:read'],
    write: false,
    schema: z.strictObject({ id: z.uuid() }),
  },
  {
    name: 'inspect_comparison_job',
    method: 'POST',
    path: '/comparison-jobs/inspect',
    description: 'Estimate comparison work and inspect existing jobs before starting.',
    permissions: ['prices:read'],
    write: false,
    schema: z.strictObject({
      cards: z
        .array(z.strictObject({ cardId: id, finish: z.enum(['normal', 'holo', 'reverse_holo', 'any']) }))
        .min(1)
        .max(100),
    }),
  },
  {
    name: 'start_comparison_job',
    method: 'POST',
    path: '/comparison-jobs',
    description:
      'App-only: starting background comparisons through REST or MCP returns ui_only. Read, inspect and cancel existing jobs instead.',
    permissions: ['prices:refresh'],
    write: true,
    schema: z.strictObject({
      cards: z
        .array(z.strictObject({ cardId: id, finish: z.enum(['normal', 'holo', 'reverse_holo', 'any']) }))
        .min(1)
        .max(100),
      confirmed: z.boolean(),
      idempotencyKey: z.string().min(8).max(100),
    }),
  },
  {
    name: 'cancel_comparison_job',
    method: 'DELETE',
    path: '/comparison-jobs/{id}',
    description: 'Cancel your accessible comparison job.',
    permissions: ['prices:refresh'],
    write: true,
    schema: z.strictObject({ id: z.uuid() }),
  },
  {
    name: 'get_price_history',
    method: 'GET',
    path: '/prices/{id}/history',
    description: 'Read all recorded price evidence with bounded keyset pagination.',
    permissions: ['prices:read'],
    write: false,
    schema: z.strictObject({ id, language, ...paging }),
  },
  {
    name: 'list_collection_audit',
    method: 'GET',
    path: '/collection/audit',
    description:
      'Read private account-lifetime committed collection history. Filter operationId for the exact original acknowledged command; zero or multiple entries do not identify a single recovery event. Keyset cursor is bound to filters; private certificates and label assets are redacted. Legacy actors are Unknown. Requires current collection access.',
    permissions: ['collection:read'],
    write: false,
    schema: z.strictObject({
      ...paging,
      operationId: z
        .string()
        .min(1)
        .max(200)
        .regex(/^\S(?:.*\S)?$/)
        .optional(),
      collectionId: binderId.optional(),
      inventoryItemId: id.optional(),
      slotId: id.optional(),
      pokemonId: z.number().int().positive().max(9999).optional(),
      cardId: id.optional(),
      actorId: z.uuid().optional(),
      action: z.string().max(80).optional(),
      recoveryOfEventId: z
        .string()
        .regex(/^[1-9]\d{0,18}$/)
        .optional(),
      since: z.iso.datetime().optional(),
      until: z.iso.datetime().optional(),
      includeChanges: include('Include before/after changes; otherwise changeCount and changedFields.'),
    }),
  },
  {
    name: 'get_collection_audit',
    method: 'GET',
    path: '/collection/audit/{id}',
    description:
      'Read one private committed audit event, including safe retained deltas and the original event ID for an undo.',
    permissions: ['collection:read'],
    write: false,
    schema: z.strictObject({ id: z.string().regex(/^[1-9]\d{0,18}$/) }),
  },
  {
    name: 'check_deal',
    method: 'POST',
    path: '/deals/check',
    description: 'Evaluate an asking price using existing saved market evidence.',
    permissions: ['prices:read'],
    write: false,
    schema: z.strictObject({
      cardId: id,
      language,
      askingPrice: z.number().positive().max(10000000),
      currency: z.enum(DISPLAY_CURRENCIES),
      region: z.enum(PRICING_REGIONS).optional(),
      finish: z.enum(['normal', 'holo', 'reverse_holo']).optional(),
      thresholds: z
        .object({
          greatPct: z.number().min(0).max(100),
          fairPct: z.number().min(0).max(100),
          walkAwayPct: z.number().min(0).max(1000),
        })
        .optional(),
      includeHistory: include('Include the full price; otherwise only gbpAmount, confidence and updatedAt.'),
    }),
  },

  {
    name: 'get_pokemon_set_slots',
    method: 'GET',
    path: '/pokemon/sets/{id}/slots',
    description:
      'Read Pokémon species grouped by National Dex number within a set. These are not stable storage slots. Use list_cards for all printings, including Trainers and Energy.',
    permissions: ['catalog:read'],
    write: false,
    schema: z.strictObject({ id, language, ...paging }),
  },
  {
    name: 'get_listings',
    method: 'GET',
    path: '/listings/{id}',
    description: 'Read current eBay listings. May contact the provider.',
    permissions: ['prices:refresh'],
    write: true,
    schema: z.strictObject({ id, finish: z.enum(['normal', 'holo', 'reverse_holo']).optional() }),
  },
  {
    name: 'get_identity',
    method: 'GET',
    path: '/identity',
    description: 'Read your account username and display name.',
    permissions: ['settings:read'],
    write: false,
    schema: z.strictObject({}),
  },
  {
    name: 'update_identity',
    method: 'PATCH',
    path: '/identity',
    description: 'Update your own public username or display name.',
    permissions: ['settings:write'],
    write: true,
    schema: z.strictObject({
      username: z.string().min(3).max(60).optional(),
      displayName: z.string().min(1).max(60).optional(),
    }),
  },
  {
    name: 'get_binder_identity',
    method: 'GET',
    path: '/binders/{binderId}/identity',
    description: 'Read the public identity assigned to an accessible binder.',
    permissions: ['binders:read'],
    write: false,
    schema: z.strictObject({ binderId }),
  },
  {
    name: 'update_binder_identity',
    method: 'PATCH',
    path: '/binders/{binderId}/identity',
    description: 'Set a public slug on a binder you own.',
    permissions: ['sharing:manage'],
    write: true,
    schema: z.strictObject({ binderId, slug: z.string().min(1).max(60) }),
  },
  {
    name: 'get_sharing',
    method: 'GET',
    path: '/binders/{binderId}/sharing',
    description: 'Read sharing state. Only the collection owner may access share tokens.',
    permissions: ['sharing:manage'],
    write: false,
    schema: z.strictObject({ binderId }),
  },
  {
    name: 'update_sharing',
    method: 'PUT',
    path: '/binders/{binderId}/sharing',
    description: 'Enable or disable sharing on a binder you own, with explicit price disclosure.',
    permissions: ['sharing:manage'],
    write: true,
    schema: z.strictObject({ binderId, enabled: z.boolean(), showPrices: z.boolean().optional() }),
  },
  {
    name: 'get_appearance',
    method: 'GET',
    path: '/appearance',
    description: 'Read the collection binder appearance and revision.',
    permissions: ['binders:read'],
    write: false,
    schema: z.strictObject({}),
  },
  {
    name: 'update_appearance',
    method: 'PUT',
    path: '/appearance',
    description: 'Save a binder appearance only if its revision still matches.',
    permissions: ['binders:write'],
    write: true,
    schema: z.strictObject({
      baseRevision: z
        .number()
        .int()
        .nonnegative()
        .max(Number.MAX_SAFE_INTEGER - 1),
      design: z.record(z.string(), z.unknown()),
    }),
  },
  {
    name: 'list_partners',
    method: 'GET',
    path: '/partners',
    description: 'Read your current partnership and paginated invitations.',
    permissions: ['partners:manage'],
    write: false,
    schema: z.strictObject(paging),
  },
  {
    name: 'invite_partner',
    method: 'POST',
    path: '/partners/invites',
    description: 'Invite a partner. Repeating a pending invitation does not create another.',
    permissions: ['partners:manage'],
    write: true,
    schema: z.strictObject({ email: z.email().max(254) }),
  },
  {
    name: 'accept_partner_invite',
    method: 'POST',
    path: '/partners/invites/{inviteId}/accept',
    description: 'Accept an invitation addressed to your verified account email.',
    permissions: ['partners:manage'],
    write: true,
    schema: z.strictObject({ inviteId: z.uuid() }),
  },
  {
    name: 'reject_partner_invite',
    method: 'POST',
    path: '/partners/invites/{inviteId}/reject',
    description: 'Reject an invitation addressed to your account.',
    permissions: ['partners:manage'],
    write: true,
    schema: z.strictObject({ inviteId: z.uuid() }),
  },
  {
    name: 'disconnect_partner',
    method: 'DELETE',
    path: '/partners',
    description: 'Disconnect your partnership. This removes your access to a partner-owned collection.',
    permissions: ['partners:manage'],
    write: true,
    schema: z.strictObject({}),
  },
  {
    name: 'list_show_purchases',
    method: 'GET',
    path: '/show-purchases',
    description: 'Read paginated account show purchases.',
    permissions: ['collection:read'],
    write: false,
    schema: z.strictObject({ ...paging, since: z.iso.datetime().optional() }),
  },
  {
    name: 'add_show_purchase',
    method: 'POST',
    path: '/show-purchases',
    description: 'Record a purchase once using a client-generated purchase ID.',
    permissions: ['collection:write'],
    write: true,
    schema: z.strictObject({
      clientId: z.uuid(),
      cardId: z.string().min(1).max(64),
      cardName: z.string().min(1).max(200),
      language,
      finish: z.enum(CARD_FINISHES).optional(),
      price: z.number().nonnegative().max(9999999999).multipleOf(0.01),
      marketPrice: z.number().nonnegative().max(9999999999).multipleOf(0.01).nullable().optional(),
      currency: z.enum(DISPLAY_CURRENCIES),
      boughtAt: z.iso.datetime(),
      bundleId: z.uuid().nullable().optional(),
    }),
  },
  {
    name: 'remove_show_purchase',
    method: 'DELETE',
    path: '/show-purchases/{clientId}',
    description: 'Undo a purchase from your accessible collection account.',
    permissions: ['collection:write'],
    write: true,
    schema: z.strictObject({ clientId: z.uuid() }),
  },

  {
    name: 'prepare_artwork_upload',
    method: 'POST',
    path: '/artwork/uploads',
    description:
      'Create a signed private R2 upload URL and artworkRef for the appearance design. Send the returned headers and exact file bytes.',
    permissions: ['binders:write'],
    write: true,
    schema: z.strictObject({
      id: z.uuid(),
      mimeType: z.enum(['image/png', 'image/jpeg', 'image/webp']),
      size: z
        .number()
        .int()
        .positive()
        .max(5 * 1024 * 1024),
    }),
  },
  {
    name: 'get_artwork',
    method: 'GET',
    path: '/artwork/{id}',
    description: 'Get a five-minute download URL for your private binder artwork.',
    permissions: ['binders:read'],
    write: false,
    schema: z.strictObject({ id: z.uuid() }),
  },
] as const;
const isTemplated = (operation: DeveloperOperation) => operation.path.includes('{');
/** Literal paths are tried before templated ones; sorted once, stable within each group. */
const OPERATIONS_BY_SPECIFICITY = DEVELOPER_OPERATIONS.toSorted(
  (a, b) => Number(isTemplated(a)) - Number(isTemplated(b)),
);
export function matchRestOperation(method: string, path: string) {
  for (const operation of OPERATIONS_BY_SPECIFICITY) {
    if (operation.method !== method) continue;
    const expected = operation.path.split('/').filter(Boolean),
      actual = path.split('/').filter(Boolean),
      params: Record<string, string> = {};
    if (
      expected.length === actual.length &&
      expected.every((part, index) => {
        if (part.startsWith('{')) {
          params[part.slice(1, -1)] = actual[index];
          return true;
        }
        return part === actual[index];
      })
    )
      return { operation, params };
  }
  return null;
}
