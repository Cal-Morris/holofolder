import { COLLECTION_CSV_COLUMNS } from '@/lib/collection-export';
import { normalizeCollectionItem } from '@/lib/collection/normalize';
import { isSlotStatus, type CardLanguage, type CardFinish } from '@/lib/domain/cards';
import { getPokemonById } from '@/lib/pokemon-catalog';

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
