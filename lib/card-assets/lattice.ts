/**
 * Card Lattice (https://cardlattice.com, data at https://github.com/cardlattice/cardlattice-data) publishes a CC0
 * catalogue of Pokémon TCG printings in several languages and regions. It has no images and its own ids, so we match
 * its sets to ours by printed set code, then by name, and its printings by collector number.
 */
import { normalizeCollectorNumber } from './malie';

export const LATTICE_DATA_BASE = 'https://status.cardlattice.com/data/';

export interface LatticeManifest {
  sourceCommit: string;
  filename: string;
  sha256: string;
  byteSize: number;
}

export interface LatticeSet {
  id: string;
  name: string;
  codes: Array<{ language: string; code: string }>;
}

export interface LatticePrinting {
  id: string;
  setId: string;
  /** Our (TCGdex) language code: `zh-Hans` becomes `zh-cn`. */
  language: string;
  collectorNumber: string;
  name: string;
  illustrators: string[];
}

export interface OurSet {
  id: string;
  names: Record<string, string>;
}

export interface OurCard {
  id: string;
  setId: string;
  localId: string;
  names: Record<string, string>;
  illustrator: string | null;
}

const LANGUAGES: Record<string, string> = { 'zh-Hans': 'zh-cn', 'zh-Hant': 'zh-tw' };
const toOurLanguage = (language: string) => LANGUAGES[language] ?? language;

const str = (value: unknown) => (typeof value === 'string' ? value : '');

export function parseLatticeManifest(value: unknown): LatticeManifest {
  const manifest = (value ?? {}) as Record<string, unknown>;
  const parsed = {
    sourceCommit: str(manifest.sourceCommit),
    filename: str(manifest.filename),
    sha256: str(manifest.sha256),
    byteSize: Number(manifest.byteSize),
  };
  if (!/^catalogue-[a-f0-9]{64}\.json$/.test(parsed.filename) || !/^[a-f0-9]{64}$/.test(parsed.sha256))
    throw new Error('Card Lattice manifest: unexpected filename or checksum');
  return parsed;
}

/** The compiled catalogue: `{ records: [{ id, metadata: { kind, … } }] }`. Only sets and printings matter here. */
export function parseLatticeCatalogue(value: unknown) {
  const records = (value as { records?: unknown })?.records;
  if (!Array.isArray(records)) throw new Error('Card Lattice catalogue: expected records');
  const sets: LatticeSet[] = [];
  const printings: LatticePrinting[] = [];
  for (const record of records as Array<{ id?: unknown; metadata?: Record<string, unknown> }>) {
    const meta = record.metadata ?? {};
    const attributes = (meta.attributes ?? {}) as Record<string, unknown>;
    if (meta.kind === 'set') {
      const identifiers = Array.isArray(attributes.printedIdentifiers) ? attributes.printedIdentifiers : [];
      sets.push({
        id: str(record.id),
        name: str(meta.name),
        codes: identifiers.flatMap((entry: Record<string, unknown>) =>
          str(entry.code) ? [{ language: toOurLanguage(str(entry.language)), code: str(entry.code) }] : [],
        ),
      });
    } else if (meta.kind === 'printing') {
      printings.push({
        id: str(record.id),
        setId: str(meta.setId),
        language: toOurLanguage(str(meta.language)),
        collectorNumber: str(meta.collectorNumber),
        name: str(meta.name),
        illustrators: Array.isArray(attributes.illustrators) ? attributes.illustrators.flatMap((name) => (name ? [String(name)] : [])) : [],
      });
    }
  }
  return { sets, printings };
}

/** `SM3+` is `SM3p` in TCGdex; ids compare case-insensitively. */
const normalizeCode = (code: string) => code.toLowerCase().replace(/\+/g, 'p').replace(/\s+/g, '');
/** Letters and digits in any script, so Japanese, Korean and Chinese names compare too. */
const normalizeName = (name: string) =>
  name
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '');

/**
 * Our set for a Card Lattice set in one language. A printed code wins when our set with that id has the language
 * (Japanese `XY5` must not land on the English `xy5`); otherwise the name, in that language or English. Card Lattice
 * names English expansions `Mega Evolution—Ascended Heroes` where TCGdex says `Ascended Heroes`.
 */
