'use client';

import { useEffect, useLayoutEffect, useRef, useState, type ComponentProps } from 'react';
import SlotDetail from '@/components/binder/slot-detail';
import { CardSelector } from '@/components/binder/lazy-views';
import NativePickQuestion from '@/components/binder/native-pick-question';
import { useNativeSlotPick } from '@/hooks/use-native-slot-pick';
import type { BinderDisplaySlot } from '@/lib/binder-display-model';
import type { PricingRegion } from '@/lib/pricing-region';
import { speciesSelectorCard, type SlotPickerBoundary } from '@/lib/slot-picker';
import { displaySlotName } from '@/lib/pocket-labels';
import type { SearchCardResult } from '@/lib/pokemon-card-browse';
import type { TCGCard } from '@/lib/domain/cards';
import type { CardSelectorPick } from '@/components/card-selector';
import type { StagedSlotCommandIntent } from '@/lib/binder-slot-editing';
import { useSlotDraftAcceptance } from '@/hooks/use-slot-draft-acceptance';
import { slotDraftFailureMessage } from '@/lib/slot-draft-failure';
import {
  assertScanCurrent,
  captureScanDestination,
  planPageFill,
  prepareScanDraft,
  type ScanDestinationView,
} from '@/lib/scan-destinations';

/** The binder's page size, given only while the binder shows its full unfiltered page order. */
type PageGrid = { rows: number; cols: number };

type SelectorPricing = Pick<
  ComponentProps<typeof CardSelector>,
  'defaultCardLanguage' | 'formatAmount' | 'targetLanguages'
> & {
  pricingRegion: PricingRegion;
};

/** Selection only reads the value; the selector's legacy collection write is never reached in native mode. */
const unusedLegacySelect = () => {};

/**
 * What a tap on a native pocket opens. An editable empty pocket always opens the existing visual card selector:
 * a Pokémon pocket lists that Pokémon's cards, a pocket reserved for one printing shows that printing, and a free
 * pocket searches every card. The pick (and variant) is saved headlessly through the native durable sink and the
 * selector closes back onto the binder. Owned and read-only pockets open the card's details.
 * Mounted per tapped slot (keyed by the host).
 */
export default function NativeSlotFlow({
  pricing,
  page,
  ...detail
}: ComponentProps<typeof SlotDetail> & {
  pricing: SelectorPricing;
  /** The tapped pocket's page, so several cards can be added to its empty pockets at once. */
  page?: PageGrid;
}) {
  const { slot, picker, onClose } = detail;
  // Decided once from the pocket as it was tapped; a pocket filled meanwhile falls back to its details.
  const [choosing] = useState(() => Boolean(picker && !slot.item));
  const selecting = choosing && picker && !slot.item;
  useEffect(() => {
    if (!selecting) return;
    window.addEventListener('offline', onClose);
    return () => window.removeEventListener('offline', onClose);
  }, [selecting, onClose]);
  if (selecting)
    return <PocketSelector boundary={picker} slot={slot} pricing={pricing} page={page} onClose={onClose} />;
  return <SlotDetail {...detail} />;
}

function PocketSelector({
  boundary,
  slot,
  pricing,
  page,
  onClose,
}: {
  boundary: SlotPickerBoundary;
  slot: BinderDisplaySlot;
  pricing: SelectorPricing;
  page?: PageGrid;
  onClose: () => void;
}) {
  const save = useNativeSlotPick(boundary, onClose);
  const species = slot.target?.kind !== 'card' ? slot.pokemon : null;
  const reserved = slot.target?.kind === 'card' ? slot.target : null;
  const toSearchCard = (card: TCGCard & { dexIds?: number[] }) =>
    species ? speciesSelectorCard(card, species.id) : ({ ...card, dexIds: card.dexIds ?? [] } as SearchCardResult);
  const fill = usePageFill(boundary, page, onClose);
  return (
    <>
      <CardSelector
        pokemonId={species?.id ?? 0}
        pokemonName={species ? displaySlotName({ card: null, pokemon: species, target: null }) : ''}
        onSelect={unusedLegacySelect}
        onClose={onClose}
        selectedWantedCardId={slot.wantedCards[0]?.card_id}
        {...pricing}
        defaultCardLanguage={reserved?.language ?? pricing.defaultCardLanguage}
        targetLanguages={reserved?.language ? [reserved.language] : pricing.targetLanguages}
        anyCard={
          species
            ? undefined
            : reserved
              ? { title: `Add ${displaySlotName(slot)}`, cardId: reserved.cardId }
              : { title: 'Add a card' }
        }
        native={{
          onPick: (card, finish) => save.pick(toSearchCard(card), finish),
          many:
            fill && !reserved
              ? {
                  room: fill.room,
                  busy: fill.busy,
                  error: fill.error,
                  onAdd: (picks) =>
                    fill.add(
                      slot.id,
                      picks.map(({ card, finish }) => ({ card: toSearchCard(card), finish })),
                    ),
                }
              : undefined,
        }}
      />
      {save.question && <NativePickQuestion question={save.question} onClose={save.dismiss} />}
    </>
  );
}

