"use client"

import { useEffect, useRef, useState } from "react"
import { Layers3, MoreHorizontal, Palette, X } from "lucide-react"
import { useOverlay, useSwipeToDismiss } from "@/hooks/use-overlay"
import type { BinderDisplaySlot } from "@/lib/binder-display-model"
import type { SlotPickerBoundary } from "@/lib/slot-picker"
import CardImage from "@/components/card-image"
import CardImageZoom from "@/components/card-image-zoom"
import NativeCardPrice, { type NativeCardPricing } from "@/components/binder/native-card-price"
import { useNativeSlotAction } from "@/hooks/use-native-slot-pick"
import { formatCardFinishLabel, formatCardLanguageLabel } from "@/lib/card-labels"
import { isCardLanguage } from "@/lib/domain/cards"
import { displaySlotName, formatGradeLabel } from "@/lib/pocket-labels"
import { formatDexNumber, getOfficialArtworkUrl } from "@/lib/pokemon-catalog"

/** What the host adds to a card's details: saved prices (never in shares), its routes and where the card sits. */
export interface CardDetailHost {
  pricing?: NativeCardPricing
  onAllCards?: (pokemon: { id: number; name: string }, cardId: string | null) => void
  onIllustrator?: (name: string) => void
  /** "Page 3 · Pocket B2". */
  place?: string
  /** Opens layout editing with this pocket selected; structure is never edited from the card's details. */
  onArrange?: () => void
}

const chip = "rounded-full border border-border/60 bg-background/35 px-2.5 py-1 text-[11px] font-medium text-muted-foreground dark:border-white/10 dark:bg-white/[0.04]"
const iconButton = "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-muted-foreground hover:bg-background/60 hover:text-foreground dark:hover:bg-white/[0.04]"

/**
 * Card details for a binder pocket: the card first (art, name, printing, price), then where it sits and what is
 * wanted there. Card actions live in the More menu; pocket structure is edited in layout editing, never here.
 */
