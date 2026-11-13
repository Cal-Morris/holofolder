'use client';

import { useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronLeft, ChevronRight, Layers3, Lock, Minus, Plus, Search, X } from 'lucide-react';
import CardImage from '@/components/card-image';
import { SetPresetPicker } from '@/components/set-preset-picker';
import { useOverlay, useSwipeToDismiss } from '@/hooks/use-overlay';
import { useBilling } from '@/hooks/use-billing';
import { useCardSearch } from '@/hooks/use-card-search';
import { canCreateOwnerBinder } from '@/lib/billing';
import {
  blankPreset,
  parseBinderCreationDraft,
  printingPreset,
  printingTarget,
  speciesPreset,
  type BinderCreationDraft,
} from '@/lib/binder-creation-draft';
import { BINDER_NAME_MAX_LENGTH, MAX_BINDERS_PER_OWNER } from '@/lib/binders/model';
import { MAX_BINDER_GRID_SIZE } from '@/lib/binder-layout';
import {
  BLANK_PAGES,
  blankPageLimit,
  clampBlankPages,
  creationSummary,
  customPageSize,
  FREE_PAGE_SIZES,
  isFreePageSize,
  pageSizeLabel,
  previewArt,
  samePageSize,
  suggestedBinderName,
  wizardSteps,
  type CreationPreset,
  type PageSize,
  type PreviewCard,
  type WizardStep,
} from '@/lib/binder-creation-wizard';
import type { SlotLocalAcceptance } from '@/lib/binder-slot-editing';
import type { SetChecklist } from '@/lib/domain/binder-presets';
import { COLLECTION_CREATION_LIMITS } from '@/lib/domain/storage-creation';
import { buildOfflineCardIndex } from '@/lib/offline-card-index';
import {
  formatDexNumber,
  formatPokemonDisplayName,
  getOfficialArtworkUrl,
  POKEMON_CATALOG,
} from '@/lib/pokemon-catalog';
import { GENERATIONS } from '@/lib/pokemon-generations';
import type { SearchCardResult } from '@/lib/pokemon-card-browse';

export interface NativeBinderCreationBinding {
  actorUserId: string;
  ownerUserId: string;
  count: number;
  available: boolean;
  /** The open binder's page size, offered first when it is one every plan can use. */
  currentGrid?: PageSize;
  /** Opened by itself for a new account with nothing set up yet: says so and offers Skip. */
  onboarding?: boolean;
  /** `grid` is the chosen page size for a binder, or null for a list. The same draft is resent on a retry. */
  create: (draft: BinderCreationDraft, grid: PageSize | null) => Promise<SlotLocalAcceptance>;
}

const offlineCards = () => buildOfflineCardIndex([]);
const NUMBERED_GENERATIONS = GENERATIONS.filter((g) => g.id > 0);
const field =
  'min-h-11 w-full rounded-2xl border border-border/60 bg-background/60 px-3 text-base outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-primary/50 md:text-sm';
const choice =
  'rounded-2xl border border-border/60 bg-background/40 transition-[background-color,border-color,transform] duration-150 ease-out hover:border-primary/45 active:scale-[0.98] aria-pressed:border-primary/55 aria-pressed:bg-primary/10';
const speciesName = (id: number) =>
  formatPokemonDisplayName(POKEMON_CATALOG.find((p) => p.id === id)?.name ?? `Pokémon ${id}`);
/** Real catalog card images for the "A set" and "Pick cards" tiles until the person has chosen their own cards. */
const tcgdex = (set: string, number: number) => `https://assets.tcgdex.net/en/base/${set}/${number}/high.webp`;
const SAMPLE_CARDS = {
  set: [tcgdex('base1', 2), tcgdex('base1', 4), tcgdex('base1', 15)],
  printings: [tcgdex('base1', 10), tcgdex('base1', 58), tcgdex('base1', 16)],
};

/** Ordered as before: a set, blank, National Dex, a generation, chosen Pokémon, chosen cards. */
const PRESETS: { id: CreationPreset; title: string; line: string; art: number[] }[] = [
  { id: 'set', title: 'A set', line: 'Every card in one set', art: [] },
  { id: 'blank', title: 'Blank', line: 'Empty pages, fill them your way', art: [] },
  { id: 'national', title: 'National Dex', line: 'A pocket for every Pokémon', art: [1, 4, 7] },
  { id: 'generation', title: 'A generation', line: 'Kanto through Paldea', art: [25, 133, 150] },
  { id: 'species', title: 'Pick Pokémon', line: 'Just the ones you collect', art: [6, 94, 448] },
  { id: 'printings', title: 'Pick cards', line: 'Exact cards, in your order', art: [] },
];
const STEP_TITLES: Record<WizardStep, string> = {
  kind: 'What kind of binder?',
  scope: '',
  extras: 'Versions, promos and cards to leave out',
  layout: 'Name and pages',
  preview: 'Preview',
};
const SCOPE_TITLES: Partial<Record<CreationPreset, string>> = {
  set: 'Which set?',
  generation: 'Which generation?',
  species: 'Which Pokémon?',
  printings: 'Which cards?',
};

