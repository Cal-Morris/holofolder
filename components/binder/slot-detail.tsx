'use client';

import { useEffect, useRef, useState } from 'react';
import { Layers3, MoreHorizontal, Palette, X } from 'lucide-react';
import { useOverlay, useSwipeToDismiss } from '@/hooks/use-overlay';
import type { BinderDisplaySlot } from '@/lib/binder-display-model';
import type { WantedCard } from '@/lib/domain/cards';
import { toCardImageSrc } from '@/lib/card-image-url';
import type { SlotPickerBoundary } from '@/lib/slot-picker';
import CardImage from '@/components/card-image';
import CardImageZoom from '@/components/card-image-zoom';
import NativeCardPrice, { type NativeCardPricing } from '@/components/binder/native-card-price';
import { useNativeSlotAction } from '@/hooks/use-native-slot-pick';
import { formatCardFinishLabel, formatCardLanguageLabel } from '@/lib/card-labels';
import { ownedCopyFinishChoices } from '@/lib/card-picker-filters';
import { matchesCatalogCardId } from '@/lib/card-catalog';
import { loadCardsForPokemon } from '@/hooks/use-tcgdex';
import type { TCGCard } from '@/lib/domain/cards';
import { isCardLanguage } from '@/lib/domain/cards';
import { displaySlotName, formatGradeLabel } from '@/lib/pocket-labels';
import { formatDexNumber, getOfficialArtworkUrl } from '@/lib/pokemon-catalog';
import type { SearchCardResult } from '@/lib/pokemon-card-browse';
import { SimilarCardsRow } from '@/components/similar-cards-row';

/** What the host adds to a card's details: saved prices (never in shares), its routes and where the card sits. */
export interface CardDetailHost {
  pricing?: NativeCardPricing;
  onAllCards?: (pokemon: { id: number; name: string }, cardId: string | null) => void;
  onIllustrator?: (name: string) => void;
  /** Opens a card from the Same artwork and Similar look rows. */
  onOpenCard?: (card: SearchCardResult) => void;
  /** Open one of this pocket's wanted cards as its own card, in the finish that is wanted. */
  onOpenWant?: (want: WantedCard) => void;
  /** Opens layout editing with this pocket selected; structure is never edited from the card's details. */
  onArrange?: () => void;
}

const chip =
  'rounded-full border border-border/60 bg-background/35 px-2.5 py-1 text-[11px] font-medium text-muted-foreground dark:border-white/10 dark:bg-white/[0.04]';
const iconButton =
  'flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-muted-foreground hover:bg-background/60 hover:text-foreground dark:hover:bg-white/[0.04]';

/**
 * Card details for a binder pocket: the card first (art, name, printing, price), then where it sits and what is
 * wanted there. Card actions live in the More menu; pocket structure is edited in layout editing, never here.
 */
