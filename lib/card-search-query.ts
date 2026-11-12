import { POKEMON_CATALOG } from '@/lib/pokemon-catalog';
import { getEditDistance } from '@/lib/pokemon-search-state';
import { parseCardSearchQuery, sanitizeSearchText } from '@/lib/pokemon-card-browse';
import { resolveSetSearchAlias } from '@/lib/set-search-aliases';

type SearchSet = { id: string; name: string };

/** Candidate set phrases, before bare numbers are interpreted as collector numbers. */
export function cardSearchSetCandidates(raw: string) {
  if (parseCardSearchQuery(raw).cardId) return [];
  const words = sanitizeSearchText(raw).toLowerCase().split(' ').filter(Boolean);
  if (words.length < 2) return [];
  const candidates: Array<{ phrase: string; remainder: string }> = [];
  for (let start = 0; start < words.length; start++) {
    for (let end = start + 1; end <= words.length; end++) {
      const phrase = words.slice(start, end).join(' ');
      // Explicit collector syntax must never become a set constraint.
      if (/[#/]/.test(phrase)) continue;
      const remainder = [...words.slice(0, start), ...words.slice(end)].join(' ');
      const code = resolveSetSearchAlias(phrase);
      // "MEW" is 151's printed code and a Pokémon: "mew 001" and "pikachu mew" mean the set, "mew ex" and "mew 30th" don't.
      const isCode = code !== phrase;
      const pokemonFirst =
        isCode &&
        isPokemonName(phrase) &&
        !/^#?\d{1,4}[a-z]?$/.test(remainder) &&
        !isPokemonText(parseCardSearchQuery(remainder).text);
      if (!pokemonFirst) candidates.push({ phrase: code, remainder });
      if (isCode) candidates.push({ phrase, remainder });
    }
  }
  return candidates.sort((a, b) => b.phrase.length - a.phrase.length);
}

/** Unique nearest full Pokémon name only; never correct a valid name or name fragment. */
function pokemonCorrection(text: string) {
  if (!/^[a-z]{4,}$/.test(text)) return null;
  if (POKEMON_CATALOG.some((pokemon) => pokemon.name.includes(text))) return null;
  const max = text.length >= 5 ? 2 : 1;
  const ranked = POKEMON_CATALOG.map((pokemon) => ({
    name: pokemon.name,
    distance: getEditDistance(text, pokemon.name, max),
  }))
    .filter((pokemon) => pokemon.distance <= max)
    .sort((a, b) => a.distance - b.distance);
  return ranked[0] && ranked[0].distance !== ranked[1]?.distance ? ranked[0].name : null;
}

function isPokemonName(text: string) {
  return POKEMON_CATALOG.some((pokemon) => pokemon.name === text);
}

function isPokemonText(text: string) {
  return isPokemonName(text) || Boolean(pokemonCorrection(text));
}

function partialSetMatch(name: string, phrase: string) {
  // Whole word prefixes, at least three letters each; never arbitrary substrings or fuzzy set names.
  const words = phrase.split(' ');
  if (!words.every((word) => /^[a-z]{3,}$/.test(word))) return false;
  const nameWords = name.toLowerCase().split(/[^a-z0-9]+/);
  return nameWords.some((_, start) => words.every((word, index) => nameWords[start + index]?.startsWith(word)));
}

/** Exact catalog names/codes win; partial set phrases require a recognizable Pokémon remainder. */
export function resolveCardSearchQuery(raw: string, sets: SearchSet[]) {
  const candidates = cardSearchSetCandidates(raw);
  for (const partial of [false, true]) {
    for (const candidate of candidates) {
      const parsed = parseCardSearchQuery(candidate.remainder);
      if (partial && !isPokemonText(parsed.text)) continue;
      const matches = sets.filter((set) =>
        partial
          ? partialSetMatch(set.name, candidate.phrase)
          : set.id.toLowerCase() === candidate.phrase || set.name.toLowerCase() === candidate.phrase,
      );
      if (matches.length) {
        const numberOnly = /^#?(\d{1,4}[a-z]?)$/.exec(candidate.remainder);
        return {
          ...parsed,
          ...(numberOnly ? { text: '', number: numberOnly[1] } : {}),
          setIds: matches.map((set) => set.id),
        };
      }
    }
  }
  return { ...parseCardSearchQuery(raw), setIds: [] as string[] };
}

/** Retry only after literal results are empty, and only with a catalog-backed set constraint. */
export function correctedCardSearchQuery(raw: string, sets: SearchSet[]) {
  const parsed = resolveCardSearchQuery(raw, sets);
  if (!parsed.setIds.length || parsed.cardId) return null;
  const name = pokemonCorrection(parsed.text);
  if (!name) return null;
  return sanitizeSearchText(raw)
    .toLowerCase()
    .replace(new RegExp(`\\b${parsed.text}\\b`), name);
}
