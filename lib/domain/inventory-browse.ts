import type { TCGCard } from '@/lib/domain/cards';
import type { InventorySnapshot } from '@/lib/domain/inventory';
import type { CompleteInventorySnapshot } from '@/lib/collection/slot-snapshot';

/** Caller must clear evidence synchronously when either authenticated scope member changes. */
export interface InventoryBrowseScope {
  accountUserId: string;
  ownerUserId: string;
}
export type InventoryBrowseEvidence =
  | { kind: 'complete'; snapshot: CompleteInventorySnapshot }
  | { kind: 'cached'; snapshot: InventorySnapshot }
  | { kind: 'unavailable' };

/** Catalog associations are supplied, never guessed from names or species. No private copy fields. */
export interface InventoryCatalogEvidence {
  card: TCGCard;
  speciesNames: readonly string[];
  pokemonIds?: readonly number[];
}
/** Verified settings for this exact ordered binder revision, never a default 3×3. */
export interface InventoryLayoutEvidence {
  collectionId: string;
  layoutRevision: number;
  rows: number;
  cols: number;
}
export interface InventoryLocationIntent {
  collectionId: string;
  slotId: string;
  itemId: string;
}
export type InventoryBrowseLocation =
  | { kind: 'missing' }
  | { kind: 'unassigned' }
  | { kind: 'unknown' }
  | {
      kind: 'assigned';
      intent: InventoryLocationIntent;
      collectionName: string;
      position: number | null;
      page: number | null;
      slot: number | null;
      row: number | null;
      column: number | null;
    };

export interface InventoryBrowseRow {
  itemId: string;
  name: string | null;
  cardId: string | null;
  speciesNames: readonly string[];
  setName: string | null;
  setId: string | null;
  number: string | null;
  image: string | null;
  language: string | null;
  finish: string | null;
  graded: boolean;
  provider: string | null;
  grade: string | null;
  scale: string | null;
  location: InventoryBrowseLocation;
}
export interface InventoryBrowseQuery {
  search?: string;
  collectionId?: string;
  /** A page of the chosen collection, as its saved layout numbers them. Only meaningful with `collectionId`. */
  page?: number;
  assignment?: 'all' | 'assigned' | 'unassigned' | 'unknown';
  condition?: 'all' | 'raw' | 'graded';
  provider?: string;
  grade?: string;
  sort?: 'name' | 'set' | 'location' | 'grading' | 'id';
}
