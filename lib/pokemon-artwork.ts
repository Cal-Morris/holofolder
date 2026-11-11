// Pokémon artwork URLs. Kept apart from pokemon-catalog so pages can use them without the catalog JSON.

export function getOfficialArtworkSourceUrl(id: number): string {
  return `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/${id}.png`;
}

/** Grid-sized artwork (the 475px source is ~190 KB; 240px webp is a few KB), same-origin so the service worker caches it. */
export const ARTWORK_GRID_WIDTH = 240;
export const ARTWORK_DETAIL_WIDTH = 480;

export function getOfficialArtworkUrl(id: number, width: number = ARTWORK_GRID_WIDTH): string {
  return `/app/api/card-image-proxy?url=${encodeURIComponent(getOfficialArtworkSourceUrl(id))}&w=${width}`;
}
