import { normalizeBinderSnapshot, type BinderSnapshot, type SlotTarget } from '@/lib/domain/binder-slots';
import { normalizeInventorySnapshot, type InventoryItem, type InventorySnapshot } from '@/lib/domain/inventory';
import type { CardLanguage, CollectedPokemon, WantedCard } from '@/lib/domain/cards';
import { isBinderGridSize } from '@/lib/binder-layout';
import { formatPokemonDisplayName, getOfficialArtworkUrl, getPokemonSummary } from '@/lib/pokemon-catalog';
import type { BinderCardDisplay } from '@/lib/selected-slot-card-display';
import { toCardImageSrc } from '@/lib/card-image-url';

export interface DisplayCatalogCard {
  name: string;
  image?: string;
  localId?: string;
  set?: { name: string };
  rarity?: string;
  illustrator?: string;
}
/** Ephemeral read model. The item is a reference, never slot-local ownership. */
export interface BinderDisplaySlot {
  id: string;
  target: SlotTarget | null;
  item: InventoryItem | null;
  card: DisplayCatalogCard | null;
  pokemon: { id: number; name: string } | null;
  wantedCards: readonly WantedCard[];
  legacyPokemonId?: number;
  legacyItem?: CollectedPokemon;
}
/** The printing an owned pocket is priced by: its copy's card and language. Targets, wants and Pokémon copies have none. */
export function displaySlotPriceLookup(
  slot: Pick<BinderDisplaySlot, 'item'>,
): { cardId: string; language: CardLanguage } | null {
  const identity = slot.item?.identity;
  return identity?.kind === 'card' ? { cardId: identity.cardId, language: identity.language ?? 'en' } : null;
}
/** Minimal browse contract shared by private display references and public projections. */
export interface ReadOnlyDisplaySlot {
  id: string;
  target: { kind: 'card' } | { kind: 'pokemon'; pokemonId: number } | null;
  item: { grading: { grade: string | null } | null } | null;
  card: DisplayCatalogCard | null;
  pokemon: { id: number; name: string } | null;
  /** Private owner wants only; public projections omit them. */
  wantedCards?: readonly Pick<WantedCard, 'card_image'>[];
}
export interface SlotDisplayInput {
  binder: BinderSnapshot;
  inventory: InventorySnapshot;
  catalog: Record<string, DisplayCatalogCard>;
  resolveCard?: (cardId: string, language?: CardLanguage) => DisplayCatalogCard | undefined;
}

/** Internal only: requires a complete coherent owner snapshot, not a partial transport page. */
export function buildSlotDisplay(
  binder: BinderSnapshot,
  inventory: InventorySnapshot,
  resolve: (cardId: string, language?: CardLanguage) => DisplayCatalogCard | undefined,
): BinderDisplaySlot[] {
  const checked = normalizeInventorySnapshot(inventory);
  const canonical = checked?.binders.find((b) => b.collectionId === binder.collectionId);
  const requested = normalizeBinderSnapshot(binder);
  if (
    binder.ownerUserId !== inventory.ownerUserId ||
    !canonical ||
    !requested ||
    JSON.stringify(canonical) !== JSON.stringify(requested)
  )
    throw new Error('invalid-display-snapshot');
  const items = new Map(inventory.items.map((item) => [item.id, item]));
  return binder.slots.map((slot) => {
    const item = slot.inventoryItemId ? items.get(slot.inventoryItemId)! : null;
    const cardId =
      item?.identity.kind === 'card' ? item.identity.cardId : slot.target?.kind === 'card' ? slot.target.cardId : null;
    const language =
      item?.identity.kind === 'card'
        ? item.identity.language
        : slot.target?.kind === 'card'
          ? slot.target.language
          : undefined;
    const pokemonId =
      item?.identity.kind === 'pokemon'
        ? item.identity.pokemonId
        : slot.target?.kind === 'pokemon'
          ? slot.target.pokemonId
          : null;
    return {
      id: slot.id,
      target: slot.target,
      item,
      card: cardId ? (resolve(cardId, language) ?? { name: cardId }) : null,
      pokemon: pokemonId ? (getPokemonSummary(pokemonId) ?? null) : null,
      wantedCards: slot.wantedCards,
    };
  });
}

/** Stable names are local display keys only, not conversion IDs or a persisted migration map. */
export function adaptLegacyDisplaySlots(
  collectionId: string,
  pokemon: readonly { id: number; name: string }[],
  getItem: (id: number) => CollectedPokemon | undefined,
): BinderDisplaySlot[] {
  return pokemon.map((p) => {
    const legacyItem = getItem(p.id);
    return {
      id: `legacy:${collectionId}:${p.id}`,
      target: { kind: 'pokemon', pokemonId: p.id },
      item: null,
      card: null,
      pokemon: p,
      wantedCards: legacyItem?.wanted_cards ?? [],
      legacyPokemonId: p.id,
      legacyItem,
    };
  });
}