export default function SlotDetail({ slot, onClose, picker, host }: { slot: BinderDisplaySlot; onClose: () => void; picker?: SlotPickerBoundary; host?: CardDetailHost }) {
  const ref = useRef<HTMLDivElement>(null)
  useOverlay(true, onClose, { containerRef: ref })
  const swipe = useSwipeToDismiss(ref, onClose)
  const [menu, setMenu] = useState(false)
  const action = useNativeSlotAction(picker, onClose)
  const editable = Boolean(picker)
  useEffect(() => {
    if (!editable) return
    window.addEventListener("offline", onClose)
    return () => window.removeEventListener("offline", onClose)
  }, [editable, onClose])
  // The copy's own recorded printing, never a catalog guess: prices and All cards follow exactly this card.
  const copy = slot.item?.identity.kind === "card" ? slot.item.identity : null
  const identity = copy ?? (slot.target?.kind === "card" ? slot.target : null)
  const name = displaySlotName(slot)
  const grade = slot.item?.grading
  const image = slot.card?.image ?? (slot.pokemon ? getOfficialArtworkUrl(slot.pokemon.id) : null)
  const isCard = Boolean(slot.card?.image)
  const status = slot.item ? { label: "Owned", tone: "border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" }
    : slot.wantedCards.length ? { label: "Wanted", tone: "border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-400" }
    : slot.target ? { label: "Not collected", tone: "border-border/60 bg-background/35 text-muted-foreground" }
    : { label: "Empty pocket", tone: "border-border/60 bg-background/35 text-muted-foreground" }
  const printing = [slot.card?.set?.name, slot.card?.localId ? `#${slot.card.localId}` : null].filter(Boolean).join(" · ")
  const allCards = slot.pokemon && host?.onAllCards ? () => host.onAllCards!(slot.pokemon!, copy?.cardId ?? null) : null
  const canTakeOut = editable && Boolean(slot.item)
  const hasMenu = canTakeOut || Boolean(editable && host?.onArrange)
  return <div className="fixed inset-0 z-40">
    <div data-overlay-backdrop className="absolute inset-0 bg-black/45 backdrop-blur-[2px]" onClick={onClose} />
    <div ref={ref} role="dialog" aria-modal="true" aria-label={`${name} details`} data-slot-id={slot.id}
      className="holo-panel absolute inset-x-2 bottom-[calc(var(--dock-clearance)+0.375rem)] mx-auto flex max-h-[calc(100dvh-var(--top-inset)-var(--dock-clearance)-1rem)] max-w-md flex-col overflow-hidden rounded-[1.35rem] border border-border/70 bg-card/96 p-3 text-foreground shadow-[0_28px_70px_-34px_rgba(15,23,42,0.28)] outline-none backdrop-blur-xl sm:bottom-4 sm:rounded-[1.6rem] dark:shadow-[0_28px_70px_-34px_rgba(0,0,0,0.55)]">
      <div data-sheet-grabber {...swipe} className="shrink-0">
        <div aria-hidden="true" className="mx-auto -mt-1 mb-2 h-1.5 w-10 rounded-full bg-muted-foreground/30 sm:hidden" />
        <div className="flex items-start gap-3">
          {image && <CardImageZoom src={image} alt={name} disabled={!isCard}
            className={`relative mt-0.5 flex shrink-0 items-center justify-center overflow-hidden border border-border/60 bg-background/45 dark:border-white/10 dark:bg-white/[0.04] ${isCard ? "trading-card w-[5.5rem] rounded-lg sm:w-24" : "h-20 w-20 rounded-2xl"}`}>
            <CardImage key={`${slot.id}:${image}`} src={image} alt={name} fill sizes="(max-width: 639px) 88px, 96px" className={isCard ? "object-cover" : `object-contain p-1 ${slot.item ? "" : "grayscale opacity-60"}`} />
          </CardImageZoom>}
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                {slot.pokemon && <p className="text-[11px] font-semibold tracking-[0.16em] text-muted-foreground">{formatDexNumber(slot.pokemon.id)}</p>}
                <h2 className="break-words text-[1.05rem] font-bold leading-tight tracking-tight [overflow-wrap:anywhere]">{name}</h2>
              </div>
              <div className="flex shrink-0 items-center gap-0.5">
                {allCards && <button type="button" onClick={allCards} aria-label={`All ${displaySlotName({ ...slot, card: null })} cards`} className={`${iconButton} sm:w-auto sm:gap-1 sm:px-2 sm:text-xs sm:font-semibold`}>
                  <Layers3 className="h-4 w-4" /><span className="hidden sm:inline">All cards</span>
                </button>}
                {hasMenu && <button type="button" aria-label="More card options" aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu(open => !open)} className={iconButton}><MoreHorizontal className="h-4 w-4" /></button>}
                <button type="button" aria-label="Close card details" onClick={onClose} className={iconButton}><X className="h-4 w-4" /></button>
              </div>
            </div>
            {printing && <p className="mt-0.5 break-words text-xs text-muted-foreground [overflow-wrap:anywhere]">{printing}</p>}
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <span className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] ${status.tone}`}>{status.label}</span>
              {identity?.language && <span className={chip}>{formatCardLanguageLabel(identity.language)}</span>}
              {identity?.finish && <span className={chip}>{formatCardFinishLabel(identity.finish)}</span>}
              {grade && <span className={chip}>{formatGradeLabel(grade)}</span>}
            </div>
          </div>
        </div>
        {menu && hasMenu && <div role="menu" aria-label="Card options" className="mt-3 grid gap-1 rounded-2xl border border-border/60 bg-background/40 p-1 dark:border-white/10">
          {canTakeOut && <button type="button" role="menuitem" disabled={action.busy} onClick={() => { setMenu(false); action.run({ kind: "clear" }) }}
            className="flex min-h-11 flex-col items-start justify-center rounded-xl px-3 text-left text-sm hover:bg-muted/70 disabled:opacity-50">
            <span className="font-medium">Take out of this pocket</span>
            <span className="text-xs text-muted-foreground">The card stays in your collection.</span>
          </button>}
          {editable && host?.onArrange && <button type="button" role="menuitem" onClick={host.onArrange} className="flex min-h-11 items-center rounded-xl px-3 text-left text-sm font-medium hover:bg-muted/70">Rearrange pockets</button>}
        </div>}
      </div>
      <div className="-mx-3 -mb-3 mt-3 flex min-h-0 flex-col gap-3 overflow-y-auto overscroll-contain px-3 pb-3 text-sm [&>*]:shrink-0">
        {action.failed && <div role="alert" className="rounded-2xl border border-destructive/40 bg-destructive/10 p-3">
          <p className="break-words text-sm">{action.failed}</p>
          <div className="mt-2 flex gap-2">
            {action.retry && <button type="button" disabled={action.busy} onClick={action.retry} className="min-h-10 rounded-xl border border-border px-3 text-sm font-medium">Try again</button>}
            <button type="button" disabled={action.busy} onClick={action.dismiss} className="min-h-10 rounded-xl px-3 text-sm text-muted-foreground">Dismiss</button>
          </div>
        </div>}
        {copy && host?.pricing && isCardLanguage(copy.language) && <NativeCardPrice cardId={copy.cardId} language={copy.language} finish={copy.finish}
          name={slot.card?.name ?? name} setName={slot.card?.set?.name} localId={slot.card?.localId} pricing={host.pricing} />}
        {/* Only a share's opted-in saved figure; no live price lookup. */}
        {slot.item && slot.card?.savedMarketGBP !== undefined && <section aria-label="Prices" className="rounded-2xl border border-border/60 bg-background/25 px-3 py-2 dark:border-white/10 dark:bg-white/[0.03]">
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Saved market estimate</p>
          <p className="mt-0.5 text-sm font-bold tabular-nums">{new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(slot.card.savedMarketGBP)}</p>
        </section>}
        {slot.wantedCards.length > 0 && <section aria-label="Wanted here" className="space-y-1 rounded-2xl border border-amber-400/30 bg-amber-400/5 p-3">
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-amber-700 dark:text-amber-300">{slot.item ? "Wanted upgrade" : "Wanted here"}</p>
          {slot.wantedCards.map((want, index) => <p key={index} className="break-words text-sm [overflow-wrap:anywhere]">
            <span className="font-semibold">{want.card_name}</span>
            <span className="text-muted-foreground">{[want.card_set, want.card_language ? formatCardLanguageLabel(want.card_language) : null, want.card_finish ? formatCardFinishLabel(want.card_finish) : null].filter(Boolean).map(part => ` · ${part}`).join("")}</span>
          </p>)}
        </section>}
        {slot.card?.illustrator && (host?.onIllustrator
          ? <button type="button" onClick={() => host.onIllustrator!(slot.card!.illustrator!)} aria-label={`Illustrator ${slot.card.illustrator}: show all their cards`}
              className="flex h-12 w-full items-center gap-2.5 rounded-2xl border border-border/60 bg-background/25 px-3 text-left transition-colors hover:border-primary/30 hover:bg-primary/10 dark:border-white/10 dark:bg-white/[0.03]">
              <Palette className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1"><span className="block text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Illustrator</span><span className="block truncate text-sm font-semibold text-primary">{slot.card.illustrator}</span></span>
            </button>
          : <p className="text-xs text-muted-foreground">Illustrated by {slot.card.illustrator}</p>)}
        {(host?.place || slot.card?.rarity) && <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
          {host?.place && <><dt className="text-muted-foreground">In binder</dt><dd className="break-words">{host.place}</dd></>}
          {slot.card?.rarity && <><dt className="text-muted-foreground">Rarity</dt><dd className="break-words">{slot.card.rarity}</dd></>}
        </dl>}
        {grade && <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 break-words text-xs [overflow-wrap:anywhere]" aria-label="Grading">
          <dt className="text-muted-foreground">Graded by</dt><dd>{grade.provider.kind === "known" ? grade.provider.id.toUpperCase() : grade.provider.name}</dd>
          <dt className="text-muted-foreground">Grade</dt><dd>{grade.grade ?? "Unknown"}{grade.scale ? ` / ${grade.scale}` : ""}</dd>
          {grade.designation && <><dt className="text-muted-foreground">Designation</dt><dd>{grade.designation}</dd></>}
          {grade.holder && <><dt className="text-muted-foreground">Holder</dt><dd>{grade.holder}</dd></>}
          {grade.subgrades.map((s, index) => <div key={index} className="contents"><dt className="text-muted-foreground">{s.name}</dt><dd>{s.grade}</dd></div>)}
        </dl>}
        {!slot.item && !slot.wantedCards.length && <p className="text-xs text-muted-foreground">{slot.target ? "Nothing in this pocket yet." : "This pocket is empty."}</p>}
      </div>
    </div>
  </div>
}
