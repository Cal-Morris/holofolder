import { z } from 'zod';
import { CARD_LANGUAGES } from '@/lib/domain/cards';

const id = z
  .string()
  .min(1)
  .max(200)
  .refine((v) => v.trim() === v);
const finish = z.enum(['normal', 'holo', 'reverse_holo', 'jumbo']);
/** Historical copied evidence. Creation independently checks every card against the mirror. */
export const setChecklistScopeSchema = z.strictObject({
  setId: id,
  setName: id,
  language: z.enum(CARD_LANGUAGES),
  finishes: z.array(finish).max(4),
  capturedAt: id,
  officialCardCount: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).nullable(),
  cards: z
    .array(
      z.strictObject({
        cardId: id,
        setId: id,
        localId: id,
        name: id,
        languageConfirmed: z.boolean(),
        verifiedFinishes: z.array(finish).max(4),
      }),
    )
    .max(4096),
  promoCardIds: z.array(id).max(4096),
  excludedCardIds: z.array(id).max(4096),
  warnings: z.array(z.string().max(1000)).max(10),
});
