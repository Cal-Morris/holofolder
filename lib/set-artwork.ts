import artwork from '@/card-assets/pokemon/tcg/set-artwork.json';

/** Only successfully mirrored, verified objects are published in this manifest. */
export function getSetArtwork(id: string): { symbol?: string; logo?: string } {
  const set = (artwork as Record<string, { symbol?: { url: string }; logo?: { url: string } }>)[id];
  return { ...(set?.symbol ? { symbol: set.symbol.url } : {}), ...(set?.logo ? { logo: set.logo.url } : {}) };
}
