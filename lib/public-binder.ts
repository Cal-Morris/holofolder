import type { CardFinish, CardLanguage } from '@/lib/domain/cards';
import type { BinderColor } from '@/lib/binder-colors';
import type { DisplayCatalogCard } from '@/lib/binder-display-model';
import type { PageArt } from '@/lib/page-art';

/** Dedicated public projection, never an owner InventorySnapshot or a private display input. */
export interface PublicDisplaySlot {
  id: string;
  /** cardId is the public canonical catalog printing, present only when the catalog resolves it. */
  target:
    | { kind: 'pokemon'; pokemonId: number }
    | { kind: 'card'; cardId?: string; language?: CardLanguage; finish?: CardFinish }
    | null;
  item: { grading: { grade: string | null } | null } | null;
  /** id, language and catalog species links are public catalog data, present only when the catalog resolves the printing. */
  card: (DisplayCatalogCard & { id?: string; language?: CardLanguage; pokemonIds?: number[] }) | null;
  pokemon: { id: number; name: string } | null;
  recordedProvider?: string;
  /** Stored wants in order, display name and artwork only. Omitted when the slot has none. */
  wantedCards?: {
    card_name: string;
    card_image?: string;
    card_id?: string;
    card_language?: CardLanguage;
    pokemonIds?: number[];
  }[];
}
export interface PublicBinder {
  name: string;
  username?: string;
  rows: number;
  cols: number;
  appearance: { dark: boolean; color: BinderColor; pageColors: Record<string, BinderColor>; glare: boolean };
  /** Michi method page art; absent when there is none. */
  pageArt?: PageArt[];
  /** The share's own "show prices" switch: the viewer's app may look up public card prices only when true. */
  prices: boolean;
  slots: PublicDisplaySlot[];
}
export type PublicShareIdentity = { token: string } | { username: string; binderSlug: string };

/** Where a share serves one of its uploaded page artworks, from the share's own path. */
export function publicPageArtUrl(sharePath: string, uploadId: string) {
  const token = /^\/app\/share\/([a-zA-Z0-9_-]{1,200})$/.exec(sharePath)?.[1];
  const named = /^\/@([^/]+)\/([^/]+)$/.exec(sharePath);
  const identity: Record<string, string> | null = token
    ? { token }
    : named
      ? { username: named[1]!, slug: named[2]! }
      : null;
  return identity ? `/app/api/binder-share/page-art?${new URLSearchParams({ ...identity, id: uploadId })}` : null;
}
