import catalog from './pokemon-catalog.json';
import { getOfficialArtworkUrl } from '@/lib/pokemon-artwork';

export interface PokemonEntry {
  id: number;
  name: string;
}

export const POKEMON_CATALOG: PokemonEntry[] = catalog as PokemonEntry[];

const POKEMON_BY_ID = new Map<number, PokemonEntry>(POKEMON_CATALOG.map((entry) => [entry.id, entry]));

const DISPLAY_NAME_OVERRIDES: Record<string, string> = {
  'chien-pao': 'Chien-Pao',
  'chi-yu': 'Chi-Yu',
  'hakamo-o': 'Hakamo-o',
  'ho-oh': 'Ho-Oh',
  'jangmo-o': 'Jangmo-o',
  'kommo-o': 'Kommo-o',
  'mime-jr': 'Mime Jr.',
  'mr-mime': 'Mr. Mime',
  'mr-rime': 'Mr. Rime',
  'nidoran-f': 'Nidoran♀',
  'nidoran-m': 'Nidoran♂',
  'porygon-z': 'Porygon-Z',
  'ting-lu': 'Ting-Lu',
  'type-null': 'Type: Null',
  'wo-chien': 'Wo-Chien',
};

const DEFAULT_FORM_SUFFIXES = [
  'altered',
  'amped',
  'aria',
  'average',
  'baile',
  'curly',
  'disguised',
  'family-of-four',
  'full-belly',
  'green-plumage',
  'ice',
  'incarnate',
  'land',
  'male',
  'midday',
  'normal',
  'ordinary',
  'plant',
  'red-meteor',
  'red-striped',
  'shield',
  'single-strike',
  'solo',
  'standard',
  'two-segment',
  'zero',
  '50',
];

function titleCasePokemonName(name: string) {
  return name
    .split('-')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

/** National Dex number as shown in the app, e.g. #0025. */
export function formatDexNumber(id: number) {
  return `#${String(id).padStart(4, '0')}`;
}

export function formatPokemonDisplayName(name: string) {
  const lowerName = name.toLowerCase();
  const override = DISPLAY_NAME_OVERRIDES[lowerName];
  if (override) return override;

  for (const suffix of DEFAULT_FORM_SUFFIXES) {
    if (lowerName.endsWith(`-${suffix}`)) {
      return titleCasePokemonName(lowerName.slice(0, -suffix.length - 1));
    }
  }

  return titleCasePokemonName(lowerName);
}

export function getPokemonById(id: number): PokemonEntry | undefined {
  return POKEMON_BY_ID.get(id);
}

export { ARTWORK_DETAIL_WIDTH, getOfficialArtworkUrl } from '@/lib/pokemon-artwork';

export interface PokemonSummary extends PokemonEntry {
  sprites: {
    front_default: string;
    other: {
      'official-artwork': { front_default: string };
    };
  };
}

export function getPokemonSummary(id: number): PokemonSummary | null {
  const entry = getPokemonById(id);
  if (!entry) return null;
  const artwork = getOfficialArtworkUrl(id);
  return {
    ...entry,
    sprites: {
      front_default: artwork,
      other: { 'official-artwork': { front_default: artwork } },
    },
  };
}
