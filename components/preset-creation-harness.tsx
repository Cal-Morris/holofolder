'use client';

import { useState, useSyncExternalStore } from 'react';
import SetPopulationView from '@/components/set-population-view';
import { syntheticPromoHostSet } from '@/tests/fixtures/set-preset';
import { SetChecklistScopePreview } from '@/components/set-preset-picker';
import { parseSetChecklist } from '@/lib/set-preset';
import BinderSwitcherSheet from '@/components/binder-switcher-sheet';
import { BinderGoalProgress } from '@/components/binder-goal-progress';
import { instantiatePreset, type PresetDefinition } from '@/lib/domain/binder-presets';
import { closeAllOverlays } from '@/hooks/use-overlay';
import type { BinderCreationDraft } from '@/lib/binder-creation-draft';
import { syntheticSlotPickerSnapshot } from '@/tests/fixtures/slot-picker';
import { pickerCandidate } from '@/lib/slot-picker';
import type { Binder } from '@/lib/binders/model';

function subscribeOnline(onChange: () => void) {
  window.addEventListener('online', onChange);
  window.addEventListener('offline', onChange);
  return () => {
    window.removeEventListener('online', onChange);
    window.removeEventListener('offline', onChange);
  };
}

/** Synthetic UI evidence only. No executor, durable state, audit event or queue ACK. */
// oxlint-disable-next-line react-doctor/prefer-useReducer -- independent pieces of UI state; React batches the updates and one reducer would not be clearer
export default function PresetCreationHarness() {
  const [browseSet, setBrowseSet] = useState(false);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<BinderCreationDraft | null>(null);
  const [data, setData] = useState(syntheticSlotPickerSnapshot);
  const [worstCase, setWorstCase] = useState(false);
  const online = useSyncExternalStore(
    subscribeOnline,
    () => navigator.onLine,
    () => true,
  );
  const ownerUserId = data.inventory.ownerUserId;
  const binders: Binder[] = [
    {
      id: data.binder.collectionId,
      ownerUserId,
      name: worstCase ? 'Maushold, Tandemaus and Snorlax collection' : 'Synthetic binder',
      color: null,
      sortOrder: 0,
      isDefault: true,
      rows: null,
      cols: null,
      createdAt: null,
      updatedAt: null,
    },
  ];
  const receive = (next: BinderCreationDraft) => {
    setDraft(next);
    const binder = instantiatePreset(
      structuredClone(next.manifest) as PresetDefinition,
      { ownerUserId, collectionId: data.binder.collectionId },
      next.manifest.entries.map((_, i) => `synthetic-draft-slot-${i}`),
    )!;
    setData((previous) => ({
      ...previous,
      binder,
      inventory: { ...previous.inventory, binders: [binder], placements: [] },
    }));
  };
  return (
    <main className="mx-auto max-w-md space-y-4 px-4 pt-[calc(var(--top-inset)+1rem)] pb-[var(--dock-clearance)]">
      <h1 className="text-lg font-semibold">Synthetic preset preview</h1>
      <p className="text-sm">Internal draft demo. Nothing here is saved.</p>
      <button type="button" className="min-h-11 rounded-xl border px-3" onClick={() => setWorstCase((v) => !v)}>
        {worstCase ? 'Demo data' : 'Worst case'}
      </button>
      <button type="button" className="min-h-11 rounded-xl border px-3" onClick={() => setBrowseSet((v) => !v)}>
        Browse synthetic set
      </button>
      {browseSet && (
        <SetPopulationView
          pricingEnabled={false}
          initialSet={syntheticPromoHostSet}
          collectionByPokemonId={new Map()}
          formatPrice={() => null}
          onSelectSlot={() => {}}
          onBrowseCard={() => {}}
          onCollectCard={() => {}}
          onWantCard={() => {}}
          readOnly={false}
          stagedCreation={{ ownerUserId, onDraft: receive, isOnline: online }}
        />
      )}
      <BinderGoalProgress
        inventory={data.inventory}
        binder={data.binder}
        catalog={(id) => {
          const card = data.cards.find((c) => c.id === id);
          return card ? pickerCandidate(card) : undefined;
        }}
      />
      {draft?.setChecklist && (
        <SetChecklistScopePreview
          binder={data.binder}
          checklist={parseSetChecklist(structuredClone(draft.setChecklist))}
        />
      )}
      <output aria-label="Prepared creation draft" className="block text-xs break-words">
        {draft ? JSON.stringify(draft) : 'No draft'}
      </output>
      <div className="flex flex-wrap gap-2">
        {[
          'Remove last target',
          'Make last target free',
          'Retarget last to Pikachu',
          'Append free extra',
          'Append Energy target',
        ].map((label, index) => (
          <button
            type="button"
            key={label}
            className="min-h-10 rounded-xl border px-3 text-sm"
            onClick={() =>
              setData((previous) => {
                const next = structuredClone(previous);
                if (index >= 3)
                  next.binder.slots.push({
                    ...next.binder.slots[0],
                    id: `synthetic-extra-${next.binder.slots.length}`,
                    target: index === 3 ? null : { kind: 'card', cardId: 'synthetic-energy', language: 'en' },
                    inventoryItemId: null,
                    presetOrigin: null,
                    wantedCards: [],
                    status: null,
                    version: 0,
                  });
                else if (index === 0) next.binder.slots.pop();
                else if (next.binder.slots.length)
                  next.binder.slots.at(-1)!.target = index === 1 ? null : { kind: 'pokemon', pokemonId: 25 };
                next.inventory.binders = [next.binder];
                return next;
              })
            }
          >
            {label}
          </button>
        ))}
      </div>
      <nav
        aria-label="Main navigation"
        className="bg-card fixed inset-x-3 bottom-[var(--dock-inset)] z-[60] mx-auto flex h-[var(--dock-bar)] max-w-md items-center justify-around rounded-2xl shadow-lg"
      >
        <button type="button" className="min-h-11 px-4" onClick={() => setOpen(true)}>
          Binders
        </button>
        <button type="button" className="min-h-11 px-4" onClick={() => closeAllOverlays()}>
          List
        </button>
      </nav>
      {open && (
        <BinderSwitcherSheet
          binders={binders}
          activeBinderId={data.binder.collectionId}
          canManage
          isOnline={online}
          onSwitch={() => setOpen(false)}
          onBindersChange={() => {}}
          onClose={() => setOpen(false)}
          stagedCreation={{ ownerUserId, onDraft: receive }}
        />
      )}
    </main>
  );
}
