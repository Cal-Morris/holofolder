import type { CardFinish, CardLanguage } from '@/lib/domain/cards'
import type { BinderColorId } from '@/lib/binder-colors'
import type { DisplayCatalogCard } from '@/lib/binder-display-model'

/** Dedicated public projection, never an owner InventorySnapshot or a private display input. */
export interface PublicDisplaySlot {
  id: string
  target: { kind: 'pokemon'; pokemonId: number } | { kind: 'card'; language?: CardLanguage; finish?: CardFinish } | null
  item: { grading: { grade: string | null } | null } | null
  card: DisplayCatalogCard | null
  pokemon: { id: number; name: string } | null
  recordedProvider?: string
  marketGBP?: number
}
export interface PublicBinder {
  kind: 'native' | 'legacy'
  name: string
  username?: string
  rows: number
  cols: number
  appearance: { dark: boolean; color: BinderColorId; pageColors: Record<string, BinderColorId>; glare: boolean }
  completion: { targetCount: number; completedTargetCount: number }
  slots: PublicDisplaySlot[]
}
export type PublicShareIdentity = { token: string } | { username: string; binderSlug: string }
