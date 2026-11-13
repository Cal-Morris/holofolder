import { parseImportFile, type ImportLookup } from '@/lib/collection-import';
import { readImportLookups } from '@/lib/collection-import-resolve';
import { toCsvField } from '@/lib/collection-export';
import { freezeBackupPlan, parseBinderBackupV2, type BinderBackupV2 } from '@/lib/binder-backup-v2';
import { isCardLanguage, isCardFinish } from '@/lib/domain/cards';
import {
  normalizeInventoryIdentity,
  type InventoryIdentity,
  type InventoryCatalogResolver,
} from '@/lib/domain/inventory';
import { inventoryItemCandidate } from '@/lib/domain/inventory';
import { isSlotContractId, matchesSlotTarget, type BinderSlot } from '@/lib/domain/binder-slots';

export const INVENTORY_CSV_LOSS =
  'CSV is a card list. It cannot restore slot order, targets, spacers, placements, preset provenance, settings or grading records. Use JSON v2 for arrangement and recorded grading.';
const COLUMNS = ['catalog id', 'dex number', 'language', 'finish', 'quantity', 'list', 'grade'];

/** Repeated printings remain separate rows. No ownership IDs or private certificate data in CSV. */
export function buildInventoryCsv(input: BinderBackupV2): string {
  const backup = parseBinderBackupV2(JSON.stringify(input));
  const rows: (string | number | undefined)[][] = backup.items.map((i) => [
    i.identity.kind === 'card' ? i.identity.cardId : '',
    i.identity.kind === 'pokemon' ? i.identity.pokemonId : '',
    i.identity.kind === 'card' ? i.identity.language : '',
    i.identity.kind === 'card' ? i.identity.finish : '',
    1,
    'owned',
    i.grading ? 'Recorded grading requires JSON v2' : '',
  ]);
  for (const b of backup.binders)
    for (const s of b.slots) {
      for (const want of s.wantedCards)
        rows.push([want.card_id, '', want.card_language, want.card_finish, 1, 'wanted', '']);
      if (!s.wantedCards.length && s.status === 'wishlisted')
        rows.push([
          s.target?.kind === 'card' ? s.target.cardId : '',
          s.target?.kind === 'pokemon' ? s.target.pokemonId : '',
          '',
          '',
          1,
          'wanted',
          '',
        ]);
    }
  return [COLUMNS, ...rows].map((row) => row.map(toCsvField).join(',')).join('\r\n') + '\r\n';
}

export interface InventoryCsvCopy {
  row: number;
  copyId: string;
  list: 'owned' | 'wanted';
  identity: InventoryIdentity | null;
  compatibleSlotIds: string[];
  problem: string | null;
}
/** Private preview only. Catalog resolution supplies exact candidates, never a fuzzy first result.
 * IDs are allocated once and frozen, including separate IDs for quantity N and repeated rows. */
export function previewInventoryCsv(input: {
  text: string;
  newId: () => string;
  resolve: (lookup: ImportLookup) => InventoryIdentity[];
  resolveCatalog: InventoryCatalogResolver;
  savedEntryRemaining: number;
  targets?: readonly BinderSlot[];
}) {
  if (/^\s*[[{]/.test(input.text)) throw new Error('Use the JSON backup preview for arrangement files');
  if (!Number.isSafeInteger(input.savedEntryRemaining) || input.savedEntryRemaining < 0)
    throw new Error('Invalid billing evidence');
  const document = parseImportFile(input.text);
  const copies: InventoryCsvCopy[] = [];
  const ids = new Set<string>();
  for (const [index, cells] of document.records.entries()) {
    const get = (field: keyof typeof document.mapping) => {
      const column = document.mapping[field];
      return column === undefined ? '' : (cells[column] ?? '').trim();
    };
    const quantityText = get('quantity') || '1';
    const quantity = Number(quantityText);
    if (
      !/^\d+$/.test(quantityText) ||
      !Number.isSafeInteger(quantity) ||
      quantity < 1 ||
      copies.length + quantity > 5000
    )
      throw new Error('Maximum 5,000 distinct copies; quantity must be a positive integer');
    const language = get('language'),
      finish = get('finish'),
      list = get('list') || 'owned';
    let problem: string | null = null;
    let identity: InventoryIdentity | null = null;
    if (!isCardLanguage(language) || !isCardFinish(finish))
      problem = 'Choose an explicit supported language and finish';
    else if (list !== 'owned' && list !== 'wanted') problem = 'Choose owned or wanted';
    else if (get('productType') && !/^(pokemon|pokémon|trainer|energy|single|singles|card)$/i.test(get('productType')))
      problem = 'Only catalog card singles can become inventory copies';
    else if (get('grade') || get('condition'))
      problem = 'Grading/condition needs per-copy JSON metadata or explicit resolution';
    else {
      const lookup: ImportLookup = {
        language,
        finish,
        list,
        ...(get('cardId') ? { cardId: get('cardId') } : {}),
        ...(get('tcgplayerId') ? { tcgplayerId: get('tcgplayerId') } : {}),
        ...(get('cardName') ? { cardName: get('cardName') } : {}),
        ...(get('set') ? { set: get('set') } : {}),
        ...(get('number') ? { number: get('number') } : {}),
      };
      let matches: (InventoryIdentity | undefined)[] = [];
      try {
        matches = input.resolve(readImportLookups({ lookups: [lookup] })[0]).map(normalizeInventoryIdentity);
      } catch {
        problem = 'Resolve a valid exact catalog identity';
      }
      if (matches.length !== 1 || !matches[0] || matches[0].kind !== 'card')
        problem = 'Resolve one exact catalog printing explicitly';
      else if (matches[0].language !== language || matches[0].finish !== finish)
        problem = 'Catalog evidence does not match selected language/finish';
      else identity = matches[0];
    }
    for (let n = 0; n < quantity; n++) {
      const copyId = input.newId();
      if (!isSlotContractId(copyId) || ids.has(copyId)) throw new Error('Invalid or duplicate generated copy ID');
      ids.add(copyId);
      const item = identity
        ? { id: copyId, ownerUserId: 'preview', identity, grading: null, version: 0, acquiredAt: null }
        : null;
      const candidate = item ? inventoryItemCandidate(item, input.resolveCatalog) : undefined;
      const compatibleSlotIds = candidate
        ? (input.targets ?? []).flatMap((s) =>
            s.inventoryItemId === null && matchesSlotTarget(candidate, s.target) ? [s.id] : [],
          )
        : [];
      copies.push({
        row: index + 2,
        copyId,
        list: list === 'wanted' ? 'wanted' : 'owned',
        identity,
        compatibleSlotIds,
        problem:
          problem ??
          (input.targets && compatibleSlotIds.length !== 1
            ? 'Choose a compatible target explicitly or append a new slot'
            : null),
      });
    }
  }
  return freezeBackupPlan({
    copies,
    exceedsAllowance: copies.length > input.savedEntryRemaining,
    arrangementLoss: INVENTORY_CSV_LOSS,
    execution: 'blocked' as const,
    reason: 'Confirm add-copy/target/append decisions through the canonical import preview; no writes from CSV parsing',
  });
}
