import type { CardFinish, CardLanguage } from '@/lib/domain/cards';
import type { BinderColorId } from '@/lib/binder-colors';
import type { DisplayCatalogCard } from '@/lib/binder-display-model';

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
  appearance: { dark: boolean; color: BinderColorId; pageColors: Record<string, BinderColorId>; glare: boolean };
  /** The share's own "show prices" switch: the viewer's app may look up public card prices only when true. */
  prices: boolean;
  slots: PublicDisplaySlot[];
}
export type PublicShareIdentity = { token: string } | { username: string; binderSlug: string };
