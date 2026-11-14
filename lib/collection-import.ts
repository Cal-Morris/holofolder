import { COLLECTION_CSV_COLUMNS } from '@/lib/collection-export';
import { isCardFinish, isCardLanguage, type CardLanguage, type CardFinish } from '@/lib/domain/cards';
import type { GradingRecord } from '@/lib/domain/inventory';

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

/** Where a file came from, read from its exact header row. Anything else uses the generic column names above. */
export type ImportSource = 'holofolder' | 'collectr' | 'tcgcollector' | 'pricecharting' | 'generic';
export const IMPORT_SOURCE_NAMES: Record<ImportSource, string> = {
  holofolder: 'Holo Folder',
  collectr: 'Collectr',
  tcgcollector: 'TCG Collector',
  pricecharting: 'PriceCharting',
  generic: 'a spreadsheet',
};
/** One file row, ready to look up. A row with a problem stays in the review list and is never imported. */
export interface ImportRow {
  /** Line number in the file, counting the header as line 1. */
  row: number;
  label: string;
  quantity: number;
  lookup: ImportLookup | null;
  grading: GradingRecord | null;
  problem: string | null;
  /** Columns with a value that Holo Folder doesn't keep (condition, price paid, notes). */
  dropped: string[];
}

const SOURCE_HEADERS: [Exclude<ImportSource, 'holofolder' | 'generic'>, string[]][] = [
  ['collectr', ['portfolio name', 'category', 'set', 'product name', 'card number', 'variance', 'grade', 'quantity']],
  ['tcgcollector', ['expansion', 'card number', 'card name', 'card variant', 'card language', 'quantity']],
  ['pricecharting', ['id', 'product-name', 'console-name', 'include-string', 'condition-string', 'quantity']],
];
const LANGUAGE_NAMES: Record<string, CardLanguage> = {
  english: 'en',
  french: 'fr',
  german: 'de',
  spanish: 'es',
  italian: 'it',
  portuguese: 'pt-br',
  'brazilian portuguese': 'pt-br',
  japanese: 'ja',
  korean: 'ko',
};
const GRADERS: Record<string, GradingRecord['provider']> = {
  psa: { kind: 'known', id: 'psa' },
  cgc: { kind: 'known', id: 'cgc' },
  bgs: { kind: 'known', id: 'beckett' },
  beckett: { kind: 'known', id: 'beckett' },
  ace: { kind: 'known', id: 'ace' },
};

/** "PSA 10.0" → PSA 10. Anything that isn't "<grader> <grade>" is not a grade we can record. */
export function parseImportGrade(text: string, certificate = ''): GradingRecord | null | undefined {
  const value = text.trim();
  if (!value || /^(ungraded|raw|none)$/i.test(value)) return null;
  const match = /^([a-z]{2,10})\s+(\d{1,2}(?:\.\d)?)$/i.exec(value);
  if (!match) return undefined;
  const id = match[1].toLowerCase();
  return {
    provider: GRADERS[id] ?? { kind: 'custom', name: match[1].toUpperCase() },
    grade: match[2].replace(/\.0$/, ''),
    scale: null,
    designation: null,
    subgrades: [],
    certificate: certificate.trim() || null,
    holder: null,
    label: { variant: null, assetIds: [] },
  };
}

/** Competitor print names → our finish. A print we don't track separately is a problem, never folded into another. */
function readFinish(variant: string): { finish: CardFinish } | { problem: string } {
  const v = variant.trim().toLowerCase();
  if (isCardFinish(v)) return { finish: v };
  if (/1st edition|first edition|shadowless/.test(v))
    return { problem: `${variant.trim()} prints aren't tracked separately yet. Add this card by hand.` };
  if (/poke ?ball|master ?ball|cosmos|cracked ice|stamp|staff/.test(v))
    return { problem: `${variant.trim()} isn't tracked as its own print yet. Add this card by hand.` };
  if (/reverse/.test(v)) return { finish: 'reverse_holo' };
  if (/holo/.test(v)) return { finish: 'holo' };
  if (!v || /^(normal|non-holo|unlimited|promo)$/.test(v)) return { finish: 'normal' };
  return { problem: `Unknown print "${variant.trim()}". Add this card by hand.` };
}

function readLanguage(value: string, fallback: CardLanguage): CardLanguage | null {
  const v = value.trim().toLowerCase();
  if (!v) return fallback;
  return isCardLanguage(v) ? v : (LANGUAGE_NAMES[v] ?? null);
}

export function detectImportSource(document: ImportDocument): ImportSource {
  if (document.trusted) return 'holofolder';
  const keys = new Set(document.headers.map((h) => h.trim().toLowerCase()));
  for (const [source, headers] of SOURCE_HEADERS) if (headers.every((h) => keys.has(h))) return source;
  return 'generic';
}

