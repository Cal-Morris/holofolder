// Which card languages a binder shows in its "All <Pokémon> cards" sheet, and the language words the sheet's
// search understands ("jpn", "eng"...). Pure: safe on the server and the client.
import { CARD_LANGUAGES, isCardLanguage, type CardLanguage } from '@/lib/domain/cards';

/** A binder with no saved choice shows English printings only. */
export const DEFAULT_BINDER_CARD_LANGUAGES: readonly CardLanguage[] = ['en'];

/** TCGdex keys that are spelled differently from our language ids. */
const TCGDEX_LANGUAGE_ALIASES: Record<string, CardLanguage> = { pt: 'pt-br' };

/** Languages a printing exists in, from the keys of its TCGdex `name_json` (unknown ones like `th` are dropped). */
export function cardLanguagesFromNames(names: unknown): CardLanguage[] {
  if (!names || typeof names !== 'object' || Array.isArray(names)) return [];
  const found = new Set<CardLanguage>();
  for (const [key, value] of Object.entries(names)) {
    if (typeof value !== 'string' || !value.trim()) continue;
    const language = TCGDEX_LANGUAGE_ALIASES[key] ?? key;
    if (isCardLanguage(language)) found.add(language);
  }
  return CARD_LANGUAGES.filter((language) => found.has(language));
}

/** A card search's language: one language, or `any` for every printing in the language it was printed in. */
export type CardSearchLanguage = CardLanguage | 'any';

/** The language a printing is saved in when searching any language: English when it has an English print. */
export function primaryCardLanguage(names: unknown): CardLanguage | undefined {
  const languages = cardLanguagesFromNames(names);
  return languages.includes('en') ? 'en' : languages[0];
}

/** A binder's saved languages in canonical order; null when nothing valid is saved (use the default). */
export function normalizeBinderCardLanguages(value: unknown): CardLanguage[] | null {
  if (!Array.isArray(value)) return null;
  const chosen = new Set(value.filter(isCardLanguage));
  const languages = CARD_LANGUAGES.filter((language) => chosen.has(language));
  return languages.length > 0 ? languages : null;
}

// Two-letter codes that are also everyday words or set ids (it, de, es...) are left out on purpose.
const LANGUAGE_WORDS: Record<string, CardLanguage> = {
  en: 'en',
  eng: 'en',
  english: 'en',
  ja: 'ja',
  jp: 'ja',
  jpn: 'ja',
  japanese: 'ja',
  ko: 'ko',
  kr: 'ko',
  kor: 'ko',
  korean: 'ko',
  fra: 'fr',
  fre: 'fr',
  french: 'fr',
  deu: 'de',
  ger: 'de',
  german: 'de',
  spa: 'es',
  spanish: 'es',
  ita: 'it',
  italian: 'it',
  por: 'pt-br',
  portuguese: 'pt-br',
};

/** Splits language words out of a search ("jpn 151" → languages [ja], text "151"). */
export function parseLanguageSearch(query: string): { text: string; languages: CardLanguage[] } {
  const languages = new Set<CardLanguage>();
  const rest: string[] = [];
  for (const word of query.trim().split(/\s+/)) {
    const language = LANGUAGE_WORDS[word.toLowerCase()];
    if (language) languages.add(language);
    else if (word) rest.push(word);
  }
  return { text: rest.join(' '), languages: [...languages] };
}

/** True when a printing exists in any of the languages. Printings with unknown languages always match. */
export function cardMatchesLanguages(
  card: { languages?: readonly CardLanguage[] },
  languages: readonly CardLanguage[],
) {
  if (!card.languages || card.languages.length === 0) return true;
  return card.languages.some((language) => languages.includes(language));
}