/**
 * Several picked cards go into the empty pockets of the tapped pocket's page as ONE command, built the way a page scan
 * builds it (new Raw copies, nothing replaced). The page is captured when the picker opens; if it changes, it refuses.
 */
function usePageFill(boundary: SlotPickerBoundary, grid: PageGrid | undefined, onSaved: () => void) {
  const { snapshot, scope, catalog } = boundary;
  const slots = snapshot.binders.find((b) => b.collectionId === scope.collectionId)?.slots ?? [];
  const perPage = grid ? grid.rows * grid.cols : 0;
  const at = slots.findIndex((s) => s.id === scope.slotId);
  const first = at - (at % perPage);
  const view: ScanDestinationView | null =
    grid && at >= 0
      ? {
          ownerUserId: scope.ownerUserId,
          collectionId: scope.collectionId,
          sessionId: 'pocket-picker',
          ...grid,
          pageSlotIds: slots.slice(first, first + perPage).map((s) => s.id),
        }
      : null;
  const [capture] = useState(() => {
    try {
      return view ? captureScanDestination(snapshot, view) : null;
    } catch {
      return null;
    }
  });
  const latest = useRef({ snapshot, view });
  const pendingCatalog = useRef(catalog);
  useLayoutEffect(() => {
    latest.current = { snapshot, view };
  });
  const [error, setError] = useState<string | null>(null);
  // The pocket's own save path: it queues on the device, offline or while syncing.
  const acceptance = useSlotDraftAcceptance<StagedSlotCommandIntent>((draft) => {
    const current = latest.current;
    if (!current.view || !capture) throw new Error('scan-stale');
    assertScanCurrent(current.snapshot, current.view, capture);
    return boundary.onCommandIntent(draft, pendingCatalog.current);
  }, onSaved);
  if (!view || !capture) return null;
  const room = view.pageSlotIds.filter((id) => slots.find((s) => s.id === id)?.inventoryItemId === null).length;
  const add = (startSlotId: string, picks: { card: SearchCardResult; finish: CardSelectorPick['finish'] }[]) => {
    try {
      const prepared = prepareScanDraft(
        snapshot,
        view,
        capture,
        planPageFill(snapshot, view, startSlotId, picks),
        {
          source: 'app',
          clientId: null,
          operationId: crypto.randomUUID(),
          batchId: null,
          clientOccurredAt: new Date().toISOString(),
        },
        catalog,
      );
      setError(null);
      pendingCatalog.current = prepared.catalog;
      acceptance.handoff({ scope: prepared.scope, intent: prepared.intent });
    } catch (cause) {
      setError(pageFillProblem(cause));
    }
  };
  return { room, add, busy: acceptance.busy, error: error ?? acceptance.message };
}

function pageFillProblem(cause: unknown) {
  const reason = cause instanceof Error ? cause.message : '';
  if (reason === 'page-full')
    return 'Not every card fits: some pockets on this page are kept for other cards. Pick fewer.';
  if (reason === 'scan-stale') return 'This page changed. Close this and try again. Nothing was added.';
  if (reason.startsWith('raw-creation-unavailable') || reason === 'copy-choice-required')
    return 'You already have graded copies of one of these. Add that card on its own to choose which copy.';
  return slotDraftFailureMessage(cause);
}
