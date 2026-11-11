import { isBinderGridSize } from "@/lib/binder-layout"
import type { InventorySnapshot } from "@/lib/domain/inventory"
import type { SlotTarget } from "@/lib/domain/binder-slots"
import { SLOT_LIMITS } from "@/lib/domain/slot-commands"

export type CreationPreset = "set" | "blank" | "national" | "generation" | "species" | "printings"
export interface PageSize { rows: number; cols: number }

/** Page sizes every plan can use (the same set the saved-layout rule allows without Premium). */
export const FREE_PAGE_SIZES: readonly PageSize[] = [{ rows: 2, cols: 2 }, { rows: 3, cols: 3 }, { rows: 3, cols: 4 }, { rows: 4, cols: 4 }]

export function pageSizeLabel(size: PageSize): string {
  return `${size.rows * size.cols} pockets, ${size.rows} by ${size.cols}`
}

/** A starting name the person can keep or change. A blank or hand-picked binder has no obvious name. */
export function suggestedBinderName(preset: CreationPreset, context: { region?: string; setName?: string } = {}): string {
  if (preset === "national") return "National Dex"
  if (preset === "generation") return context.region ?? ""
  if (preset === "set") return context.setName ?? ""
  return ""
}

const count = (value: number, one: string, many = `${one}s`) => `${value.toLocaleString("en-GB")} ${value === 1 ? one : many}`

/** One line under the name in the preview: what the binder holds and how many pages that makes. */
export function creationSummary(preset: CreationPreset, entries: number, grid: PageSize | null, context: { region?: string; setName?: string } = {}): string {
  const what = preset === "national" ? `National Dex · ${count(entries, "Pokémon", "Pokémon")}`
    : preset === "generation" ? `${context.region ?? "Generation"} · ${count(entries, "Pokémon", "Pokémon")}`
    : preset === "species" ? count(entries, "Pokémon", "Pokémon")
    : preset === "set" ? `${context.setName ?? "Set"} · ${count(entries, "card")}`
    : preset === "printings" ? count(entries, "card") : "Blank"
  if (!grid) return `${what} · list`
  if (!entries) return `${what} · ${grid.rows * grid.cols} pockets a page`
  return `${what} · ${count(Math.ceil(entries / (grid.rows * grid.cols)), "page")} of ${grid.rows * grid.cols}`
}

/** The wizard's steps for a preset. Steps with nothing to choose are left out (National Dex has no scope, only a set has extras). */
export type WizardStep = "kind" | "scope" | "extras" | "layout" | "preview"
export function wizardSteps(preset: CreationPreset): WizardStep[] {
  if (preset === "set") return ["kind", "scope", "extras", "layout", "preview"]
  if (preset === "national" || preset === "blank") return ["kind", "layout", "preview"]
  return ["kind", "scope", "layout", "preview"]
}

export function samePageSize(a: PageSize | null | undefined, b: PageSize | null | undefined) {
  return Boolean(a && b && a.rows === b.rows && a.cols === b.cols)
}
export function isFreePageSize(size: PageSize) {
  return FREE_PAGE_SIZES.some(s => samePageSize(s, size))
}
/** A custom rows by columns page, or null when either side is not a whole number from 1 to 8. */
export function customPageSize(rows: unknown, cols: unknown): PageSize | null {
  const r = typeof rows === "string" && rows.trim() ? Number(rows) : rows, c = typeof cols === "string" && cols.trim() ? Number(cols) : cols
  return isBinderGridSize(r) && isBinderGridSize(c) ? { rows: r, cols: c } : null
}

/** Pages for a blank binder: at least one, at most 50, and never more pockets than a binder can hold. */
export const BLANK_PAGES = { min: 1, max: 50, initial: 10 } as const
export function blankPageLimit(size: PageSize) {
  return Math.max(BLANK_PAGES.min, Math.min(BLANK_PAGES.max, Math.floor(SLOT_LIMITS.capacity / (size.rows * size.cols))))
}
export function clampBlankPages(value: number, size: PageSize) {
  return Number.isFinite(value) ? Math.min(blankPageLimit(size), Math.max(BLANK_PAGES.min, Math.round(value))) : BLANK_PAGES.min
}

/**
 * Whether to open the wizard as first-run onboarding: the signed-in person owns this collection and it has nothing set
 * up yet (no cards, and at most the one binder every new account is given, with nothing in or planned for its pockets).
 */
export function shouldOfferBinderOnboarding(snapshot: Pick<InventorySnapshot, "ownerUserId" | "items" | "collections" | "binders">, actorUserId: string) {
  return snapshot.ownerUserId === actorUserId && snapshot.items.length === 0 && snapshot.collections.length <= 1
    && snapshot.binders.every(b => b.slots.every(s => s.target === null && s.inventoryItemId === null && !s.wantedCards.length))
}

export interface PreviewCard { name: string; localId?: string; image?: string; dexId?: number }
export interface PreviewArt { src: string | null; card: boolean; label: string; number?: string }
/**
 * What a pocket shows in the preview: the card's own image when the catalog gave one, else the Pokémon's artwork
 * (as the National Dex does) when the card is known to be that Pokémon, else just its name. Nothing is guessed.
 */
export function previewArt(target: SlotTarget | null | undefined, cards: ReadonlyMap<string, PreviewCard>, artwork: (pokemonId: number) => string, speciesName: (pokemonId: number) => string): PreviewArt | null {
  if (!target) return null
  if (target.kind === "pokemon") return { src: artwork(target.pokemonId), card: false, label: speciesName(target.pokemonId) }
  const card = cards.get(target.cardId)
  if (card?.image) return { src: card.image, card: true, label: card.name, number: card.localId }
  if (card?.dexId) return { src: artwork(card.dexId), card: false, label: card.name, number: card.localId }
  return { src: null, card: true, label: card?.name ?? "Card", number: card?.localId }
}
