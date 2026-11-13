import { COLLECTION_CSV_COLUMNS, toCsvField } from '@/lib/collection-export';
import { normalizeCollectionItem } from '@/lib/collection/normalize';
import { collectionFingerprint } from '@/lib/collection/sync';
import {
  isCardLanguage,
  isCardFinish,
  isSlotStatus,
  type CardLanguage,
  type CardFinish,
  type CollectedPokemon,
} from '@/lib/domain/cards';
import { getPokemonById } from '@/lib/pokemon-catalog';
import { savedCardWeight } from '@/lib/billing';

export const IMPORT_MAX_BYTES = 10 * 1024 * 1024;
export const IMPORT_FIELDS = [
  'cardId',
  'tcgplayerId',
  'cardName',
  'set',
  'number',
  'dex',
  'list',
  'language',
  'finish',
  'quantity',
  'condition',
  'grade',
  'productType',
  'status',
] as const;
export type ImportField = (typeof IMPORT_FIELDS)[number];
export type ImportMapping = Partial<Record<ImportField, number>>;
export interface ImportDefaults {
  language: CardLanguage;
  finish: CardFinish;
  list: 'owned' | 'wanted';
}
export interface ImportLookup extends ImportDefaults {
  cardId?: string;
  tcgplayerId?: string;
  cardName?: string;
  set?: string;
  number?: string;
}
export interface ImportDocument {
  headers: string[];
  records: string[][];
  mapping: ImportMapping;
  trusted: boolean;
}
export interface ImportRow {
  row: number;
  cells: string[];
  lookup: ImportLookup;
  item?: CollectedPokemon;
  problem?: string;
}
export interface PlannedImportRow extends ImportRow {
  outcome: 'ready' | 'choice' | 'conflict' | 'duplicate' | 'unsupported' | 'unresolved';
  reason: string;
  selected: boolean;
}

function csvRecords(text: string) {
  const records: string[][] = [];
  let row: string[] = [],
    cell = '',
    quoted = false,
    closed = false;
  const field = () => {
    row.push(cell);
    cell = '';
    closed = false;
    if (row.length > 128) throw new Error('Maximum 128 columns per row.');
  };
  const record = () => {
    field();
    if (row.some((value) => value.trim())) records.push(row);
    row = [];
    if (records.length > 5001) throw new Error('Maximum 5,000 data rows.');
  };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          quoted = false;
          closed = true;
        }
      } else cell += c;
    } else if (c === '"') {
      if (cell || closed) throw new Error('Malformed CSV quote.');
      quoted = true;
    } else if (c === ',') field();
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      record();
    } else {
      if (closed) throw new Error('Unexpected text after CSV quote.');
      cell += c;
    }
    if (cell.length > 16_384) throw new Error('A CSV cell is too long (maximum 16,384 characters).');
  }
  if (quoted) throw new Error('Unclosed CSV quote.');
  if (cell || row.length || closed) record();
  return records;
}

const holoMapping: ImportMapping = {
  dex: 0,
  list: 2,
  status: 3,
  cardId: 4,
  cardName: 5,
  set: 6,
  language: 7,
  finish: 8,
};
const aliases: Record<ImportField, string[]> = {
  cardId: ['catalog id', 'tcgdex id'],
  tcgplayerId: ['tcgplayer id', 'tcgplayer product id'],
  cardName: ['name', 'card name', 'title'],
  set: ['set', 'set name', 'expansion'],
  number: ['number', 'card number', 'collector number'],
  dex: ['dex number'],
  list: ['list'],
  language: ['language', 'lang'],
  finish: ['finish', 'printing'],
  quantity: ['quantity', 'qty', 'count'],
  condition: ['condition'],
  grade: ['grade', 'grading', 'graded'],
  productType: ['product type', 'category'],
  status: ['slot status'],
};
const aliasSets = Object.fromEntries(
  Object.entries(aliases).map(([field, names]) => [field, new Set(names)]),
) as Record<ImportField, Set<string>>;