export function matchSet(set: LatticeSet, language: string, ours: readonly OurSet[]): OurSet | null {
  const hasLanguage = (candidate: OurSet) => Boolean(candidate.names[language]);
  const byCode = new Map<string, OurSet>();
  for (const candidate of ours) if (hasLanguage(candidate)) byCode.set(normalizeCode(candidate.id), candidate);
  // The code printed for this language first, then the others.
  const codes = set.codes.toSorted((a, b) => Number(b.language === language) - Number(a.language === language));
  for (const { code } of codes) {
    const hit = byCode.get(normalizeCode(code));
    if (hit) return hit;
  }
  const wanted = new Set([set.name, set.name.split('—').pop() ?? ''].map(normalizeName).filter(Boolean));
  const byName = ours.filter((candidate) =>
    [candidate.names[language], candidate.names.en].some((name) => name && wanted.has(normalizeName(name))),
  );
  return byName.find(hasLanguage) ?? null;
}

export function compareWithLattice(
  lattice: ReturnType<typeof parseLatticeCatalogue>,
  ourSets: readonly OurSet[],
  ourCards: readonly OurCard[],
) {
  const latticeSets = new Map(lattice.sets.map((set) => [set.id, set]));
  const cardsBySet = new Map<string, OurCard[]>();
  for (const card of ourCards) cardsBySet.set(card.setId, [...(cardsBySet.get(card.setId) ?? []), card]);

  // Group printings by Card Lattice set and language, then match each group to one of our sets.
  const groups = new Map<string, LatticePrinting[]>();
  for (const printing of lattice.printings) {
    const key = `${printing.setId}\u0000${printing.language}`;
    groups.set(key, [...(groups.get(key) ?? []), printing]);
  }

  const missingSets: Array<{ latticeSetId: string; name: string; language: string; codes: string[]; printings: number }> =
    [];
  const missingCards: Array<{ setId: string; latticeId: string; language: string; number: string; name: string }> = [];
  const missingLanguage: Array<{ cardId: string; latticeId: string; language: string; name: string }> = [];
  const missingIllustrator: Array<{ cardId: string; latticeId: string; illustrators: string[] }> = [];
  // The other direction: what we hold that Card Lattice doesn't.
  const notInLattice: Array<{ setId: string; language: string; numbers: string[] }> = [];
  const illustratorNotInLattice: Array<{ setId: string; language: string; latticeId: string; cardId: string; illustrator: string }> =
    [];
  const matched = new Set<string>();

  for (const printings of groups.values()) {
    const { setId: latticeSetId, language } = printings[0];
    const latticeSet = latticeSets.get(latticeSetId) ?? { id: latticeSetId, name: latticeSetId, codes: [] };
    const ours = matchSet(latticeSet, language, ourSets);
    if (!ours) {
      missingSets.push({
        latticeSetId,
        name: latticeSet.name,
        language,
        codes: latticeSet.codes.map((entry) => entry.code),
        printings: printings.length,
      });
      continue;
    }
    matched.add(`${ours.id}\u0000${language}`);
    const cards = new Map((cardsBySet.get(ours.id) ?? []).map((card) => [normalizeCollectorNumber(card.localId), card]));
    const seen = new Set<string>();
    for (const printing of printings) {
      const number = normalizeCollectorNumber(printing.collectorNumber);
      seen.add(number);
      const card = cards.get(number);
      if (!card) {
        missingCards.push({ setId: ours.id, latticeId: printing.id, language, number: printing.collectorNumber, name: printing.name });
        continue;
      }
      if (!card.names[language])
        missingLanguage.push({ cardId: card.id, latticeId: printing.id, language, name: printing.name });
      if (!card.illustrator && printing.illustrators.length)
        missingIllustrator.push({ cardId: card.id, latticeId: printing.id, illustrators: printing.illustrators });
      if (card.illustrator && !printing.illustrators.length)
        illustratorNotInLattice.push({ setId: ours.id, language, latticeId: printing.id, cardId: card.id, illustrator: card.illustrator });
    }
    const extra = [...cards].flatMap(([number, card]) =>
      !seen.has(number) && card.names[language] ? [card.localId] : [],
    );
    if (extra.length) notInLattice.push({ setId: ours.id, language, numbers: extra });
  }

  // Our sets, per language we hold names in, that no Card Lattice set matched.
  const setsNotInLattice: Array<{ setId: string; name: string; language: string; cards: number }> = [];
  for (const set of ourSets) {
    for (const [language, name] of Object.entries(set.names)) {
      if (matched.has(`${set.id}\u0000${language}`)) continue;
      const cards = (cardsBySet.get(set.id) ?? []).filter((card) => card.names[language]).length;
      if (cards) setsNotInLattice.push({ setId: set.id, name, language, cards });
    }
  }

  return {
    missingSets,
    missingCards,
    missingLanguage,
    missingIllustrator,
    notInLattice,
    setsNotInLattice,
    illustratorNotInLattice,
  };
}