/** Mask filtered slots in place. Trailing nulls are visual padding, never stored free slots. */
export function paginateDisplaySlots(
  slots: readonly BinderDisplaySlot[],
  rows: number,
  cols: number,
  visible: (slot: BinderDisplaySlot) => boolean = () => true,
): (BinderDisplaySlot | null)[][] {
  if (!isBinderGridSize(rows) || !isBinderGridSize(cols)) throw new Error('invalid-display-grid');
  const capacity = rows * cols;
  return Array.from({ length: Math.ceil(slots.length / capacity) }, (_, page) =>
    Array.from({ length: capacity }, (_, offset) => {
      const slot = slots[page * capacity + offset];
      return slot && visible(slot) ? slot : null;
    }),
  );
}

export function resolveDisplaySelection(slots: readonly BinderDisplaySlot[], slotId: string | null | undefined) {
  return slots.find((slot) => slot.id === slotId) ?? null;
}

/**
 * The pocket a Pokémon search result opens in a binder: its first needed or wanted pocket, else its first
 * pocket. Null when the binder has no pocket for it. `cardSpecies` is catalog evidence, never a name guess.
 */
export function speciesPocket(
  input: Pick<SlotDisplayInput, 'binder' | 'inventory'>,
  pokemonId: number,
  cardSpecies: (cardId: string) => readonly number[] | undefined,
) {
  const items = new Map(input.inventory.items.map((item) => [item.id, item]));
  const species = (identity: SlotTarget | InventoryItem['identity'] | null | undefined) =>
    !identity ? [] : identity.kind === 'pokemon' ? [identity.pokemonId] : (cardSpecies(identity.cardId) ?? []);
  let first = -1;
  for (const [index, slot] of input.binder.slots.entries()) {
    const item = slot.inventoryItemId ? (items.get(slot.inventoryItemId) ?? null) : null;
    if (
      ![
        ...species(slot.target),
        ...species(item?.identity),
        ...slot.wantedCards.flatMap((want) => cardSpecies(want.card_id) ?? []),
      ].includes(pokemonId)
    )
      continue;
    const found = { slotId: slot.id, index, item, want: slot.wantedCards[0] ?? null };
    if (!item || found.want) return found;
    if (first < 0) first = index;
  }
  if (first < 0) return null;
  const slot = input.binder.slots[first];
  return { slotId: slot.id, index: first, item: items.get(slot.inventoryItemId!) ?? null, want: null };
}

/** Legacy PokemonSlot wishlisted tone, shared so native pockets dim wants the same way. */
export const WANTED_PREVIEW_TONE = 'grayscale saturate-[0.75] brightness-[0.92] contrast-[0.95] opacity-90';

/** Like legacy getBinderDisplayCard: outside "current", a want previews its printing dimmed. Owned copies without wants stay full colour, except in "wanted", which dims everything else so only wants stand out. */
export function displaySlotPreview(slot: ReadOnlyDisplaySlot, display: BinderCardDisplay = 'mixed') {
  const wanted = display !== 'current' && Boolean(slot.wantedCards?.length);
  const wantImage = wanted ? slot.wantedCards![0].card_image : undefined;
  const placeholder = slot.pokemon ? getOfficialArtworkUrl(slot.pokemon.id) : null;
  const image = wanted ? (wantImage ?? placeholder) : (slot.card?.image ?? placeholder);
  return {
    image,
    isCard: wanted ? Boolean(wantImage) : Boolean(slot.card?.image),
    tone: wanted ? WANTED_PREVIEW_TONE : slot.item && display !== 'wanted' ? '' : 'grayscale opacity-45',
  };
}

/** The exact URL OrderedSlot's CardImage requests, so page-turn prefetch warms what the pocket shows. */
export function displaySlotImageUrl(slot: ReadOnlyDisplaySlot, display?: BinderCardDisplay) {
  const { image } = displaySlotPreview(slot, display);
  return image ? (toCardImageSrc(image) ?? image) : null;
}

export function displaySlotLabel(slot: Pick<ReadOnlyDisplaySlot, 'card' | 'pokemon' | 'target' | 'item'>) {
  const name =
    slot.card?.name ??
    (slot.pokemon
      ? formatPokemonDisplayName(slot.pokemon.name)
      : slot.target?.kind === 'pokemon'
        ? `Pokémon ${slot.target.pokemonId}`
        : 'Free slot');
  return `${name}, ${slot.item ? 'Owned' : slot.target ? 'Unfilled target' : 'Empty spacer'}`;
}

/** Saved occupied pockets count once; spacers are outside completion goals. */
export function nativeBinderCoverStats(binder: BinderSnapshot) {
  let collected = 0,
    total = 0,
    perfect = 0;
  for (const slot of binder.slots) {
    if (slot.target || slot.inventoryItemId) total++;
    if (slot.inventoryItemId) {
      collected++;
      if (slot.status === 'finalized') perfect++;
    }
  }
  return {
    collected,
    total,
    percentage: total ? Math.round((collected / total) * 100) : 0,
    needed: total - collected,
    perfect,
  };
}
