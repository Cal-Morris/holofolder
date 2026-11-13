'use client';

// Show mode's Bought on native storage: one queued inventory edit adds every card (placed where wanted, else
// unassigned, lib/collection/show-bought.ts), then the purchases go on the show tally. Undo reverses both.
import { useLayoutEffect, useMemo, useRef } from 'react';
import { isCardFinish, isCardLanguage } from '@/lib/domain/cards';
import { matchesCatalogCardId } from '@/lib/card-catalog';
import { pickerCandidate } from '@/lib/slot-picker';
import { planBought, planBoughtUndo, type BoughtPlacement } from '@/lib/collection/show-bought';
import type { NativeConsumerBinding } from '@/lib/collection/native-card-consumers';
import type { SlotOfflineIntent } from '@/lib/collection/slot-optimistic';
import type { InventorySnapshot } from '@/lib/domain/inventory';
import type { SearchCardResult } from '@/lib/pokemon-card-browse';
import type { ShowPurchase } from '@/lib/show-session';
import type { BoughtEntry, ShowTally } from '@/components/show-bought';

type Acquire = NonNullable<NativeConsumerBinding['acquire']>;

/** Where the cards went, short enough for a toast: "Page 1 · Pocket 2", "in your inventory". */
export function describeBoughtPlacements(placements: readonly BoughtPlacement[]) {
  const labels = [...new Set(placements.map((p) => p.label))];
  if (labels.length > 1) return `${labels.slice(0, -1).join(', ')} and ${labels.at(-1)}`;
  return labels[0] === 'your inventory' ? 'in your inventory' : labels[0];
}

function admitted(acquire: Acquire | undefined) {
  const admission = acquire?.();
  if (!admission || admission.read.evidence.kind === 'unavailable') throw new Error('collection-unavailable');
  return { ...admission, snapshot: admission.read.evidence.snapshot };
}

const draft = (
  snapshot: InventorySnapshot,
  intent: Exclude<SlotOfflineIntent, { kind: 'creation' | 'raw-restore' }>,
) => ({
  scope: {
    ownerUserId: snapshot.ownerUserId,
    collectionId:
      intent.kind === 'slots'
        ? intent.request.collectionId
        : (intent.request.collections[0]?.collectionId ?? snapshot.collections[0]?.id ?? ''),
    slotId: null,
  },
  intent,
});

export function useShowBought(
  acquire: Acquire | undefined,
  tally: {
    logPurchases: (purchases: Array<Omit<ShowPurchase, 'id' | 'at'>>) => string[];
    removePurchases: (ids: readonly string[]) => void;
  },
): ShowTally {
  // The binding is rebuilt every render; Bought always uses the latest one.
  const acquireRef = useRef(acquire);
  useLayoutEffect(() => {
    acquireRef.current = acquire;
  });
  const { logPurchases, removePurchases } = tally;
  return useMemo<ShowTally>(
    () => ({
      async buy(entries: BoughtEntry[]) {
        const admission = admitted(acquireRef.current);
        const cards: SearchCardResult[] = entries.map((entry) => entry.card);
        // The bought printings' catalogue evidence, which the saved read may not hold yet.
        const selected = (id: string) => {
          const card = cards.find((c) => matchesCatalogCardId(c, id));
          return card ? pickerCandidate(card) : undefined;
        };
        const plan = planBought({
          snapshot: admission.snapshot,
          layouts: admission.read.layouts,
          cards: entries.map((entry) => ({
            cardId: entry.cardId,
            ...(isCardLanguage(entry.language) ? { language: entry.language } : {}),
            ...(isCardFinish(entry.finish) ? { finish: entry.finish } : {}),
          })),
          context: admission.context(),
        });
        await admission.receive(draft(admission.snapshot, plan.intent), selected);
        // Only once the cards are saved on this device does the tally get the purchases.
        const ids = logPurchases(entries.map(({ card: _card, ...purchase }) => purchase));
        return {
          added: describeBoughtPlacements(plan.placements),
          async undo() {
            const again = admitted(acquireRef.current);
            const intents = planBoughtUndo({
              snapshot: again.snapshot,
              placements: plan.placements,
              context: again.context(),
              restoreContext: again.context,
            });
            for (const intent of intents) {
              if (intent.kind === 'creation' || intent.kind === 'raw-restore') continue;
              // oxlint-disable-next-line react-doctor/async-await-in-loop -- the restore is planned on the removal, so they queue in order
              await again.receive(draft(again.snapshot, intent), selected);
            }
            removePurchases(ids);
          },
        };
      },
    }),
    [logPurchases, removePurchases],
  );
}
