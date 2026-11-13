import {
  catalogCardSchema,
  catalogGroupSchema,
  catalogGroupDetailSchema,
  catalogPageSchema,
  similarCardsSchema,
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
const catalog = {
  ...paging,
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
      'Browse all card printings, including Trainers and Energy, with pagination. Records declare game:pokemon; IDs are globally unique opaque application IDs, not provider-local keys.',
    permissions: ['catalog:read'],
    write: false,
    schema: z.object(catalog).strict(),
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
    schema: z.object({ id, language }).strict(),
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
    schema: z.strictObject({ id, language }),
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
    schema: z
      .object({
        ...paging,
        language,
        series: id.optional(),
        year: z
          .string()
          .regex(/^(19|20)\d{2}$/)
          .optional(),
      })
      .strict(),
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
    schema: z.object({ id, language }).strict(),
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
    schema: z.object({ ...paging, language }).strict(),
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
    schema: z.object({ id, language }).strict(),
  },
  {
    name: 'list_languages',
    method: 'GET',
    path: '/languages',
    description: 'List supported card languages.',
    permissions: ['catalog:read'],
    write: false,
    schema: z.object({}).strict(),
  },
  {
    name: 'list_pokemon',
    method: 'GET',
    path: '/pokemon',
    description: 'List Pokédex entries.',
    permissions: ['catalog:read'],
    write: false,
    schema: z.object({ ...paging, q: z.string().max(80).optional() }).strict(),
  },
  {
    name: 'get_pokemon',
    method: 'GET',
    path: '/pokemon/{id}',
    description: 'Look up a Pokédex entry.',
    permissions: ['catalog:read'],
    write: false,
    schema: z.object({ id: z.string().regex(/^\d{1,4}$/) }).strict(),
  },
  {
    name: 'list_illustrators',
    method: 'GET',
    path: '/illustrators',
    description: 'List card illustrators.',
    permissions: ['catalog:read'],
    write: false,
    schema: z.object({ ...paging, q: z.string().max(80).optional() }).strict(),
  },
  {
    name: 'list_binders',
    method: 'GET',
    path: '/binders',
    description: 'List your accessible binders with slot counts.',
    permissions: ['binders:read'],
    write: false,
    schema: z.object({}).strict(),
  },
  {
    name: 'create_binder',
    method: 'POST',
    path: '/binders',
    description: 'Create a named binder.',
    permissions: ['binders:write'],
    write: true,
    schema: z.object({ name: z.string().min(1).max(40), idempotencyKey: z.string().min(8).max(100) }).strict(),
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
      .object({
        id: binderId,
        name: z.string().min(1).max(40).optional(),
        cardLanguages: z.array(z.enum(CARD_LANGUAGES)).min(1).max(CARD_LANGUAGES.length).optional(),
      })
      .strict()
      .refine((input) => input.name !== undefined || input.cardLanguages !== undefined, {
        message: 'Send name or cardLanguages.',
      }),
  },
  {
    name: 'reorder_binders',
    method: 'PUT',
    path: '/binders/order',
    description: 'Reorder all your binders.',
    permissions: ['binders:write'],
    write: true,
    schema: z.object({ order: z.array(binderId).min(1).max(100) }).strict(),
  },
  {
    name: 'delete_binder',
    method: 'DELETE',
    path: '/binders/{id}',
    description: 'Delete a binder. Populated binders need explicit confirmation.',
    permissions: ['binders:write'],
    write: true,
    schema: z.object({ id: binderId, confirm: z.boolean().optional() }).strict(),
  },
  {
    name: 'get_settings',
    method: 'GET',
    path: '/settings',
    description: 'Read persisted binder settings.',
    permissions: ['settings:read'],
    write: false,
    schema: z.object({ binderId: binderId.optional() }).strict(),
  },
  {
    name: 'get_prices',
    method: 'POST',
    path: '/prices/query',
    description: 'Read existing price evidence without contacting providers.',
    permissions: ['prices:read'],
    write: false,
    schema: z
      .object({
        cards: z
          .array(z.object({ cardId: id, language: language, finish: z.string().max(50).optional() }).strict())
          .min(1)
          .max(25),
      })
      .strict(),
  },

  {
    name: 'update_settings',
    method: 'PUT',
    path: '/settings',
    description: 'Replace persisted collection settings and optionally a binder layout.',
    permissions: ['settings:write'],
    write: true,
    schema: z
      .object({
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
      })
      .strict(),
  },
  {
    name: 'refresh_prices',
    method: 'POST',
    path: '/prices/refresh',
    description: 'Refresh a bounded batch of card prices with existing provider cooldowns.',
    permissions: ['prices:refresh'],
    write: true,
    schema: z
      .object({
        cards: z
          .array(z.object({ cardId: id, language }).strict())
          .min(1)
          .max(5),
      })
      .strict(),
  },
  {
    name: 'get_price_checks',
    method: 'GET',
    path: '/price-checks/{id}',
    description: 'Read existing exact-printing market comparisons.',
    permissions: ['prices:read'],
    write: false,
    schema: z
      .object({
        id,
        finish: z.enum(['normal', 'holo', 'reverse_holo', 'any']).optional(),
        source: z.enum(['ebay', 'soldcomps']).optional(),
      })
      .strict(),
  },
  {
    name: 'refresh_price_checks',
    method: 'POST',
    path: '/price-checks/{id}',
    description:
      'Refresh eBay asking comparisons within provider limits. Set source to ebay; sold-comps refreshes are app-only.',
    permissions: ['prices:refresh'],
    write: true,
    schema: z
      .object({
        id,
        finish: z.enum(['normal', 'holo', 'reverse_holo', 'any']).optional(),
        source: z.enum(['ebay', 'soldcomps']).optional(),
      })
      .strict(),
  },
  {
    name: 'get_comparison_job',
    method: 'GET',
    path: '/comparison-jobs/{id}',
    description: 'Read a background comparison job.',
    permissions: ['prices:read'],
    write: false,
    schema: z.object({ id: z.uuid() }).strict(),
  },
  {
    name: 'inspect_comparison_job',
    method: 'POST',
    path: '/comparison-jobs/inspect',
    description: 'Estimate comparison work and inspect existing jobs before starting.',
    permissions: ['prices:read'],
    write: false,
    schema: z
      .object({
        cards: z
          .array(z.object({ cardId: id, finish: z.enum(['normal', 'holo', 'reverse_holo', 'any']) }).strict())
          .min(1)
          .max(100),
      })
      .strict(),
  },
  {
    name: 'start_comparison_job',
    method: 'POST',
    path: '/comparison-jobs',
    description:
      'App-only: starting background comparisons through REST or MCP returns ui_only. Read, inspect and cancel existing jobs instead.',
    permissions: ['prices:refresh'],
    write: true,
    schema: z
      .object({
        cards: z
          .array(z.object({ cardId: id, finish: z.enum(['normal', 'holo', 'reverse_holo', 'any']) }).strict())
          .min(1)
          .max(100),
        confirmed: z.boolean(),
        idempotencyKey: z.string().min(8).max(100),
      })
      .strict(),
  },
  {
    name: 'cancel_comparison_job',
    method: 'DELETE',
    path: '/comparison-jobs/{id}',
    description: 'Cancel your accessible comparison job.',
    permissions: ['prices:refresh'],
    write: true,
    schema: z.object({ id: z.uuid() }).strict(),
  },
  {
    name: 'get_price_history',
    method: 'GET',
    path: '/prices/{id}/history',
    description: 'Read all recorded price evidence with bounded keyset pagination.',
    permissions: ['prices:read'],
    write: false,
    schema: z.object({ id, language, ...paging }).strict(),
  },
  {
    name: 'list_collection_audit',
    method: 'GET',
    path: '/collection/audit',
    description:
      'Read private account-lifetime committed collection history. Filter operationId for the exact original acknowledged command; zero or multiple entries do not identify a single recovery event. Keyset cursor is bound to filters; private certificates and label assets are redacted. Legacy actors are Unknown. Requires current collection access.',
    permissions: ['collection:read'],
    write: false,
    schema: z
      .object({
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
      })
      .strict(),
  },
  {
    name: 'get_collection_audit',
    method: 'GET',
    path: '/collection/audit/{id}',
    description:
      'Read one private committed audit event, including safe retained deltas and the original event ID for an undo.',
    permissions: ['collection:read'],
    write: false,
    schema: z.object({ id: z.string().regex(/^[1-9]\d{0,18}$/) }).strict(),
  },
  {
    name: 'check_deal',
    method: 'POST',
    path: '/deals/check',
    description: 'Evaluate an asking price using existing saved market evidence.',
    permissions: ['prices:read'],
    write: false,
    schema: z
      .object({
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
      })
      .strict(),
  },

  {
    name: 'get_pokemon_set_slots',
    method: 'GET',
    path: '/pokemon/sets/{id}/slots',
    description:
      'Read Pokémon species grouped by National Dex number within a set. These are not stable storage slots. Use list_cards for all printings, including Trainers and Energy.',
    permissions: ['catalog:read'],
    write: false,
    schema: z.object({ id, language, ...paging }).strict(),
  },
  {
    name: 'get_listings',
    method: 'GET',
    path: '/listings/{id}',
    description: 'Read current eBay listings. May contact the provider.',
    permissions: ['prices:refresh'],
    write: true,
    schema: z.object({ id, finish: z.enum(['normal', 'holo', 'reverse_holo']).optional() }).strict(),
  },
  {
    name: 'get_identity',
    method: 'GET',
    path: '/identity',
    description: 'Read your account username and display name.',
    permissions: ['settings:read'],
    write: false,
    schema: z.object({}).strict(),
  },
  {
    name: 'update_identity',
    method: 'PATCH',
    path: '/identity',
    description: 'Update your own public username or display name.',
    permissions: ['settings:write'],
    write: true,
    schema: z
      .object({ username: z.string().min(3).max(60).optional(), displayName: z.string().min(1).max(60).optional() })
      .strict(),
  },
  {
    name: 'get_binder_identity',
    method: 'GET',
    path: '/binders/{binderId}/identity',
    description: 'Read the public identity assigned to an accessible binder.',
    permissions: ['binders:read'],
    write: false,
    schema: z.object({ binderId }).strict(),
  },
  {
    name: 'update_binder_identity',
    method: 'PATCH',
    path: '/binders/{binderId}/identity',
    description: 'Set a public slug on a binder you own.',
    permissions: ['sharing:manage'],
    write: true,
    schema: z.object({ binderId, slug: z.string().min(1).max(60) }).strict(),
  },
  {
    name: 'get_sharing',
    method: 'GET',
    path: '/binders/{binderId}/sharing',
    description: 'Read sharing state. Only the collection owner may access share tokens.',
    permissions: ['sharing:manage'],
    write: false,
    schema: z.object({ binderId }).strict(),
  },
  {
    name: 'update_sharing',
    method: 'PUT',
    path: '/binders/{binderId}/sharing',
    description: 'Enable or disable sharing on a binder you own, with explicit price disclosure.',
    permissions: ['sharing:manage'],
    write: true,
    schema: z.object({ binderId, enabled: z.boolean(), showPrices: z.boolean().optional() }).strict(),
  },
  {
    name: 'get_appearance',
    method: 'GET',
    path: '/appearance',
    description: 'Read the collection binder appearance and revision.',
    permissions: ['binders:read'],
    write: false,
    schema: z.object({}).strict(),
  },
  {
    name: 'update_appearance',
    method: 'PUT',
    path: '/appearance',
    description: 'Save a binder appearance only if its revision still matches.',
    permissions: ['binders:write'],
    write: true,
    schema: z
      .object({
        baseRevision: z
          .number()
          .int()
          .nonnegative()
          .max(Number.MAX_SAFE_INTEGER - 1),
        design: z.record(z.string(), z.unknown()),
      })
      .strict(),
  },
  {
    name: 'list_partners',
    method: 'GET',
    path: '/partners',
    description: 'Read your current partnership and paginated invitations.',
    permissions: ['partners:manage'],
    write: false,
    schema: z.object(paging).strict(),
  },
  {
    name: 'invite_partner',
    method: 'POST',
    path: '/partners/invites',
    description: 'Invite a partner. Repeating a pending invitation does not create another.',
    permissions: ['partners:manage'],
    write: true,
    schema: z.object({ email: z.email().max(254) }).strict(),
  },
  {
    name: 'accept_partner_invite',
    method: 'POST',
    path: '/partners/invites/{inviteId}/accept',
    description: 'Accept an invitation addressed to your verified account email.',
    permissions: ['partners:manage'],
    write: true,
    schema: z.object({ inviteId: z.uuid() }).strict(),
  },
  {
    name: 'reject_partner_invite',
    method: 'POST',
    path: '/partners/invites/{inviteId}/reject',
    description: 'Reject an invitation addressed to your account.',
    permissions: ['partners:manage'],
    write: true,
    schema: z.object({ inviteId: z.uuid() }).strict(),
  },
  {
    name: 'disconnect_partner',
    method: 'DELETE',
    path: '/partners',
    description: 'Disconnect your partnership. This removes your access to a partner-owned collection.',
    permissions: ['partners:manage'],
    write: true,
    schema: z.object({}).strict(),
  },
  {
    name: 'list_show_purchases',
    method: 'GET',
    path: '/show-purchases',
    description: 'Read paginated account show purchases.',
    permissions: ['collection:read'],
    write: false,
    schema: z.object({ ...paging, since: z.iso.datetime().optional() }).strict(),
  },
  {
    name: 'add_show_purchase',
    method: 'POST',
    path: '/show-purchases',
    description: 'Record a purchase once using a client-generated purchase ID.',
    permissions: ['collection:write'],
    write: true,
    schema: z
      .object({
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
      })
      .strict(),
  },
  {
    name: 'remove_show_purchase',
    method: 'DELETE',
    path: '/show-purchases/{clientId}',
    description: 'Undo a purchase from your accessible collection account.',
    permissions: ['collection:write'],
    write: true,
    schema: z.object({ clientId: z.uuid() }).strict(),
  },

  {
    name: 'prepare_artwork_upload',
    method: 'POST',
    path: '/artwork/uploads',
    description:
      'Create a signed private R2 upload URL and artworkRef for the appearance design. Send the returned headers and exact file bytes.',
    permissions: ['binders:write'],
    write: true,
    schema: z
      .object({
        id: z.uuid(),
        mimeType: z.enum(['image/png', 'image/jpeg', 'image/webp']),
        size: z
          .number()
          .int()
          .positive()
          .max(5 * 1024 * 1024),
      })
      .strict(),
  },
  {
    name: 'get_artwork',
    method: 'GET',
    path: '/artwork/{id}',
    description: 'Get a five-minute download URL for your private binder artwork.',
    permissions: ['binders:read'],
    write: false,
    schema: z.object({ id: z.uuid() }).strict(),
  },
] as const;
export function matchRestOperation(method: string, path: string) {
  for (const operation of DEVELOPER_OPERATIONS.filter((op) => op.method === method).sort(
    (a, b) => Number(a.path.includes('{')) - Number(b.path.includes('{')),
  )) {
    const expected = operation.path.split('/').filter(Boolean),
      actual = path.split('/').filter(Boolean),
      params: Record<string, string> = {};
    if (expected.length !== actual.length) continue;
    if (
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