function CardFan({ images }: { images: string[] }) {
  return (
    <span className="relative block h-16 w-full">
      {images.slice(0, 3).map((src, index) => (
        <span
          key={src}
          className="trading-card bg-muted absolute top-0.5 w-10 overflow-hidden rounded-[4px] border border-white/20 shadow"
          style={{
            left: `calc(50% - 1.25rem + ${(index - 1) * 1.3}rem)`,
            transform: `rotate(${(index - 1) * 10}deg)`,
            zIndex: index === 1 ? 2 : 1,
          }}
        >
          <CardImage src={src} alt="" fill sizes="40px" className="object-cover" />
        </span>
      ))}
    </span>
  );
}

function PresetArt({ preset, chosen }: { preset: (typeof PRESETS)[number]; chosen: string[] }) {
  if (preset.art.length)
    return (
      <span className="relative block h-16 w-full" aria-hidden="true">
        {preset.art.map((id, index) => (
          <span
            key={id}
            className="absolute top-1/2 h-14 w-14 -translate-y-1/2"
            style={{ left: `calc(50% - 1.75rem + ${(index - 1) * 1.9}rem)`, zIndex: index === 1 ? 2 : 1 }}
          >
            <CardImage
              src={getOfficialArtworkUrl(id)}
              alt=""
              fill
              sizes="56px"
              className="object-contain drop-shadow-md"
            />
          </span>
        ))}
      </span>
    );
  if (preset.id === 'blank')
    return (
      <span className="flex h-16 w-full items-center justify-center" aria-hidden="true">
        <span className="grid grid-cols-3 gap-1">
          {Array.from({ length: 6 }, (_, i) => (
            <span key={i} className="border-muted-foreground/50 h-6 w-[1.15rem] rounded-[3px] border border-dashed" />
          ))}
        </span>
      </span>
    );
  const sample = preset.id === 'set' ? SAMPLE_CARDS.set : SAMPLE_CARDS.printings;
  return (
    <span className="relative block w-full" aria-hidden="true">
      <CardFan images={chosen.length >= 3 ? chosen : sample} />
      {preset.id === 'printings' && <Layers3 className="text-foreground absolute right-1 bottom-0 z-10 h-4 w-4" />}
    </span>
  );
}

/**
 * A short guided way to make a binder: what kind, which set or Pokémon, any extras, its name and pages, then a picture
 * of its first pages. Steps with nothing to choose are skipped and choices are kept when going back. Creating reserves
 * pockets only: it never adds cards you own.
 */