export function parseImportFile(source: string): ImportDocument {
  if (new TextEncoder().encode(source).length > IMPORT_MAX_BYTES) throw new Error('Maximum file size is 10 MiB.');
  const text = source.replace(/^\uFEFF/, '');
  if (/^\s*[[{]/.test(text)) {
    let backup: unknown;
    try {
      backup = JSON.parse(text);
    } catch {
      throw new Error('Invalid JSON backup.');
    }
    const value = backup as { format?: unknown; version?: unknown; collection?: unknown } | null;
    if (!value || value.format !== 'holofolder-binder-backup') throw new Error('JSON must be a Holo Folder backup.');
    if (value.version !== 1) throw new Error('Unsupported backup version.');
    if (!Array.isArray(value.collection)) throw new Error('Backup collection must be an array.');
    const records: string[][] = [];
    const push = (raw: Record<string, unknown>, list: string, dex: unknown, status: unknown) => {
      const columns = [
        dex,
        '',
        list,
        status,
        raw.card_id,
        raw.card_name,
        raw.card_set,
        raw.card_language,
        raw.card_finish,
      ];
      if (columns.some((v) => v != null && typeof v !== 'string' && typeof v !== 'number'))
        throw new Error('Invalid backup card fields.');
      records.push(columns.map((v) => (v == null ? '' : String(v))));
    };
    for (const raw of value.collection) {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Invalid backup collection row.');
      const item = raw as Record<string, unknown>;
      if (item.status !== 'wishlisted') push(item, 'owned', item.pokemon_id, item.status ?? 'collected');
      if (item.wanted_cards != null && !Array.isArray(item.wanted_cards))
        throw new Error('Invalid backup wanted cards.');
      const wants = Array.isArray(item.wanted_cards) ? item.wanted_cards : [];
      if (item.status === 'wishlisted' && !wants.length) push(item, 'wanted', item.pokemon_id, 'wishlisted');
      for (const wanted of wants) {
        if (!wanted || typeof wanted !== 'object' || Array.isArray(wanted))
          throw new Error('Invalid backup wanted card.');
        push(wanted as Record<string, unknown>, 'wanted', item.pokemon_id, 'wishlisted');
      }
      if (records.length > 5000) throw new Error('Maximum 5,000 data rows.');
    }
    return { headers: [...COLLECTION_CSV_COLUMNS], records, mapping: { ...holoMapping }, trusted: true };
  }
  const [headers, ...records] = csvRecords(text);
  if (!headers?.length) throw new Error('The file is empty.');
  const keys = headers.map((h) => h.trim().toLowerCase().replaceAll('_', ' '));
  if (keys.some((key) => !key) || new Set(keys).size !== keys.length)
    throw new Error('CSV headers must be nonempty and unique.');
  if (records.some((row) => row.length !== headers.length))
    throw new Error('CSV rows must have the same number of columns as the headers.');
  const trusted = headers.join(',') === COLLECTION_CSV_COLUMNS.join(',');
  const mapping: ImportMapping = trusted ? { ...holoMapping } : {};
  if (!trusted)
    for (const field of IMPORT_FIELDS) {
      const index = keys.findIndex((key) => aliasSets[field].has(key));
      if (index >= 0) mapping[field] = index;
    }
  return { headers, records, mapping, trusted };
}

export function importItem(
  lookup: ImportLookup,
  pokemonId: number,
  card: { card_id?: string; card_name?: string; card_set?: string; card_image?: string },
  status = 'collected',
) {
  const pokemon = getPokemonById(pokemonId);
  if (!pokemon) throw new Error('Unknown National Dex number.');
  return normalizeCollectionItem({
    pokemon_id: pokemonId,
    pokemon_name: pokemon.name,
    status: lookup.list === 'wanted' ? 'wishlisted' : isSlotStatus(status) ? status : 'collected',
    ...(lookup.list === 'owned'
      ? { ...card, card_language: lookup.language, card_finish: lookup.finish }
      : {
          wanted_cards: card.card_id
            ? [
                {
                  ...card,
                  card_id: card.card_id,
                  card_name: card.card_name || card.card_id,
                  card_language: lookup.language,
                  card_finish: lookup.finish,
                  added_at: new Date().toISOString(),
                },
              ]
            : [],
        }),
  });
}

export function mapImportRows(document: ImportDocument, mapping: ImportMapping, defaults: ImportDefaults): ImportRow[] {
  return document.records.map((cells, index) => {
    const get = (field: ImportField) => (mapping[field] === undefined ? '' : (cells[mapping[field]!] ?? '').trim());
    const language = get('language').toLowerCase() || defaults.language;
    const finish = get('finish').toLowerCase().replaceAll(' ', '_') || defaults.finish;
    const list = get('list').toLowerCase() || defaults.list;
    const lookup: ImportLookup = {
      ...defaults,
      cardId: get('cardId') || undefined,
      tcgplayerId: get('tcgplayerId') || undefined,
      cardName: get('cardName') || undefined,
      set: get('set') || undefined,
      number: get('number') || undefined,
    };
    const row: ImportRow = { row: index + 2, cells, lookup };
    if (!isCardLanguage(language)) row.problem = 'Unsupported language. Map a supported language code.';
    else if (!isCardFinish(finish)) row.problem = 'Unsupported finish. Map a supported finish code.';
    else if (list !== 'owned' && list !== 'wanted') row.problem = 'List must be owned or wanted.';
    else {
      lookup.language = language;
      lookup.finish = finish;
      lookup.list = list;
    }
    if (get('quantity') && Number(get('quantity')) !== 1)
      row.problem = 'Quantity other than one is unsupported in the Dex binder.';
    if (get('condition') || get('grade')) row.problem = 'Condition and grading cannot be stored in the Dex binder.';
    if (get('productType') && !/^(pokemon|pokémon|single|singles|card)$/i.test(get('productType')))
      row.problem = 'Unsupported product type (only Pokémon singles).';
    if (get('status') && !isSlotStatus(get('status'))) row.problem = 'Unsupported slot status.';
    if (lookup.list === 'owned' && get('status') === 'wishlisted') row.problem = 'Owned row has a wanted-only status.';
    if (Object.values(lookup).some((value) => typeof value === 'string' && value.length > 240))
      row.problem = 'Card identity fields must be at most 240 characters.';
    if (!row.problem && document.trusted) {
      try {
        if (lookup.list === 'wanted' && !lookup.cardId) throw new Error('Wanted row has no card ID.');
        row.item = importItem(
          lookup,
          Number(get('dex')),
          { card_id: lookup.cardId, card_name: lookup.cardName, card_set: lookup.set },
          get('status'),
        );
      } catch (error) {
        row.problem = error instanceof Error ? error.message : 'Invalid card.';
      }
    }
    return row;
  });
}

function printing(item: { card_id?: string; card_language?: string; card_finish?: string }) {
  return JSON.stringify([item.card_id ?? null, item.card_language ?? 'en', item.card_finish ?? 'normal']);
}
function weight(item: CollectedPokemon | null) {
  return item ? savedCardWeight(item) : 0;
}

export function buildImportPlan(
  source: ImportRow[],
  collection: CollectedPokemon[],
  selection?: Set<number>,
  blocked = new Set<number>(),
) {
  const existing = new Map(collection.map((item) => [item.pokemon_id, item]));
  const next = new Map<number, CollectedPokemon>();
  const choices = new Map<number, Set<string>>();
  const selectedChoices = new Map<number, Set<string>>();
  for (const row of source) {
    if (!row.item || row.problem || row.lookup.list !== 'owned') continue;
    const id = row.item.pokemon_id;
    const current = existing.get(id);
    if (current?.status !== 'wishlisted' && current?.card_id) continue;
    const keys = choices.get(id) ?? new Set<string>();
    keys.add(printing(row.item));
    choices.set(id, keys);
    if (selection?.has(row.row)) {
      const selected = selectedChoices.get(id) ?? new Set<string>();
      selected.add(printing(row.item));
      selectedChoices.set(id, selected);
    }
  }
  const rows: PlannedImportRow[] = source.map((row) => {
    const result: PlannedImportRow = { ...row, outcome: 'ready', reason: 'Ready to add', selected: false };
    const reject = (outcome: PlannedImportRow['outcome'], reason: string) => ({ ...result, outcome, reason });
    if (row.problem) return reject('unsupported', row.problem);
    if (!row.item) return reject('unresolved', 'Resolve an exact catalogue match first.');
    const id = row.item.pokemon_id;
    if (blocked.has(id)) return reject('conflict', 'This Pokémon has unsynced edits. Sync it before importing.');
    const current = next.get(id) ?? existing.get(id);
    const owned = row.lookup.list === 'owned';
    const candidate = row.item;
    if (owned && current?.status !== 'wishlisted' && current?.card_id && printing(current) !== printing(candidate))
      return reject('conflict', 'Existing owned selection preserved.');
    if (owned && (choices.get(id)?.size ?? 0) > 1) {
      const selectedKeys = selectedChoices.get(id) ?? new Set<string>();
      if (selectedKeys.size !== 1 || !selectedKeys.has(printing(candidate)))
        return reject('choice', 'Choose exactly one owned printing for this Pokémon.');
    }
    if (selection && !selection.has(row.row)) return { ...result, reason: 'Not selected' };
    const merged = normalizeCollectionItem({
      ...(current ?? candidate),
      ...(owned
        ? {
            card_id: candidate.card_id,
            card_name: candidate.card_name,
            card_image: candidate.card_image,
            card_set: candidate.card_set,
            card_language: candidate.card_language,
            card_finish: candidate.card_finish,
            status: current && current.status !== 'wishlisted' ? current.status : candidate.status,
          }
        : {}),
      wanted_cards: [...(current?.wanted_cards ?? []), ...candidate.wanted_cards],
    });
    if (collectionFingerprint(current) === collectionFingerprint(merged))
      return reject('duplicate', 'Already present (no change).');
    next.set(id, merged);
    return { ...result, selected: true };
  });
  const operations = Array.from(next.values()).flatMap((item) => {
    const base = existing.get(item.pokemon_id);
    return collectionFingerprint(item) === collectionFingerprint(base) ? [] : [{ next: item, base: base ?? null }];
  });
  return { rows, operations, delta: operations.reduce((sum, op) => sum + weight(op.next) - weight(op.base), 0) };
}

export function buildImportReport(rows: Array<ImportRow & { outcome?: string; reason?: string }>) {
  return (
    [
      ['source_row', 'outcome', 'reason', 'original_cells_json'],
      ...rows.map((row) => [
        row.row,
        row.outcome ?? 'unresolved',
        row.reason ?? row.problem ?? '',
        JSON.stringify(row.cells),
      ]),
    ]
      .map((row) => row.map(toCsvField).join(','))
      .join('\r\n') + '\r\n'
  );
}

export async function applyImportPlan(
  plan: ReturnType<typeof buildImportPlan>,
  save: (item: CollectedPokemon, base: CollectedPokemon | null) => Promise<{ error?: string; queued?: boolean }>,
  signal: AbortSignal,
  onProgress: (result: {
    rows: Array<ImportRow & { outcome: string; reason: string }>;
    saved: number;
    queued: number;
    failed: number;
  }) => void = () => {},
) {
  let rows = plan.rows.map((row) => ({
    ...row,
    outcome: row.selected ? 'not applied' : row.outcome,
    reason: row.selected ? 'Not applied yet' : row.reason,
  }));
  let saved = 0,
    queued = 0,
    failed = 0;
  for (const operation of plan.operations) {
    if (signal.aborted) break;
    let result: { error?: string; queued?: boolean };
    try {
      result = await save(operation.next, operation.base);
    } catch (error) {
      result = { error: error instanceof Error ? error.message : 'Write failed. Check your binder before retrying.' };
    }
    const outcome = result.error ? 'failed' : result.queued ? 'queued' : 'saved';
    if (result.error) failed++;
    else if (result.queued) queued++;
    else saved++;
    rows = rows.map((row) =>
      row.selected && row.item?.pokemon_id === operation.next.pokemon_id
        ? {
            ...row,
            outcome,
            reason:
              result.error ??
              (result.queued ? 'Saved on this device, awaiting sync and conflict checks.' : 'Saved to your account.'),
          }
        : row,
    );
    onProgress({ rows, saved, queued, failed });
    if (result.error) break;
  }
  return { rows, saved, queued, failed, cancelled: signal.aborted };
}
