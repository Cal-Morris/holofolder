import { z } from 'zod';

// Application IDs are global across games/providers. Provider-local IDs are evidence only.
export const CATALOG_GAME = 'pokemon' as const;
const catalogId = z
  .string()
  .min(1)
  .max(200)
  .describe('Globally unique opaque application ID, never a reusable provider-local key.');
const game = z.literal(CATALOG_GAME);
const names = z.record(z.string(), z.unknown());
export const catalogGroupSchema = z
  .object({
    id: catalogId,
    game,
    name: z.string(),
    names,
    symbol: z.url().optional().describe('Available set symbol on the Holo Folder CDN.'),
    logo: z.url().optional().describe('Available set logo on the Holo Folder CDN.'),
  })
  .passthrough();
// Detail reads retain their existing database-shaped fields.
export const catalogGroupDetailSchema = z.object({ id: catalogId, game, name_json: names }).passthrough();
export const catalogCardSchema = z
  .object({
    id: catalogId,
    game,
    canonicalId: catalogId,
    aliasIds: z.array(catalogId),
    localId: z.string(),
    name: z.string(),
    names,
    language: z.string(),
    set: z.object({
      id: catalogId,
      game,
      name: z.string(),
      officialCardCount: z.number().nullable(),
      releaseDate: z.string().nullable(),
    }),
    seriesId: catalogId,
    category: z.string().nullable(),
    rarity: z.string().nullable(),
    hp: z.number().nullable(),
    illustrator: z.string().nullable(),
    types: z.array(z.string()),
    variants: z.record(z.string(), z.boolean()),
    externalIds: z
      .record(z.string(), z.array(z.string()))
      .describe('Provider-local IDs keyed by source, scoped to this record game. Not application IDs or aliases.'),
    details: z.record(z.string(), z.unknown()),
    artworkRef: z.string().nullable(),
    image: z.string().nullable(),
    imageAvailability: z.enum(['available', 'missing', 'unavailable']),
    imageLanguage: z.string().nullable(),
    attribution: z.string(),
  })
  .strict();
const similarEntrySchema = z.strictObject({ similarity: z.number().min(-1).max(1), card: catalogCardSchema });
export const similarCardsSchema = z.strictObject({
  cardId: catalogId,
  language: z.string(),
  sameArtwork: z.array(similarEntrySchema),
  similarLook: z.array(similarEntrySchema),
});
const hintFlag = z.boolean().nullable();
export const identifyCardSchema = z.strictObject({
  model: z.string().describe('The picture model the fingerprints come from.'),
  confidence: z
    .enum(['confirmed', 'high', 'medium', 'low', 'none'])
    .describe(
      'confirmed: the number and set total hints agree with one of the top five candidates, and no other agrees as well. Otherwise the picture alone: high and medium were right about 92% and 86% of the time for the first candidate on real binder photos; low means choose from the list. none: no candidates.',
    ),
  candidates: z.array(
    z.strictObject({
      similarity: z.number().min(-1).max(1),
      card: catalogCardSchema,
      agrees: z
        .strictObject({ name: hintFlag, number: hintFlag, setTotal: hintFlag })
        .optional()
        .describe('Present when hints were sent: whether each agrees with this card, null for a hint not sent.'),
      confirmed: z.literal(true).optional().describe('The candidate the hints confirm.'),
    }),
  ),
});
export const catalogPageSchema = (row: z.ZodType) =>
  z.object({ data: z.array(row), nextCursor: z.string().nullable() }).passthrough();
export type DeveloperCatalogCard = z.infer<typeof catalogCardSchema>;
export type DeveloperCatalogGroup = z.infer<typeof catalogGroupSchema>;

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}
export function readExternalIdentifiers(value: unknown): Record<string, string[]> {
  const external = record(value),
    tcgdex = record(external.tcgdex),
    output: Record<string, string[]> = {};
  function add(provider: string, id: unknown) {
    if (
      (typeof id !== 'string' && typeof id !== 'number') ||
      !String(id) ||
      String(id).length > 200 ||
      String(id).includes('://')
    )
      return;
    const ids = (output[provider] ??= []);
    if (!ids.includes(String(id))) ids.push(String(id));
  }
  const variants = Array.isArray(tcgdex.variantThirdParty) ? tcgdex.variantThirdParty : [];
  for (const thirdParty of [tcgdex.thirdParty, ...variants])
    for (const provider of ['tcgplayer', 'cardmarket', 'scrydex']) add(provider, record(thirdParty)[provider]);
  for (const provider of ['tcgplayer', 'cardmarket', 'pokemontcg', 'scrydex']) {
    const entry = record(external[provider]);
    add(provider, entry.id ?? entry.productId);
  }
  add('pokemontcg', record(external.pokemon_tcg).cardId);
  add('tcgplayer', record(external.catalog).productId);
  return output;
}
