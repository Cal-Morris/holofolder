'use client';

import { useEffect, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import CardImage from '@/components/card-image';
import { OptionRow } from '@/components/ui/option-row';
import { Select } from '@/components/ui/select';
import { CARD_LANGUAGES, type CardLanguage } from '@/lib/domain/cards';
import type { BinderSnapshot } from '@/lib/domain/binder-slots';
import type { SetChecklist } from '@/lib/domain/binder-presets';
import {
  expandSetSlotsResponse,
  type TCGSetSlotCard,
  type TCGSetSlotsWireResponse,
  type TCGSetSummary,
} from '@/lib/tcg-set-slots';
import { getSetSlotsUrl } from '@/lib/card-show-prep';
import type { PreviewCard } from '@/lib/binder-creation-wizard';
import {
  generateSetChecklist,
  isSetChecklistCustomised,
  SET_FINISH_FLAGS,
  verifiedSetFinishes,
  type SetPresetFinish,
} from '@/lib/set-preset';
import { resolveSetSearchAlias } from '@/lib/set-search-aliases';
import { formatCardLanguageLabel } from '@/lib/card-labels';
import { knownSetPromos } from '@/lib/set-promos';

const field =
  'h-11 min-w-0 rounded-2xl border border-border/60 bg-background/60 px-3 text-base outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-primary/50 md:text-sm';
const action =
  'h-11 shrink-0 rounded-2xl border border-border/60 bg-background/60 px-4 text-sm font-semibold transition-colors hover:border-primary/45 hover:bg-primary/5 disabled:opacity-45';
const labels = { normal: 'Normal', holo: 'Holo', reverse_holo: 'Reverse holo', jumbo: 'Jumbo' };
const cardKey = (c: TCGSetSlotCard) => c.canonicalId ?? c.id;
const setDetail = (s: TCGSetSummary) =>
  [s.id, s.officialCardCount ? `${s.officialCardCount} cards` : '', s.seriesName ?? ''].filter(Boolean).join(' · ');
const thumb = (c: TCGSetSlotCard) => (
  <span className="trading-card bg-muted relative block w-8 overflow-hidden rounded-[4px]">
    {c.image && <CardImage src={c.image} alt="" fill sizes="32px" className="object-cover" />}
  </span>
);
type Catalog = { set: TCGSetSummary; cards: TCGSetSlotCard[]; capturedAt: string; dex: Map<string, number> };

/**
 * Choose a set and, optionally, which versions and which of its usual promos to add. No cache/queue writes: the receiving
 * creation surface owns the current unsaved scope. `part` shows only the set choice ("scope") or only the extras
 * ("extras"), or nothing ("none") while the wizard is on another step; the choices are kept either way.
 */
export function SetPresetPicker({
  isOnline,
  initialSet,
  onChange,
  onCards,
  part = 'all',
}: {
  isOnline: boolean;
  initialSet?: TCGSetSummary;
  onChange: (checklist: SetChecklist | null) => void;
  /** Catalog images and Pokémon for the chosen cards, for a picture preview. Never sent anywhere. */
  onCards?: (cards: Map<string, PreviewCard>) => void;
  part?: 'all' | 'scope' | 'extras' | 'none';
  // oxlint-disable-next-line react-doctor/prefer-useReducer -- independent pieces of UI state; React batches the updates and one reducer would not be clearer
}) {
  const [query, setQuery] = useState(initialSet?.id ?? '');
  const [sets, setSets] = useState<TCGSetSummary[]>([]);
  const [language, setLanguage] = useState<CardLanguage>('en');
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [finishes, setFinishes] = useState<SetPresetFinish[]>([]);
  const [promos, setPromos] = useState<TCGSetSlotCard[]>([]);
  const [promoResults, setPromoResults] = useState<TCGSetSlotCard[]>([]);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const request = useRef(0);
  useEffect(
    () => () => {
      request.current++;
    },
    [],
  );
  function publish(nextCatalog = catalog, nextFinishes = finishes, nextPromos = promos) {
    if (!nextCatalog) {
      onChange(null);
      return false;
    }
    try {
      const checklist = generateSetChecklist({
        ...nextCatalog,
        language,
        finishes: nextFinishes,
        excludedCardIds: [],
        promos: nextPromos,
      });
      onChange(checklist);
      setMessage('');
      onCards?.(
        new Map(
          [...nextCatalog.cards, ...nextPromos].map((c) => [
            cardKey(c),
            { name: c.name, localId: c.localId, image: c.image, dexId: nextCatalog.dex.get(c.id) },
          ]),
        ),
      );
      return true;
    } catch {
      setMessage("That selection can't be used. Nothing was changed.");
      return false;
    }
  }
  async function load(target?: TCGSetSummary) {
    const setId = target && resolveSetSearchAlias(target.id);
    if (!isOnline) return;
    const sequence = ++request.current;
    setLoading(true);
    setMessage('');
    if (setId) {
      setCatalog(null);
      onChange(null);
      setPromos([]);
      setPromoResults([]);
    }
    try {
      const response = await fetch(
        setId
          ? getSetSlotsUrl({ id: setId, name: target.name }, language)
          : `/app/api/tcg-set-slots?${new URLSearchParams({ language, query: resolveSetSearchAlias(query) })}`,
      );
      if (!response.ok) throw new Error("Couldn't load sets just now. Try again.");
      // oxlint-disable-next-line react-doctor/async-defer-await -- the early return is a staleness check that has to run after the await
      const data = expandSetSlotsResponse((await response.json()) as TCGSetSlotsWireResponse);
      if (sequence !== request.current) return;
      if (!setId) {
        setSets(data.sets ?? []);
        if (!data.sets?.length) setMessage('No set found with that name or code.');
        return;
      }
      if (!data.selectedSet || data.selectedSet.id !== setId || !Array.isArray(data.cards))
        throw new Error("This set couldn't be loaded in full, so nothing was added.");
      const dex = new Map<string, number>();
      for (const slot of data.slots ?? [])
        for (const card of slot.cards) if (slot.dexId > 0) dex.set(card.id, slot.dexId);
      const next = { set: data.selectedSet, cards: data.cards, capturedAt: new Date().toISOString(), dex };
      if (!publish(next, finishes, [])) return;
      setCatalog(next);
      setSets([]);
      // The set's usual promos (ETB, blisters, Build & Battle) are offered to add. A failure here keeps the set.
      const known = knownSetPromos(next.set.id);
      if (known) {
        // oxlint-disable-next-line react-doctor/async-defer-await -- the early return is a staleness check that has to run after the await
        const promoResponse = await fetch(
          `/app/api/tcg-set-slots?${new URLSearchParams({ language, setId: known.setId })}`,
        ).catch(() => null);
        const promoData = promoResponse?.ok
          ? ((await promoResponse.json().catch(() => null)) as TCGSetSlotsWireResponse | null)
          : null;
        if (sequence !== request.current) return;
        const promoCards = Array.isArray(promoData?.cards) ? expandSetSlotsResponse(promoData).cards! : null;
        if (promoCards) setPromoResults(known.localIds.flatMap((id) => promoCards.filter((c) => c.localId === id)));
      }
    } catch (error) {
      if (sequence === request.current)
        setMessage(error instanceof Error ? error.message : "Couldn't load sets just now. Try again.");
    } finally {
      if (sequence === request.current) setLoading(false);
    }
  }
  const status = (
    <p role="status" className="text-muted-foreground text-xs empty:hidden">
      {loading ? 'Loading…' : message || (!isOnline ? 'Connect to the internet to load a set.' : '')}
    </p>
  );
  if (part === 'none') return null;
  const showScope = part !== 'extras',
    showExtras = part !== 'scope' && catalog;
  const canFind = isOnline && !loading && query.trim().length >= 2;
  const confirmed = (c: TCGSetSlotCard) => c.languageConfirmed === true && c.language === language;
  const finishCounts = catalog
    ? (Object.keys(SET_FINISH_FLAGS) as SetPresetFinish[]).flatMap((f) => {
        const count = [...catalog.cards, ...promos].filter(
          (c) => confirmed(c) && verifiedSetFinishes(c).includes(f),
        ).length;
        return count > 0 ? [{ f, count }] : [];
      })
    : [];
  const togglePromo = (c: TCGSetSlotCard) => {
    const chosen = promos.some((p) => p.id === c.id);
    const next = chosen ? promos.filter((p) => p.id !== c.id) : [...promos, c];
    if (publish(catalog, finishes, next)) setPromos(next);
  };
  return (
    <section aria-label="Set preset scope" className="space-y-4">
      {showScope && (
        <div className="space-y-3">
          <p className="text-muted-foreground text-sm">
            Every card in the set gets a pocket, Trainers, Energy and secret rares included.
          </p>
          <div className="flex gap-2">
            <span className="relative min-w-0 flex-1">
              <Search
                aria-hidden="true"
                className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2"
              />
              <input
                type="search"
                aria-label="Find set preset"
                placeholder="Set name or code"
                className={`${field} w-full pl-9`}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    if (canFind) void load();
                  }
                }}
              />
            </span>
            <button type="button" className={action} disabled={!canFind} onClick={() => void load()}>
              Find set
            </button>
          </div>
          <label className="block text-sm font-medium">
            Card language
            <Select
              aria-label="Checklist language"
              className="mt-1 w-full"
              value={language}
              onChange={(e) => {
                request.current++;
                setLoading(false);
                setLanguage(e.target.value as CardLanguage);
                setCatalog(null);
                setSets([]);
                setPromos([]);
                setPromoResults([]);
                onChange(null);
              }}
            >
              {CARD_LANGUAGES.map((l) => (
                <option key={l} value={l}>
                  {formatCardLanguageLabel(l)}
                </option>
              ))}
            </Select>
          </label>
          {initialSet && !catalog && (
            <OptionRow
              title={`Use ${initialSet.name}`}
              detail={setDetail(initialSet)}
              disabled={!isOnline || loading}
              onClick={() => void load(initialSet)}
            />
          )}
          {catalog && !sets.length && (
            <OptionRow
              selected
              title={catalog.set.name}
              detail={`${catalog.set.id} · ${catalog.cards.length} cards`}
              onClick={() => {
                setSets([catalog.set]);
              }}
              media={
                <span className="flex -space-x-4">
                  {catalog.cards.slice(0, 3).map((c) => (
                    <span key={c.id}>{thumb(c)}</span>
                  ))}
                </span>
              }
            />
          )}
          {sets.length > 0 && (
            <div role="group" aria-label="Matching preset sets" className="space-y-1.5">
              {sets.map((s) => (
                <OptionRow
                  key={s.id}
                  title={s.name}
                  detail={setDetail(s)}
                  selected={catalog?.set.id === s.id}
                  disabled={loading}
                  onClick={() => void load(s)}
                />
              ))}
            </div>
          )}
          {part === 'scope' && status}
        </div>
      )}
      {showExtras && (
        <div className="space-y-4">
          <fieldset className="space-y-1.5">
            <legend className="mb-1 text-sm font-semibold">Which versions?</legend>
            <OptionRow
              selected={!finishes.length}
              title="One of each card"
              detail="Any version fills the pocket"
              onClick={() => {
                if (publish(catalog, [])) setFinishes([]);
              }}
            />
            {finishCounts.map(({ f, count }) => (
              <OptionRow
                key={f}
                selected={finishes.includes(f)}
                title={labels[f]}
                detail={`${count} ${count === 1 ? 'card' : 'cards'}, one pocket each`}
                onClick={() => {
                  const next = finishes.includes(f) ? finishes.filter((x) => x !== f) : [...finishes, f];
                  if (publish(catalog, next)) setFinishes(next);
                }}
              />
            ))}
          </fieldset>
          {promoResults.length > 0 && (
            <fieldset className="space-y-1.5">
              <legend className="mb-1 text-sm font-semibold">
                Add promos <span className="text-muted-foreground font-normal">(optional)</span>
              </legend>
              <p className="text-muted-foreground text-xs">
                Promos released with this set, from its Elite Trainer Box, blisters and Build &amp; Battle box. Tap to
                add.
              </p>
              {promoResults.map((c) => {
                const chosen = promos.some((p) => p.id === c.id);
                return (
                  <OptionRow
                    key={c.id}
                    selected={chosen}
                    aria-label={`Promo ${c.name} #${c.localId}`}
                    title={c.name}
                    detail={`${c.set.name} · #${c.localId}`}
                    media={thumb(c)}
                    disabled={!chosen && (!confirmed(c) || catalog.cards.some((p) => cardKey(p) === cardKey(c)))}
                    onClick={() => togglePromo(c)}
                  />
                );
              })}
            </fieldset>
          )}
          {part === 'extras' && status}
        </div>
      )}
      {part === 'all' && status}
    </section>
  );
}

/** A pure saved snapshot view: no catalog refresh, subscription or ownership assumptions. */
export function SetChecklistScopePreview({ checklist, binder }: { checklist: SetChecklist; binder?: BinderSnapshot }) {
  const s = checklist.scope;
  return (
    <section aria-label="Copied set scope" className="space-y-1 text-xs break-words">
      {binder && isSetChecklistCustomised(checklist, binder) && (
        <p className="font-semibold">Customised preset, completion uses current targets</p>
      )}
      <p className="font-semibold">
        {checklist.manifest.entries.length} targets · {s.setId} · {s.language} ·{' '}
        {s.finishes.length ? s.finishes.join(', ') : 'Any finish'}
      </p>
      <p>
        Copied {s.capturedAt}. {s.promoCardIds.length} selected promos
        {s.excludedCardIds.length ? `; ${s.excludedCardIds.length} exclusions` : ''}. Later catalog updates do not alter
        this checklist.
      </p>
      {s.warnings.map((w) => (
        <p key={w} className="text-muted-foreground">
          {w}
        </p>
      ))}
      <p>
        Completion follows current targets. Free-slot extras do not increase the goal; adding or removing targets
        customises it.
      </p>
    </section>
  );
}