export default function NativeBinderCreation({
  binding,
  onClose,
}: {
  binding: NativeBinderCreationBinding;
  onClose: () => void;
  // oxlint-disable-next-line react-doctor/prefer-useReducer -- independent pieces of UI state; React batches the updates and one reducer would not be clearer
}) {
  const sheet = useRef<HTMLDivElement | null>(null);
  useOverlay(true, onClose, { containerRef: sheet });
  const swipe = useSwipeToDismiss(sheet, onClose);
  // The app's own upgrade route (Settings, plan) is opened by this event; it closes this sheet first.
  const billing = useBilling(binding.actorUserId, binding.ownerUserId, () =>
    window.dispatchEvent(new Event('holofolder-upgrade')),
  );
  const [step, setStep] = useState<WizardStep>('kind');
  const [back, setBack] = useState(false);
  const [preset, setPreset] = useState<CreationPreset>('national');
  const [name, setName] = useState<string | null>(null);
  const [list, setList] = useState(false);
  const [location, setLocation] = useState('');
  const [size, setSize] = useState<PageSize>(
    () =>
      FREE_PAGE_SIZES.find((s) => samePageSize(s, binding.currentGrid)) ?? FREE_PAGE_SIZES[FREE_PAGE_SIZES.length - 1],
  );
  const [custom, setCustom] = useState(false);
  const [customRows, setCustomRows] = useState(() =>
    String(binding.currentGrid && !isFreePageSize(binding.currentGrid) ? binding.currentGrid.rows : 5),
  );
  const [customCols, setCustomCols] = useState(() =>
    String(binding.currentGrid && !isFreePageSize(binding.currentGrid) ? binding.currentGrid.cols : 5),
  );
  const [pagesText, setPagesText] = useState(String(BLANK_PAGES.initial));
  const [generation, setGeneration] = useState(1);
  const [setChecklist, setSetChecklist] = useState<SetChecklist | null>(null);
  const [setCards, setSetCards] = useState<Map<string, PreviewCard>>(() => new Map());
  const [species, setSpecies] = useState<number[]>([]);
  const [printings, setPrintings] = useState<SearchCardResult[]>([]);
  const [query, setQuery] = useState('');
  const [previewPage, setPreviewPage] = useState(0);
  const [draft, setDraft] = useState<BinderCreationDraft | null>(null);
  const [busy, setBusy] = useState(false),
    [saved, setSaved] = useState(false),
    [message, setMessage] = useState('');
  const search = useCardSearch(query, step === 'scope' && preset === 'printings', offlineCards, {
    language: 'en',
    includeNonPokemon: true,
  });
  const gen = GENERATIONS.find((g) => g.id === generation)!;
  const premium = billing.premium;
  const pageSize = custom ? (premium ? customPageSize(customRows, customCols) : null) : size;
  const capacity = (pageSize ?? size).rows * (pageSize ?? size).cols;
  const blankPages = clampBlankPages(Number(pagesText), pageSize ?? size);
  const pickedPrintings = useMemo(() => printings.filter(printingTarget), [printings]);
  const manifest = useMemo(
    () =>
      preset === 'set'
        ? (setChecklist?.manifest ?? blankPreset())
        : preset === 'blank'
          ? blankPreset(list ? 0 : blankPages * capacity)
          : preset === 'national'
            ? speciesPreset(
                'National Dex',
                POKEMON_CATALOG.map((p) => p.id),
                'national-dex',
              )
            : preset === 'generation'
              ? speciesPreset(
                  gen.region,
                  POKEMON_CATALOG.flatMap((p) => (p.id >= gen.start && p.id <= gen.end ? [p.id] : [])),
                  `generation-${gen.id}`,
                )
              : preset === 'species'
                ? speciesPreset('Selected species', species)
                : printingPreset(pickedPrintings),
    [preset, setChecklist, gen, species, pickedPrintings, list, blankPages, capacity],
  );
  const previewCards = useMemo(
    () =>
      preset === 'set'
        ? setCards
        : new Map(
            pickedPrintings.map((c) => [
              printingTarget(c)!.cardId,
              { name: c.name, localId: c.localId, image: c.image, dexId: c.dexIds?.[0] },
            ]),
          ),
    [preset, setCards, pickedPrintings],
  );
  const capped =
    binding.count >= MAX_BINDERS_PER_OWNER ||
    Boolean(billing.access && !canCreateOwnerBinder(billing.access, binding.count));
  const blocked = !binding.available || capped || billing.loading;
  const suggested = suggestedBinderName(preset, { region: gen.region, setName: setChecklist?.scope.setName });
  const shownName = name ?? suggested;
  const grid = list ? null : pageSize;
  const steps = wizardSteps(preset),
    index = steps.indexOf(step);
  const stepReady: Record<WizardStep, boolean> = {
    kind: true,
    scope:
      preset === 'set'
        ? Boolean(setChecklist?.manifest.entries.length)
        : preset === 'species'
          ? species.length > 0
          : preset === 'printings'
            ? pickedPrintings.length > 0
            : true,
    extras: manifest.entries.length > 0,
    layout: Boolean(shownName.trim()) && (list || Boolean(pageSize)),
    preview: true,
  };
  const ready = steps.every((s) => stepReady[s]);
  const pages = Math.max(1, Math.ceil(manifest.entries.length / capacity));
  const page = Math.min(previewPage, pages - 1);
  const summary = creationSummary(preset, manifest.entries.length, grid, {
    region: gen.region,
    setName: setChecklist?.scope.setName,
  });
  const matches =
    query.trim().length < 2 || preset !== 'species'
      ? []
      : POKEMON_CATALOG.filter((p) =>
          `${p.id} ${p.name} ${formatPokemonDisplayName(p.name)}`.toLowerCase().includes(query.trim().toLowerCase()),
        ).slice(0, 18);
  const go = (next: WizardStep, backwards = false) => {
    setBack(backwards);
    setStep(next);
    setPreviewPage(0);
  };
  const choosePreset = (id: CreationPreset) => {
    setPreset(id);
    if (id !== preset) setQuery('');
    go(wizardSteps(id)[1]);
  };
  const create = async () => {
    if (blocked || busy || saved || !ready) return;
    setBusy(true);
    setMessage('');
    try {
      // One draft per creation: a retry resends exactly this one.
      const prepared =
        draft ??
        parseBinderCreationDraft({
          version: 1,
          operationId: crypto.randomUUID(),
          ownerUserId: binding.ownerUserId,
          name: shownName,
          manifest,
          kind: list ? 'custom' : 'binder',
          location: list ? location : null,
          ...(preset === 'set' && setChecklist ? { setChecklist } : {}),
        });
      setDraft(prepared);
      await binding.create(prepared, grid);
      setSaved(true);
    } catch (cause) {
      setMessage(
        cause instanceof Error && cause.message === 'Invalid creation draft'
          ? "That name can't be used. Try a shorter name."
          : "Couldn't create this binder just now. Check your connection and try again. Your choices are kept.",
      );
    } finally {
      setBusy(false);
    }
  };
  const title = saved
    ? 'Binder created'
    : step === 'kind' && binding.onboarding
      ? 'Set up your first binder'
      : step === 'scope'
        ? (SCOPE_TITLES[preset] ?? '')
        : STEP_TITLES[step];
  const primary =
    'min-h-11 flex-1 rounded-2xl bg-primary px-3 text-sm font-semibold text-primary-foreground transition-opacity disabled:opacity-45';
  const secondary = 'min-h-11 rounded-2xl border border-border/60 px-4 text-sm font-medium';
  return createPortal(
    <div className="fixed inset-0 z-[42]">
      <div
        data-overlay-backdrop
        aria-hidden="true"
        className="absolute inset-0 bg-black/55 backdrop-blur-[2px]"
        onClick={onClose}
      />
      <div
        ref={sheet}
        role="dialog"
        aria-modal="true"
        aria-label="New binder"
        className="border-border/70 bg-card absolute inset-x-0 mx-auto flex w-full max-w-md flex-col overflow-hidden rounded-t-[1.6rem] border shadow-xl sm:inset-x-auto sm:left-1/2 sm:-translate-x-1/2 sm:rounded-[1.6rem]"
        style={{
          bottom: 'var(--dock-clearance)',
          maxHeight: 'calc(100dvh - var(--top-inset) - var(--dock-clearance) - 0.5rem)',
        }}
      >
        <header data-sheet-grabber className="shrink-0 px-4 pt-2 pb-2" {...swipe}>
          <div aria-hidden="true" className="bg-muted-foreground/30 mx-auto mb-1 h-1.5 w-10 rounded-full sm:hidden" />
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <h2 className="truncate text-base font-semibold">{title}</h2>
            </div>
            <button
              type="button"
              aria-label="Close new binder"
              onClick={onClose}
              className="hover:bg-muted flex h-10 w-10 shrink-0 items-center justify-center rounded-full"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          {!saved && (
            <div
              role="progressbar"
              aria-label="Progress"
              aria-valuemin={1}
              aria-valuemax={steps.length}
              aria-valuenow={index + 1}
              aria-valuetext={`Step ${index + 1} of ${steps.length}`}
              className="mt-2 flex gap-1"
            >
              {steps.map((s, i) => (
                <span
                  key={s}
                  className={`h-1 flex-1 rounded-full transition-colors duration-200 ${i <= index ? 'bg-primary' : 'bg-muted-foreground/20'}`}
                />
              ))}
            </div>
          )}
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-3">
          <div
            key={saved ? 'saved' : step}
            className={`animate-in fade-in-0 space-y-3 duration-200 ease-out motion-reduce:animate-none ${back ? 'slide-in-from-left-2' : 'slide-in-from-right-2'}`}
          >
            {capped && (
              <p role="status" className="rounded-2xl border border-amber-400/30 bg-amber-400/10 p-3 text-sm">
                You&apos;ve reached the number of binders your plan allows. Your existing binders stay as they are.
              </p>
            )}
            {!binding.available && !saved && !busy && (
              <p role="status" className="border-border/60 bg-muted/40 rounded-2xl border p-3 text-sm">
                You need to be online, with your latest changes saved, to create a binder.
              </p>
            )}
            {saved ? (
              <div className="py-6 text-center">
                <p className="text-sm font-semibold">“{draft?.name}” is on its way</p>
                <p className="text-muted-foreground mt-1 text-sm">
                  It opens as soon as it&apos;s saved to your account.
                </p>
              </div>
            ) : (
              <>
                {step === 'kind' && (
                  <>
                    {binding.onboarding && (
                      <p className="text-muted-foreground text-sm">
                        Pick what your binder is for. It takes a minute, and you can change it all later.
                      </p>
                    )}
                    <div className="grid grid-cols-2 gap-2" role="group" aria-label="What is this binder for?">
                      {PRESETS.map((option) => (
                        <button
                          key={option.id}
                          type="button"
                          onClick={() => choosePreset(option.id)}
                          aria-pressed={preset === option.id}
                          className={`flex min-h-[8.5rem] flex-col items-center justify-between gap-2 p-3 text-center ${choice}`}
                        >
                          <PresetArt
                            preset={option}
                            chosen={
                              option.id === 'set'
                                ? [...setCards.values()].flatMap((c) => (c.image ? [c.image] : []))
                                : option.id === 'printings'
                                  ? pickedPrintings.flatMap((c) => (c.image ? [c.image] : []))
                                  : []
                            }
                          />
                          <span>
                            <span className="block text-sm font-semibold">{option.title}</span>
                            <span className="text-muted-foreground block text-xs">{option.line}</span>
                          </span>
                        </button>
                      ))}
                    </div>
                  </>
                )}
                {step === 'scope' && preset === 'generation' && (
                  <div role="group" aria-label="Generation" className="grid grid-cols-3 gap-1.5">
                    {NUMBERED_GENERATIONS.map((g) => (
                      <button
                        key={g.id}
                        type="button"
                        aria-pressed={generation === g.id}
                        onClick={() => setGeneration(g.id)}
                        className={`flex min-h-12 flex-col items-center justify-center px-1 text-center ${choice}`}
                      >
                        <span className="text-sm font-semibold">{g.region}</span>
                        <span className="text-muted-foreground text-[11px]">{g.end - g.start + 1} Pokémon</span>
                      </button>
                    ))}
                  </div>
                )}
                {step === 'scope' && (preset === 'species' || preset === 'printings') && (
                  <>
                    <div className="relative">
                      <Search
                        aria-hidden="true"
                        className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2"
                      />
                      <input
                        type="search"
                        aria-label={preset === 'species' ? 'Find Pokémon' : 'Find cards'}
                        placeholder={preset === 'species' ? 'Pokémon name or number' : 'Card name, set or number'}
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        className={`${field} pl-9`}
                      />
                    </div>
                    {preset === 'species' && (
                      <>
                        {matches.length > 0 && (
                          <div aria-label="Pokémon results" className="grid grid-cols-3 gap-1.5">
                            {matches.map((p) => (
                              <button
                                key={p.id}
                                type="button"
                                aria-pressed={species.includes(p.id)}
                                onClick={() =>
                                  setSpecies((previous) =>
                                    previous.includes(p.id)
                                      ? previous.filter((id) => id !== p.id)
                                      : [...previous, p.id],
                                  )
                                }
                                className={`flex flex-col items-center p-1.5 text-center ${choice}`}
                              >
                                <span className="relative h-12 w-12">
                                  <CardImage
                                    src={getOfficialArtworkUrl(p.id)}
                                    alt=""
                                    fill
                                    sizes="48px"
                                    className="object-contain"
                                  />
                                </span>
                                <span className="w-full truncate text-xs font-semibold">
                                  {formatPokemonDisplayName(p.name)}
                                </span>
                                <span className="text-muted-foreground text-[10px] tabular-nums">
                                  {formatDexNumber(p.id)}
                                </span>
                              </button>
                            ))}
                          </div>
                        )}
                        {species.length > 0 && (
                          <div aria-label="Chosen Pokémon" className="flex flex-wrap gap-1.5">
                            {species.map((id) => (
                              <button
                                key={id}
                                type="button"
                                aria-label={`Remove ${speciesName(id)}`}
                                onClick={() => setSpecies((previous) => previous.filter((p) => p !== id))}
                                className="border-border/60 bg-background/50 flex min-h-9 items-center gap-1 rounded-full border pr-2 pl-1 text-xs font-medium"
                              >
                                <span className="relative h-7 w-7">
                                  <CardImage
                                    src={getOfficialArtworkUrl(id)}
                                    alt=""
                                    fill
                                    sizes="28px"
                                    className="object-contain"
                                  />
                                </span>
                                {speciesName(id)}
                                <X className="text-muted-foreground h-3 w-3" />
                              </button>
                            ))}
                          </div>
                        )}
                        {!species.length && query.trim().length < 2 && (
                          <p className="text-muted-foreground text-sm">
                            Search and tap the Pokémon you want pockets for. They&apos;re kept in the order you pick
                            them.
                          </p>
                        )}
                      </>
                    )}
                    {preset === 'printings' && (
                      <>
                        {search.loading && (
                          <p role="status" className="text-muted-foreground text-xs">
                            Searching…
                          </p>
                        )}
                        {!search.loading && query.trim().length >= 2 && !search.cards.length && (
                          <p className="text-muted-foreground text-sm">
                            No cards found. Try a different name, set or number.
                          </p>
                        )}
                        {search.cards.length > 0 && (
                          <div aria-label="Card results" className="grid grid-cols-3 gap-1.5">
                            {search.cards.slice(0, 18).map((card) => (
                              <button
                                key={`${card.id}:${card.language}`}
                                type="button"
                                disabled={!printingTarget(card)}
                                aria-label={`Add ${card.name} from ${card.set.name}`}
                                onClick={() => setPrintings((previous) => [...previous, structuredClone(card)])}
                                className="border-border/60 overflow-hidden rounded-xl border text-left transition-transform active:scale-[0.98] disabled:opacity-40"
                              >
                                <span className="trading-card bg-muted relative block w-full">
                                  {card.image && (
                                    <CardImage src={card.image} alt="" fill sizes="120px" className="object-cover" />
                                  )}
                                </span>
                                <span className="block truncate px-1.5 pt-1 text-[11px] font-semibold">
                                  {card.name}
                                </span>
                                <span className="text-muted-foreground block truncate px-1.5 pb-1 text-[10px]">
                                  {card.set.name} · #{card.localId}
                                </span>
                              </button>
                            ))}
                          </div>
                        )}
                        {printings.length > 0 && (
                          <div aria-label="Chosen cards" className="flex gap-1.5 overflow-x-auto pb-1">
                            {printings.map((card, i) => (
                              <button
                                key={`${card.id}:${i}`}
                                type="button"
                                aria-label={`Remove ${card.name}`}
                                onClick={() => setPrintings((previous) => previous.filter((_, n) => n !== i))}
                                className="trading-card border-border/60 bg-muted relative w-11 shrink-0 overflow-hidden rounded-md border"
                              >
                                {card.image && (
                                  <CardImage src={card.image} alt="" fill sizes="44px" className="object-cover" />
                                )}
                                <span className="absolute top-0 right-0 flex h-4 w-4 items-center justify-center rounded-bl bg-black/70 text-white">
                                  <X className="h-2.5 w-2.5" />
                                </span>
                              </button>
                            ))}
                          </div>
                        )}
                        {!printings.length && query.trim().length < 2 && (
                          <p className="text-muted-foreground text-sm">
                            Search and tap each card you want a pocket for, in the order you want them.
                          </p>
                        )}
                      </>
                    )}
                  </>
                )}
                {step === 'layout' && (
                  <>
                    <label className="block text-sm font-medium">
                      Name
                      <input
                        aria-label="Binder name"
                        value={shownName}
                        maxLength={BINDER_NAME_MAX_LENGTH}
                        onChange={(e) => setName(e.target.value)}
                        placeholder="e.g. My trade binder"
                        className={`${field} mt-1`}
                      />
                    </label>
                    <div>
                      <p className="text-sm font-medium">Looks like</p>
                      <div role="group" aria-label="Looks like" className="mt-1 grid grid-cols-2 gap-1.5">
                        <button
                          type="button"
                          aria-pressed={!list}
                          onClick={() => setList(false)}
                          className={`min-h-11 text-sm font-medium ${choice}`}
                        >
                          Binder pages
                        </button>
                        <button
                          type="button"
                          aria-pressed={list}
                          onClick={() => setList(true)}
                          className={`min-h-11 text-sm font-medium ${choice}`}
                        >
                          A simple list
                        </button>
                      </div>
                      <p className="text-muted-foreground mt-1 text-xs">
                        {list ? 'Good for a box, tin or shelf. ' : ''}You can switch between pages and a list any time.
                      </p>
                    </div>
                    {list ? (
                      <label className="block text-sm font-medium">
                        Where is it kept? <span className="text-muted-foreground font-normal">(optional)</span>
                        <input
                          aria-label="Where it is kept"
                          value={location}
                          maxLength={COLLECTION_CREATION_LIMITS.location}
                          onChange={(e) => setLocation(e.target.value)}
                          placeholder="e.g. Top shelf"
                          className={`${field} mt-1`}
                        />
                        <span className="text-muted-foreground mt-1 block text-xs font-normal">
                          Only you and your partner see this. It&apos;s never on a shared link.
                        </span>
                      </label>
                    ) : (
                      <>
                        <div>
                          <p className="text-sm font-medium">Pockets on a page</p>
                          <div role="group" aria-label="Pockets on a page" className="mt-1 grid grid-cols-5 gap-1.5">
                            {FREE_PAGE_SIZES.map((option) => (
                              <button
                                key={`${option.rows}x${option.cols}`}
                                type="button"
                                aria-pressed={!custom && samePageSize(size, option)}
                                aria-label={pageSizeLabel(option)}
                                onClick={() => {
                                  setCustom(false);
                                  setSize(option);
                                }}
                                className={`flex min-h-[4.5rem] flex-col items-center justify-center gap-1 ${choice}`}
                              >
                                <span
                                  className="grid gap-[2px]"
                                  style={{ gridTemplateColumns: `repeat(${option.cols}, 0.4rem)` }}
                                  aria-hidden="true"
                                >
                                  {Array.from({ length: option.rows * option.cols }, (_, i) => (
                                    <span key={i} className="bg-muted-foreground/55 h-[0.55rem] rounded-[1px]" />
                                  ))}
                                </span>
                                <span className="text-xs font-semibold tabular-nums">{option.rows * option.cols}</span>
                              </button>
                            ))}
                            <button
                              type="button"
                              aria-pressed={custom}
                              aria-label={premium ? 'Custom page size' : 'Custom page size, Premium'}
                              onClick={() => setCustom(true)}
                              className={`flex min-h-[4.5rem] flex-col items-center justify-center gap-1 ${choice}`}
                            >
                              {premium ? (
                                <span aria-hidden="true" className="text-sm font-semibold">
                                  R×C
                                </span>
                              ) : (
                                <Lock aria-hidden="true" className="text-muted-foreground h-4 w-4" />
                              )}
                              <span className="text-xs font-semibold">Custom</span>
                            </button>
                          </div>
                          {custom &&
                            (premium ? (
                              <div className="border-border/60 mt-2 rounded-2xl border p-3">
                                <div className="grid grid-cols-2 gap-2">
                                  <label className="text-sm">
                                    Rows
                                    <input
                                      type="number"
                                      inputMode="numeric"
                                      min={1}
                                      max={MAX_BINDER_GRID_SIZE}
                                      step={1}
                                      value={customRows}
                                      onChange={(e) => setCustomRows(e.target.value)}
                                      className={`${field} mt-1`}
                                    />
                                  </label>
                                  <label className="text-sm">
                                    Columns
                                    <input
                                      type="number"
                                      inputMode="numeric"
                                      min={1}
                                      max={MAX_BINDER_GRID_SIZE}
                                      step={1}
                                      value={customCols}
                                      onChange={(e) => setCustomCols(e.target.value)}
                                      className={`${field} mt-1`}
                                    />
                                  </label>
                                </div>
                                <p className="text-muted-foreground mt-2 text-xs">
                                  1 to {MAX_BINDER_GRID_SIZE} rows and columns
                                  {pageSize ? ` · ${pageSize.rows * pageSize.cols} pockets a page` : ''}.
                                </p>
                              </div>
                            ) : (
                              <div className="border-primary/30 bg-primary/5 mt-2 rounded-2xl border p-3">
                                <p className="text-sm">
                                  Choose your own page size, up to {MAX_BINDER_GRID_SIZE} by {MAX_BINDER_GRID_SIZE},
                                  with Holo Folder Premium.
                                </p>
                                <button
                                  type="button"
                                  disabled={billing.loading}
                                  onClick={billing.upgrade}
                                  className="border-primary/40 text-primary mt-2 min-h-11 w-full rounded-2xl border px-3 text-sm font-semibold disabled:opacity-45"
                                >
                                  {billing.loading ? 'Checking plan…' : 'Upgrade for custom layouts'}
                                </button>
                              </div>
                            ))}
                        </div>
                        {preset === 'blank' && (
                          <div>
                            <label htmlFor="new-binder-pages" className="text-sm font-medium">
                              How many pages?
                            </label>
                            <div className="mt-1 flex items-center gap-2">
                              <button
                                type="button"
                                aria-label="Fewer pages"
                                disabled={blankPages <= BLANK_PAGES.min}
                                onClick={() => setPagesText(String(blankPages - 1))}
                                className={`flex h-11 w-11 shrink-0 items-center justify-center disabled:opacity-40 ${choice}`}
                              >
                                <Minus className="h-4 w-4" />
                              </button>
                              <input
                                id="new-binder-pages"
                                type="number"
                                inputMode="numeric"
                                min={BLANK_PAGES.min}
                                max={blankPageLimit(pageSize ?? size)}
                                step={1}
                                value={pagesText}
                                onChange={(e) => setPagesText(e.target.value)}
                                onBlur={() => setPagesText(String(blankPages))}
                                className={`${field} text-center tabular-nums`}
                              />
                              <button
                                type="button"
                                aria-label="More pages"
                                disabled={blankPages >= blankPageLimit(pageSize ?? size)}
                                onClick={() => setPagesText(String(blankPages + 1))}
                                className={`flex h-11 w-11 shrink-0 items-center justify-center disabled:opacity-40 ${choice}`}
                              >
                                <Plus className="h-4 w-4" />
                              </button>
                            </div>
                            <p className="text-muted-foreground mt-1 text-xs">
                              {blankPages * capacity} empty pockets. Up to {blankPageLimit(pageSize ?? size)} pages; you
                              can add more later.
                            </p>
                          </div>
                        )}
                      </>
                    )}
                  </>
                )}
                {step === 'preview' && (
                  <>
                    <p className="text-sm font-semibold [overflow-wrap:anywhere] break-words">{shownName.trim()}</p>
                    <p className="text-muted-foreground -mt-2 text-sm">{summary}</p>
                    {manifest.entries.length === 0 ? (
                      <div className="border-border/70 text-muted-foreground rounded-2xl border border-dashed p-6 text-center text-sm">
                        Starts empty. Add pockets and cards whenever you like.
                      </div>
                    ) : (
                      <section
                        aria-label={`Page ${page + 1} preview`}
                        className="rounded-2xl border border-white/15 bg-gradient-to-br from-slate-200 to-slate-300 p-2 shadow-inner dark:from-slate-700 dark:to-slate-800"
                      >
                        <div
                          className="grid gap-1.5"
                          style={{
                            gridTemplateColumns: `repeat(${list ? 4 : (pageSize ?? size).cols}, minmax(0, 1fr))`,
                          }}
                        >
                          {Array.from({ length: capacity }, (_, offset) => {
                            const art = previewArt(
                              manifest.entries[page * capacity + offset]?.target,
                              previewCards,
                              getOfficialArtworkUrl,
                              speciesName,
                            );
                            return (
                              <div
                                key={offset}
                                className="trading-card relative flex items-center justify-center overflow-hidden rounded-[5px] border border-black/10 bg-white/55 dark:border-white/10 dark:bg-white/[0.06]"
                                title={art?.label}
                              >
                                {art?.src ? (
                                  <CardImage
                                    src={art.src}
                                    alt={art.label}
                                    fill
                                    sizes="80px"
                                    className={
                                      art.card ? 'object-cover' : 'object-contain p-[3px] opacity-60 grayscale'
                                    }
                                  />
                                ) : art ? (
                                  <span className="px-0.5 text-center text-[9px] leading-tight font-medium text-slate-700 dark:text-slate-200">
                                    {art.number ? `#${art.number} ` : ''}
                                    {art.label}
                                  </span>
                                ) : null}
                              </div>
                            );
                          })}
                        </div>
                      </section>
                    )}
                    {pages > 1 && (
                      <div className="flex items-center justify-between gap-2">
                        <button
                          type="button"
                          aria-label="Previous page"
                          disabled={page === 0}
                          onClick={() => setPreviewPage(page - 1)}
                          className="border-border/60 flex h-10 w-10 items-center justify-center rounded-full border disabled:opacity-40"
                        >
                          <ChevronLeft className="h-4 w-4" />
                        </button>
                        <span className="text-muted-foreground text-xs tabular-nums">
                          Page {page + 1} of {pages}
                        </span>
                        <button
                          type="button"
                          aria-label="Next page"
                          disabled={page + 1 === pages}
                          onClick={() => setPreviewPage(page + 1)}
                          className="border-border/60 flex h-10 w-10 items-center justify-center rounded-full border disabled:opacity-40"
                        >
                          <ChevronRight className="h-4 w-4" />
                        </button>
                      </div>
                    )}
                    <p className="text-muted-foreground text-xs">
                      {manifest.entries.length
                        ? 'These pockets start empty. Nothing is added to the cards you own.'
                        : 'Nothing is added to the cards you own.'}
                    </p>
                    {message && (
                      <p role="alert" className="text-sm">
                        {message}
                      </p>
                    )}
                  </>
                )}
              </>
            )}
          </div>
          {/* Outside the per-step container (which remounts each step) so the set, versions, promos and left-out cards
            survive going back and forth. */}
          {!saved && (
            <div className="mt-3 empty:hidden">
              <SetPresetPicker
                isOnline={binding.available}
                part={preset !== 'set' ? 'none' : step === 'scope' ? 'scope' : step === 'extras' ? 'extras' : 'none'}
                onChange={setSetChecklist}
                onCards={setSetCards}
              />
            </div>
          )}
        </div>
        <footer className="border-border/60 flex shrink-0 gap-2 border-t p-3">
          {saved ? (
            <button type="button" onClick={onClose} className={primary}>
              Done
            </button>
          ) : (
            <>
              {index > 0 && !draft && (
                <button type="button" onClick={() => go(steps[index - 1], true)} className={secondary}>
                  Back
                </button>
              )}
              {index === 0 && binding.onboarding && (
                <button type="button" onClick={onClose} className={secondary}>
                  Skip for now
                </button>
              )}
              {step === 'preview' ? (
                <button
                  type="button"
                  disabled={blocked || busy || !ready}
                  onClick={() => void create()}
                  className={primary}
                >
                  {busy ? 'Creating…' : draft ? 'Try again' : 'Create binder'}
                </button>
              ) : (
                <button
                  type="button"
                  disabled={!stepReady[step]}
                  onClick={() => go(steps[index + 1])}
                  className={primary}
                >
                  {steps[index + 1] === 'preview' ? 'Preview' : 'Next'}
                </button>
              )}
            </>
          )}
        </footer>
      </div>
    </div>,
    document.body,
  );
}