/** Every file row as a lookup plus what it says about quantity, grading and columns we don't keep. */
export function readImportRows(document: ImportDocument): { source: ImportSource; rows: ImportRow[] } {
  const source = detectImportSource(document);
  const columns = new Map(document.headers.map((h, i) => [h.trim().toLowerCase(), i]));
  const rows = document.records.map((cells, index): ImportRow => {
    const cell = (header: string) => (cells[columns.get(header) ?? -1] ?? '').trim();
    const mapped = (field: ImportField) => {
      const column = document.mapping[field];
      return column === undefined ? '' : (cells[column] ?? '').trim();
    };
    let name = '',
      set = '',
      number = '',
      variant = '',
      language: CardLanguage | null = 'en',
      quantityText = '1',
      grade: GradingRecord | null | undefined = null,
      wanted = false,
      problem: string | null = null;
    const dropped: string[] = [];
    const drop = (label: string, value: string, ignore?: RegExp) => {
      if (value && !(ignore && ignore.test(value))) dropped.push(label);
    };
    if (source === 'collectr') {
      const category = cell('category');
      if (category && !/^pok[eé]mon/i.test(category)) problem = `${category} isn't a Pokémon card.`;
      name = cell('product name');
      if (/\(jp\)/i.test(name)) {
        language = 'ja';
        name = name.replace(/\s*\(jp\)\s*/i, ' ').trim();
      }
      set = cell('set');
      number = cell('card number');
      variant = cell('variance');
      quantityText = cell('quantity') || '1';
      grade = parseImportGrade(cell('grade'));
      wanted = /^true$/i.test(cell('watchlist'));
      drop('condition', cell('card condition'));
      drop('price paid', cell('average cost paid'), /^0*(\.0*)?$/);
      drop('notes', cell('notes'));
    } else if (source === 'tcgcollector') {
      name = cell('card name');
      set = cell('expansion');
      number = cell('card number');
      variant = cell('card variant');
      language = readLanguage(cell('card language'), 'en');
      quantityText = cell('quantity') || '1';
      drop('condition', cell('card condition'));
      drop('notes', cell('note'));
    } else if (source === 'pricecharting') {
      const product = /^(.*?)\s*(?:\[([^\]]+)\])?\s*#\s*(\S+)$/.exec(cell('product-name'));
      if (product) [, name, variant = '', number] = product;
      else name = cell('product-name');
      set = cell('console-name').replace(/^pok[eé]mon\s+/i, '');
      if (/^japanese\s+/i.test(set)) {
        language = 'ja';
        set = set.replace(/^japanese\s+/i, '');
      } else if (/^(chinese|korean|german|french|spanish|italian)\s+/i.test(set))
        language = LANGUAGE_NAMES[set.split(/\s+/)[0].toLowerCase()] ?? null;
      quantityText = cell('quantity') || '1';
      grade = parseImportGrade(cell('include-string'), cell('grading-cert-id'));
      drop('condition', cell('condition-string'));
      drop('price paid', cell('cost-basis-in-pennies'), /^0*$/);
      drop('notes', cell('notes'));
    } else {
      name = mapped('cardName');
      set = mapped('set');
      number = mapped('number');
      variant = mapped('finish');
      language = readLanguage(mapped('language'), 'en');
      quantityText = mapped('quantity') || '1';
      grade = parseImportGrade(mapped('grade'));
      wanted = /^want/i.test(mapped('list')) || mapped('status') === 'wishlisted';
      drop('condition', mapped('condition'));
      const type = mapped('productType');
      if (type && !/^(pok[eé]mon|trainer|energy|singles?|cards?)$/i.test(type))
        problem = `${type} isn't a single card.`;
    }
    const cardId = source === 'holofolder' || source === 'generic' ? mapped('cardId') : '';
    const tcgplayerId = source === 'holofolder' || source === 'generic' ? mapped('tcgplayerId') : '';
    const label = [name || cardId || tcgplayerId || 'Unnamed row', [set, number].filter(Boolean).join(' ')]
      .filter(Boolean)
      .join(' · ');
    const quantity = /^\d{1,4}$/.test(quantityText) ? Number(quantityText) : NaN;
    const finish = readFinish(variant);
    problem ??= wanted
      ? 'Wanted and watchlist cards aren’t imported. Add them to your wanted list in Holo Folder.'
      : !cardId && !tcgplayerId && !(name && set && number)
        ? 'Needs a card name, set and number (sealed products and lots can’t be imported).'
        : !Number.isSafeInteger(quantity) || quantity < 1
          ? 'Quantity must be a whole number of at least 1.'
          : language === null
            ? 'This card’s language isn’t one Holo Folder tracks.'
            : grade === undefined
              ? 'This grade isn’t in a form Holo Folder can record (for example PSA 10).'
              : 'problem' in finish
                ? finish.problem
                : null;
    const lookup: ImportLookup | null =
      problem || language === null || 'problem' in finish
        ? null
        : {
            language,
            finish: finish.finish,
            list: 'owned',
            ...(cardId ? { cardId } : tcgplayerId ? { tcgplayerId } : { cardName: name, set, number }),
          };
    return {
      row: index + 2,
      label,
      quantity: Number.isSafeInteger(quantity) && quantity > 0 ? quantity : 0,
      lookup,
      grading: grade ?? null,
      problem,
      dropped,
    };
  });
  return { source, rows };
}