export default function SlotDetail({
  slot,
  onClose,
  picker,
  host,
  priceLabel,
}: {
  slot: BinderDisplaySlot;
  /** A share's Prices view: the market price of the card in this pocket. */ priceLabel?: string | null;
  onClose: () => void;
  picker?: SlotPickerBoundary;
  host?: CardDetailHost;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useOverlay(true, onClose, { containerRef: ref });
  const swipe = useSwipeToDismiss(ref, onClose);
  const [menu, setMenu] = useState(false);
  const [removing, setRemoving] = useState(false);
  // A finish change keeps the details open on the corrected card; every other action closes them.
  const keepOpen = useRef(false);
  const action = useNativeSlotAction(picker, () => {
    if (keepOpen.current) keepOpen.current = false;
    else onClose();
  });
  const run: typeof action.run = (next, selected) => {
    keepOpen.current = next.kind === 'setFinish';
    action.run(next, selected);
  };
  const editable = Boolean(picker);
  useEffect(() => {
    if (!editable) return;
    window.addEventListener('offline', onClose);
    return () => window.removeEventListener('offline', onClose);
  }, [editable, onClose]);
  // The copy's own recorded printing, never a catalog guess: prices and All cards follow exactly this card.
  const copy = slot.item?.identity.kind === 'card' ? slot.item.identity : null;
  const identity = copy ?? (slot.target?.kind === 'card' ? slot.target : null);
  const [catalogCard, setCatalogCard] = useState<TCGCard>();
  const copyCardId = copy?.cardId;
  const copyLanguage = copy?.language ?? 'en';
  const pokemonId = slot.pokemon?.id;
  useEffect(() => {
    if (!editable || !copyCardId || !pokemonId) return;
    let live = true;
    loadCardsForPokemon(pokemonId, copyLanguage).then(
      (cards) => live && setCatalogCard(cards.find((card) => matchesCatalogCardId(card, copyCardId))),
      () => {},
    );
    return () => {
      live = false;
    };
  }, [editable, copyCardId, copyLanguage, pokemonId]);
  const finishChoices = copy
    ? ownedCopyFinishChoices(catalogCard, slot.target?.kind === 'card' ? slot.target.finish : undefined)
    : [];
  const name = displaySlotName(slot);
  const grade = slot.item?.grading;
  const image = slot.card?.image ?? (slot.pokemon ? getOfficialArtworkUrl(slot.pokemon.id) : null);
  const isCard = Boolean(slot.card?.image);
  const status = slot.item
    ? { label: 'Owned', tone: 'border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400' }
    : slot.wantedCards.length
      ? { label: 'Wanted', tone: 'border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-400' }
      : slot.target
        ? { label: 'Not collected', tone: 'border-border/60 bg-background/35 text-muted-foreground' }
        : { label: 'Empty pocket', tone: 'border-border/60 bg-background/35 text-muted-foreground' };
  const printing = [slot.card?.set?.name, slot.card?.localId ? `#${slot.card.localId}` : null]
    .filter(Boolean)
    .join(' · ');
  const allCards =
    slot.pokemon && host?.onAllCards ? () => host.onAllCards!(slot.pokemon!, copy?.cardId ?? null) : null;
  const canTakeOut = editable && Boolean(slot.item);
  const hasMenu = canTakeOut || Boolean(editable && host?.onArrange);
  return (
    <div className="fixed inset-0 z-40">
      <div data-overlay-backdrop className="absolute inset-0 bg-black/45 backdrop-blur-[2px]" onClick={onClose} />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={`${name} details`}
        data-slot-id={slot.id}
        className="holo-panel border-border/70 bg-card/96 text-foreground absolute inset-x-2 bottom-[calc(var(--dock-clearance)+0.375rem)] mx-auto flex max-h-[calc(100dvh-var(--top-inset)-var(--dock-clearance)-1rem)] max-w-md flex-col overflow-hidden rounded-[1.35rem] border p-3 shadow-[0_28px_70px_-34px_rgba(15,23,42,0.28)] backdrop-blur-xl outline-none sm:rounded-[1.6rem] md:bottom-4 dark:shadow-[0_28px_70px_-34px_rgba(0,0,0,0.55)]"
      >
        <div data-sheet-grabber {...swipe} className="shrink-0">
          <div
            aria-hidden="true"
            className="bg-muted-foreground/30 mx-auto -mt-1 mb-2 h-1.5 w-10 rounded-full sm:hidden"
          />
          <div className="flex items-start gap-3">
            {image && (
              <CardImageZoom
                src={image}
                alt={name}
                disabled={!isCard}
                className={`border-border/60 bg-background/45 relative mt-0.5 flex shrink-0 items-center justify-center overflow-hidden border dark:border-white/10 dark:bg-white/[0.04] ${isCard ? 'trading-card w-[5.5rem] rounded-lg sm:w-24' : 'h-20 w-20 rounded-2xl'}`}
              >
                <CardImage
                  key={`${slot.id}:${image}`}
                  src={image}
                  alt={name}
                  fill
                  sizes="(max-width: 639px) 88px, 96px"
                  className={isCard ? 'object-cover' : `object-contain p-1 ${slot.item ? '' : 'opacity-60 grayscale'}`}
                />
              </CardImageZoom>
            )}
            <div className="min-w-0 flex-1">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  {slot.pokemon && (
                    <p className="text-muted-foreground text-[11px] font-semibold tracking-[0.16em]">
                      {formatDexNumber(slot.pokemon.id)}
                    </p>
                  )}
                  <h2 className="text-[1.05rem] leading-tight font-bold tracking-tight [overflow-wrap:anywhere] break-words">
                    {name}
                  </h2>
                </div>
                <div className="flex shrink-0 items-center gap-0.5">
                  {allCards && (
                    <button
                      type="button"
                      onClick={allCards}
                      aria-label={`All ${displaySlotName({ ...slot, card: null })} cards`}
                      className={`${iconButton} sm:w-auto sm:gap-1 sm:px-2 sm:text-xs sm:font-semibold`}
                    >
                      <Layers3 className="h-4 w-4" />
                      <span className="hidden sm:inline">All cards</span>
                    </button>
                  )}
                  {hasMenu && (
                    <button
                      type="button"
                      aria-label="More card options"
                      aria-haspopup="menu"
                      aria-expanded={menu}
                      onClick={() => setMenu((open) => !open)}
                      className={iconButton}
                    >
                      <MoreHorizontal className="h-4 w-4" />
                    </button>
                  )}
                  <button type="button" aria-label="Close card details" onClick={onClose} className={iconButton}>
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </div>
              {printing && (
                <p className="text-muted-foreground mt-0.5 text-xs [overflow-wrap:anywhere] break-words">{printing}</p>
              )}
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <span
                  className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold tracking-[0.14em] uppercase ${status.tone}`}
                >
                  {status.label}
                </span>
                {identity?.language && <span className={chip}>{formatCardLanguageLabel(identity.language)}</span>}
                {finishChoices.length > 1 ? (
                  <div role="group" aria-label="Finish" className="flex flex-wrap gap-1">
                    {finishChoices.map((choice) => (
                      <button
                        key={choice.finish}
                        type="button"
                        aria-pressed={copy?.finish === choice.finish}
                        disabled={action.busy}
                        onClick={() => {
                          if (copy?.finish === choice.finish) return;
                          run({ kind: 'setFinish', finish: choice.finish });
                        }}
                        className="border-border/60 text-muted-foreground aria-pressed:border-primary/50 aria-pressed:bg-primary/15 aria-pressed:text-foreground min-h-9 rounded-full border px-3 text-[11px] font-medium disabled:opacity-50 dark:border-white/10"
                      >
                        {choice.label}
                      </button>
                    ))}
                  </div>
                ) : (
                  identity?.finish && <span className={chip}>{formatCardFinishLabel(identity.finish)}</span>
                )}
                {grade && <span className={chip}>{formatGradeLabel(grade)}</span>}
              </div>
            </div>
          </div>
          {menu && hasMenu && (
            <div
              role="menu"
              aria-label="Card options"
              className="border-border/60 bg-background/40 mt-3 grid gap-1 rounded-2xl border p-1 dark:border-white/10"
            >
              {canTakeOut && (
                <button
                  type="button"
                  role="menuitem"
                  disabled={action.busy}
                  onClick={() => {
                    setMenu(false);
                    run({ kind: 'clear' });
                  }}
                  className="hover:bg-muted/70 flex min-h-11 flex-col items-start justify-center rounded-xl px-3 text-left text-sm disabled:opacity-50"
                >
                  <span className="font-medium">Take out of this pocket</span>
                  <span className="text-muted-foreground text-xs">The card stays in your collection.</span>
                </button>
              )}
              {canTakeOut &&
                (grade ? (
                  <p className="text-muted-foreground px-3 py-2 text-xs">
                    A graded card can&apos;t be removed from your collection here. You can take it out of the pocket.
                  </p>
                ) : (
                  <button
                    type="button"
                    role="menuitem"
                    disabled={action.busy}
                    onClick={() => {
                      setMenu(false);
                      setRemoving(true);
                    }}
                    className="text-destructive hover:bg-destructive/10 flex min-h-11 flex-col items-start justify-center rounded-xl px-3 text-left text-sm disabled:opacity-50"
                  >
                    <span className="font-medium">Remove from collection</span>
                    <span className="text-muted-foreground text-xs">You no longer own this card.</span>
                  </button>
                ))}
              {editable && host?.onArrange && (
                <button
                  type="button"
                  role="menuitem"
                  onClick={host.onArrange}
                  className="hover:bg-muted/70 flex min-h-11 items-center rounded-xl px-3 text-left text-sm font-medium"
                >
                  Rearrange pockets
                </button>
              )}
            </div>
          )}
        </div>
        <div className="-mx-3 mt-3 -mb-3 flex min-h-0 flex-col gap-3 overflow-y-auto overscroll-contain px-3 pb-3 text-sm [&>*]:shrink-0">
          {removing && !action.failed && (
            <section
              aria-label="Remove card"
              className="border-destructive/40 bg-destructive/10 rounded-2xl border p-3"
            >
              <p className="text-sm font-semibold">Remove {name} from your collection?</p>
              <p className="text-muted-foreground mt-1 text-sm">
                This removes the card itself, and its pocket becomes empty. Other copies you own aren&apos;t affected.
                It can&apos;t be undone with one tap.
              </p>
              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  disabled={action.busy}
                  onClick={() => setRemoving(false)}
                  className="border-border/70 min-h-11 flex-1 rounded-2xl border px-3 text-sm font-medium"
                >
                  Keep it
                </button>
                <button
                  type="button"
                  disabled={action.busy}
                  onClick={() => run({ kind: 'removeOwned' })}
                  className="bg-destructive min-h-11 flex-1 rounded-2xl px-3 text-sm font-semibold text-white disabled:opacity-45"
                >
                  {action.busy ? 'Removing…' : 'Remove card'}
                </button>
              </div>
            </section>
          )}
          {action.failed && (
            <div role="alert" className="border-destructive/40 bg-destructive/10 rounded-2xl border p-3">
              <p className="text-sm break-words">{action.failed}</p>
              <div className="mt-2 flex gap-2">
                {action.retry && (
                  <button
                    type="button"
                    disabled={action.busy}
                    onClick={action.retry}
                    className="border-border min-h-10 rounded-xl border px-3 text-sm font-medium"
                  >
                    Try again
                  </button>
                )}
                <button
                  type="button"
                  disabled={action.busy}
                  onClick={action.dismiss}
                  className="text-muted-foreground min-h-10 rounded-xl px-3 text-sm"
                >
                  Dismiss
                </button>
              </div>
            </div>
          )}
          {copy && host?.pricing && isCardLanguage(copy.language) && (
            <NativeCardPrice
              cardId={copy.cardId}
              language={copy.language}
              finish={copy.finish}
              name={slot.card?.name ?? name}
              setName={slot.card?.set?.name}
              localId={slot.card?.localId}
              pricing={host.pricing}
            />
          )}
          {/* A share's Prices view. The owner's own cards use the saved-price panel instead. */}
          {slot.item && priceLabel && !host?.pricing && (
            <section
              aria-label="Prices"
              className="border-border/60 bg-background/25 rounded-2xl border px-3 py-2 dark:border-white/10 dark:bg-white/[0.03]"
            >
              <p className="text-muted-foreground text-[10px] font-semibold tracking-[0.14em] uppercase">
                Market price
              </p>
              <p className="mt-0.5 text-sm font-bold tabular-nums">{priceLabel}</p>
            </section>
          )}
          {slot.wantedCards.length > 0 && (
            <section aria-label="Wanted here" className="rounded-2xl border border-amber-400/30 bg-amber-400/5 p-3">
              <p className="mb-2 text-[10px] font-semibold tracking-[0.14em] text-amber-700 uppercase dark:text-amber-300">
                {slot.item ? 'Wanted upgrade' : 'Wanted here'}
              </p>
              {/* The wanted card's picture first: it is what you look for. Tapping it opens that card. */}
              <ul className="grid gap-1">
                {slot.wantedCards.map((want, index) => {
                  const detail = [
                    want.card_set,
                    want.card_language ? formatCardLanguageLabel(want.card_language) : null,
                    want.card_finish ? formatCardFinishLabel(want.card_finish) : null,
                  ]
                    .filter(Boolean)
                    .join(' · ');
                  const picture = toCardImageSrc(want.card_image) ?? want.card_image;
                  const body = (
                    <>
                      <span className="trading-card bg-muted relative block w-16 shrink-0 overflow-hidden rounded-md border border-amber-400/40">
                        {picture && <CardImage src={picture} alt="" fill sizes="64px" className="object-cover" />}
                      </span>
                      <span className="min-w-0 flex-1 text-left">
                        <span className="block text-sm font-semibold [overflow-wrap:anywhere] break-words">
                          {want.card_name}
                        </span>
                        {detail && (
                          <span className="text-muted-foreground block text-xs [overflow-wrap:anywhere] break-words">
                            {detail}
                          </span>
                        )}
                      </span>
                    </>
                  );
                  return (
                    <li key={index} className="min-w-0">
                      {host?.onOpenWant ? (
                        <button
                          type="button"
                          aria-label={`Open wanted card ${want.card_name}${detail ? `, ${detail}` : ''}`}
                          onClick={() => host.onOpenWant!(want)}
                          className="flex min-h-11 w-full items-center gap-3 rounded-xl p-1 hover:bg-amber-400/10 focus-visible:ring-2 focus-visible:ring-amber-400/60 focus-visible:outline-none"
                        >
                          {body}
                        </button>
                      ) : (
                        <div className="flex items-center gap-3 p-1">{body}</div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          )}
          {slot.card?.illustrator &&
            (host?.onIllustrator ? (
              <button
                type="button"
                onClick={() => host.onIllustrator!(slot.card!.illustrator!)}
                aria-label={`Illustrator ${slot.card.illustrator}: show all their cards`}
                className="border-border/60 bg-background/25 hover:border-primary/30 hover:bg-primary/10 flex h-12 w-full items-center gap-2.5 rounded-2xl border px-3 text-left transition-colors dark:border-white/10 dark:bg-white/[0.03]"
              >
                <Palette className="text-muted-foreground h-4 w-4 shrink-0" />
                <span className="min-w-0 flex-1">
                  <span className="text-muted-foreground block text-[10px] font-semibold tracking-[0.14em] uppercase">
                    Illustrator
                  </span>
                  <span className="text-primary block truncate text-sm font-semibold">{slot.card.illustrator}</span>
                </span>
              </button>
            ) : (
              <p className="text-muted-foreground text-xs">Illustrated by {slot.card.illustrator}</p>
            ))}
          {slot.card?.rarity && <p className="text-muted-foreground text-xs">{slot.card.rarity}</p>}
          {grade && (
            <dl
              className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs [overflow-wrap:anywhere] break-words"
              aria-label="Grading"
            >
              <dt className="text-muted-foreground">Graded by</dt>
              <dd>{grade.provider.kind === 'known' ? grade.provider.id.toUpperCase() : grade.provider.name}</dd>
              <dt className="text-muted-foreground">Grade</dt>
              <dd>
                {grade.grade ?? 'Unknown'}
                {grade.scale ? ` / ${grade.scale}` : ''}
              </dd>
              {grade.designation && (
                <>
                  <dt className="text-muted-foreground">Designation</dt>
                  <dd>{grade.designation}</dd>
                </>
              )}
              {grade.holder && (
                <>
                  <dt className="text-muted-foreground">Holder</dt>
                  <dd>{grade.holder}</dd>
                </>
              )}
              {grade.subgrades.map((s, index) => (
                <div key={index} className="contents">
                  <dt className="text-muted-foreground">{s.name}</dt>
                  <dd>{s.grade}</dd>
                </div>
              ))}
            </dl>
          )}
          {!slot.item && !slot.wantedCards.length && (
            <p className="text-muted-foreground text-xs">
              {slot.target ? 'Nothing in this pocket yet.' : 'This pocket is empty.'}
            </p>
          )}
          {identity && host?.onOpenCard && isCardLanguage(identity.language) && (
            <SimilarCardsRow cardId={identity.cardId} language={identity.language} onOpenCard={host.onOpenCard} />
          )}
        </div>
      </div>
    </div>
  );
}
