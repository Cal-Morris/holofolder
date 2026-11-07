"use client"

import { Check, Heart, Star, X } from "lucide-react"
import { type CSSProperties, type TouchEvent as ReactTouchEvent, type SyntheticEvent, memo, useRef, useState } from "react"
import CardImage from "@/components/card-image"
import CardFinishShader from "@/components/card-finish-shader"
import type { CardFinish, SlotStatus } from "@/hooks/use-collection"
import { loadCardsForPokemon } from "@/hooks/use-tcgdex"
import { getTouchGestureIntent } from "@/hooks/use-touch-gestures"
import { getBinderSlotQuickActions } from "@/lib/binder-slot-actions"
import { toCardImageSrc } from "@/lib/card-image-url"
import { formatDexNumber, formatPokemonDisplayName, getOfficialArtworkUrl } from "@/lib/pokemon-catalog"
import type { User } from "@supabase/supabase-js"

export const TRADING_CARD_CORNER_RADIUS = "4.76% / 3.41%"

export const TRADING_CARD_INNER_CORNER_RADIUS = "4% / 2.86%"

export function clampGlareValue(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}

export function getPokemonOfficialArtworkUrl(pokemonId: number) {
  return getOfficialArtworkUrl(pokemonId)
}

export function getUsableImageSource(value?: string | null) {
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  if (!trimmed || trimmed === "null" || trimmed === "undefined") return null
  return trimmed
}

/** The image URL a binder slot renders: its card image, else the Pokémon artwork at grid size. */
export function resolveSlotImageUrl(pokemonId: number, cardImage?: string | null) {
  return toCardImageSrc(getUsableImageSource(cardImage)) || getPokemonOfficialArtworkUrl(pokemonId)
}

export function getCardPreviewPose(seed: number) {
  const rotate = (((seed * 37) % 100) / 100 - 0.5) * 0.9
  const skewX = (((seed * 53) % 100) / 100 - 0.5) * 0.35
  const translateX = (((seed * 61) % 100) / 100 - 0.5) * 1.1
  const translateY = (((seed * 71) % 100) / 100 - 0.5) * 0.9
  const scale = 1.048 + (((seed * 29) % 100) / 100) * 0.016

  return `translate(${translateX.toFixed(2)}%, ${translateY.toFixed(2)}%) rotate(${rotate.toFixed(2)}deg) skewX(${skewX.toFixed(2)}deg) scale(${scale.toFixed(3)})`
}

export function hashSlotValue(seed: number, salt: number) {
  const value = Math.sin(seed * 12.9898 + salt * 78.233) * 43758.5453
  return value - Math.floor(value)
}

export function getSlotFinishGlint(baseGlint: { x: number; y: number; angle: number }, seed: number) {
  const xMotionScale = 0.72 + hashSlotValue(seed, 1) * 0.64
  const yMotionScale = 0.78 + hashSlotValue(seed, 2) * 0.52
  const angleMotionScale = 0.82 + hashSlotValue(seed, 3) * 0.42
  const xOffset = hashSlotValue(seed, 4) * 0.2 - 0.1
  const yOffset = hashSlotValue(seed, 5) * 0.18 - 0.09
  const angleOffset = hashSlotValue(seed, 6) * 32 - 16
  const phase = hashSlotValue(seed, 7) * 5.8
  const patternSeed = seed * 0.017 + hashSlotValue(seed, 8) * 17
  const intensity = 0.86 + hashSlotValue(seed, 9) * 0.32
  const hueOffset = hashSlotValue(seed, 10) * 0.22 - 0.11
  const patternScale = 0.82 + hashSlotValue(seed, 11) * 0.42
  const centeredX = baseGlint.x - 0.5
  const centeredY = baseGlint.y - 0.5

  return {
    x: clampGlareValue(0.5 + centeredX * xMotionScale + xOffset, 0.04, 0.96),
    y: clampGlareValue(0.5 + centeredY * yMotionScale + yOffset, 0.04, 0.96),
    angle: baseGlint.angle * angleMotionScale + angleOffset,
    phase,
    patternSeed,
    intensity,
    hueOffset,
    patternScale,
  }
}

export function getCardFinishEffectClass(finish: CardFinish) {
  switch (finish) {
    case "holo":
      return "card-finish-holo"
    case "reverse_holo":
      return "card-finish-reverse-holo"
    case "double_rare":
      return "card-finish-double"
    case "ultra_rare":
      return "card-finish-ultra"
    case "illustration_rare":
      return "card-finish-ir"
    case "special_illustration_rare":
      return "card-finish-sir"
    case "secret_rare":
    case "hyper_rare":
      return "card-finish-secret"
    case "radiant_rare":
      return "card-finish-radiant"
    case "ace_spec":
      return "card-finish-ace"
    case "amazing_rare":
      return "card-finish-amazing"
    case "shiny_rare":
      return "card-finish-shiny"
    case "jumbo":
      return "card-finish-holo"
    case "normal":
    default:
      return "card-finish-normal"
  }
}

export const BinderSlotGlare = memo(function BinderSlotGlare({
  glareStyle,
  innerRadius,
}: {
  glareStyle: CSSProperties
  innerRadius: string
}) {
  return (
    <>
      <div
        className="pointer-events-none absolute inset-[3px] z-[2] mix-blend-screen"
        style={{
          ...glareStyle,
          borderRadius: innerRadius,
          background:
            "radial-gradient(circle at var(--glint-x, 30%) var(--glint-y, 26%), rgba(255,255,255,0.3) 0%, rgba(125,211,252,0.12) 17%, rgba(244,114,182,0.08) 29%, rgba(255,255,255,0) 55%)",
          transform: "none",
          opacity: 0.28,
        } as CSSProperties}
      />
      <div
        className="pointer-events-none absolute inset-[3px] z-[2]"
        style={{
          borderRadius: innerRadius,
          background: "radial-gradient(circle at 18% 14%, rgba(255,255,255,0.24) 0%, rgba(255,255,255,0.09) 20%, rgba(255,255,255,0) 44%)",
        }}
      />
      <div
        className="pointer-events-none absolute inset-[3px] z-[3]"
        style={{
          borderRadius: innerRadius,
          background: "linear-gradient(180deg, rgba(255,255,255,0.12) 0%, rgba(255,255,255,0.05) 24%, rgba(255,255,255,0) 58%)",
        }}
      />
      <div
        className="animate-slot-glare-sweep pointer-events-none absolute -inset-x-[40%] -top-[30%] z-[3] h-[92%] rounded-[999px] transition-[transform,opacity] duration-150 ease-out"
        style={{
          ...glareStyle,
          "--glare-transform": glareStyle.transform,
          background:
            "linear-gradient(132deg, rgba(255,255,255,0.4) 0%, rgba(255,255,255,0.3) 12%, rgba(125,211,252,0.16) 23%, rgba(244,114,182,0.12) 32%, rgba(255,255,255,0.05) 43%, rgba(255,255,255,0) 62%)",
        } as CSSProperties}
      />
      <div
        className="pointer-events-none absolute inset-y-[8%] left-[8%] z-[3] w-[10%] rounded-[999px]"
        style={{
          background: "linear-gradient(180deg, rgba(255,255,255,0.28) 0%, rgba(255,255,255,0.1) 34%, rgba(255,255,255,0) 100%)",
          opacity: 0.34,
        }}
      />
    </>
  )
})

export const PokemonSlot = memo(function PokemonSlot({
  pokemon,
  isCollected,
  isWishlisted,
  isSelected,
  isLongPressed,
  slotLabel,
  status,
  cardImage,
  imageSizes = "25vw",
  cardName,
  cardFinish = "normal",
  hasAssignedCard,
  priceLabel,
  showPriceMode,
  readOnly,
  showBinderSlotGlare,
  showCardFinishEffects,
  binderSlotGlareStyle,
  cardFinishEffectStyle,
  cardFinishGlint,
  onClick,
  onDoubleClick,
  onLongPress,
  onAddCard,
  onAddWanted,
  onQuickCollect,
  onToggleFavorite,
  priority,
  buttonRef,
}: {
  pokemon: { id: number; name: string }
  isCollected: boolean
  isWishlisted: boolean
  isSelected: boolean
  isLongPressed: boolean
  slotLabel: string
  status?: SlotStatus
  imageSizes?: string
  cardImage?: string | null
  cardName?: string | null
  cardFinish?: CardFinish | null
  hasAssignedCard: boolean
  priceLabel?: string | null
  showPriceMode: boolean
  readOnly: boolean
  showBinderSlotGlare: boolean
  showCardFinishEffects: boolean
  binderSlotGlareStyle: CSSProperties
  cardFinishEffectStyle: CSSProperties
  cardFinishGlint: {
    x: number
    y: number
    angle: number
  }
  onClick: () => void
  onDoubleClick: () => void
  onLongPress: () => void
  onAddCard: () => void
  onAddWanted: () => void
  onQuickCollect: () => void
  onToggleFavorite: () => void
  user: User | null
  priority?: boolean
  buttonRef?: (node: HTMLButtonElement | null) => void
}) {
  const longPressTimer = useRef<NodeJS.Timeout | null>(null)
  const isLongPressTriggered = useRef(false)
  const touchStartPosition = useRef({ x: 0, y: 0 })

  const handleTouchStart = (event: ReactTouchEvent) => {
    const touch = event.touches[0]
    touchStartPosition.current = { x: touch.clientX, y: touch.clientY }
    if (readOnly) return
    isLongPressTriggered.current = false
    longPressTimer.current = setTimeout(() => {
      isLongPressTriggered.current = true
      onLongPress()
    }, 400)
  }

  const clearLongPressTimer = () => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current)
    }
  }

  const cardImageSource = getUsableImageSource(cardImage)
  const fallbackPreviewImage = getPokemonOfficialArtworkUrl(pokemon.id)
  const previewImage = resolveSlotImageUrl(pokemon.id, cardImage)
  const [failedPreviewImage, setFailedPreviewImage] = useState<string | null>(null)
  const [loadedPreviewImage, setLoadedPreviewImage] = useState<string | null>(null)
  const didFallbackPreviewImage = failedPreviewImage === previewImage
  const previewImageSrc = didFallbackPreviewImage ? fallbackPreviewImage : previewImage
  const isPreviewImageLoaded = loadedPreviewImage === previewImageSrc
  const isVisuallyCollected = isCollected && !isWishlisted
  const previewFitClass = "object-contain"
  const previewToneClass = isVisuallyCollected
    ? ""
    : isWishlisted
      ? "grayscale saturate-[0.75] brightness-[0.92] contrast-[0.95] opacity-90"
      : "grayscale"
  const titleLabel = isWishlisted && cardName ? cardName : pokemon.name
  const subtitleLabel = isWishlisted && cardName
    ? `Wanted for ${formatDexNumber(pokemon.id)}${showPriceMode && priceLabel ? ` • ${priceLabel}` : ""}`
    : `${formatDexNumber(pokemon.id)}${showPriceMode && priceLabel ? ` • ${priceLabel}` : ""}`
  const hasCardPreviewSource = Boolean(cardImageSource)
  const hasCardPreview = hasCardPreviewSource && !didFallbackPreviewImage
  const statusChip = isWishlisted
    ? {
        label: isCollected ? "Want" : "Wanted",
        className: "border-amber-400/50 bg-amber-500/90 text-white",
      }
    : status === "finalized"
      ? {
          label: "Perfect",
          className: "border-amber-400/50 bg-amber-500/90 text-white",
        }
      : status === "considering"
        ? {
            label: "Upgrade",
            className: "border-sky-400/50 bg-sky-500/90 text-white",
          }
        : isCollected
          ? {
              label: "Owned",
              className: "border-emerald-400/50 bg-emerald-500/90 text-white",
            }
          : null
  const showStatusChip = Boolean(statusChip)
  const cardPreviewPose = hasCardPreview ? getCardPreviewPose(pokemon.id) : null
  const previewSurfaceInsetClass = "inset-[3px]"
  const slotRadiusStyle = { borderRadius: TRADING_CARD_CORNER_RADIUS }
  const previewRadiusStyle = { borderRadius: TRADING_CARD_INNER_CORNER_RADIUS }
  const effectiveCardFinish = cardFinish ?? "normal"
  const slotCardFinishGlint = getSlotFinishGlint(cardFinishGlint, pokemon.id)
  const slotCardFinishEffectStyle = {
    ...cardFinishEffectStyle,
    "--glint-x": `${slotCardFinishGlint.x * 100}%`,
    "--glint-y": `${slotCardFinishGlint.y * 100}%`,
    "--glint-angle": `${slotCardFinishGlint.angle}deg`,
    "--glint-shift-x": `${(slotCardFinishGlint.x * 100 - 50) * 0.34}%`,
    "--glint-shift-y": `${(slotCardFinishGlint.y * 100 - 50) * 0.2}%`,
    "--glint-streak-x": `${(slotCardFinishGlint.x * 100 - 50) * 0.42}%`,
    "--slot-shader-opacity": String(0.56 + slotCardFinishGlint.intensity * 0.1),
    "--slot-mobile-sheen-opacity": String(0.2 + slotCardFinishGlint.intensity * 0.05),
  } as CSSProperties
  const finishEffectClass = getCardFinishEffectClass(effectiveCardFinish)
  const shouldShowCardFinish = Boolean(
    hasCardPreview &&
    isPreviewImageLoaded &&
    !didFallbackPreviewImage &&
    showCardFinishEffects &&
    effectiveCardFinish !== "normal"
  )
  const shouldShowPocketGlare = showBinderSlotGlare && !shouldShowCardFinish
  const quickActions = getBinderSlotQuickActions({ hasAssignedCard, readOnly })
  const handlePreviewImageError = (event: SyntheticEvent<HTMLImageElement>) => {
    if (previewImageSrc !== fallbackPreviewImage) {
      setFailedPreviewImage(previewImageSrc)
      return
    }

    event.currentTarget.style.visibility = "hidden"
  }


  return (
    <div className="relative group/slot">
      <button
        ref={buttonRef}
        data-dex-id={pokemon.id}
        aria-label={`${slotLabel} ${formatPokemonDisplayName(pokemon.name)} ${formatDexNumber(pokemon.id)}`}
        onClick={(event) => {
          if (event.detail !== 0 && isLongPressTriggered.current) {
            event.preventDefault()
            event.stopPropagation()
            return
          }
          onClick()
        }}
        onPointerDown={() => {
          isLongPressTriggered.current = false
          // Start loading the card's details (illustrator) as the finger goes down, before the sheet opens.
          if (hasAssignedCard) void loadCardsForPokemon(pokemon.id, "en").catch(() => undefined)
        }}
        onDoubleClick={onDoubleClick}
        onTouchStart={handleTouchStart}
        onTouchMove={(event) => {
          const touch = event.touches[0]
          if (getTouchGestureIntent(touch.clientX - touchStartPosition.current.x, touch.clientY - touchStartPosition.current.y).movedEnough) {
            clearLongPressTimer()
          }
        }}
        onTouchEnd={clearLongPressTimer}
        onTouchCancel={clearLongPressTimer}
        onContextMenu={(e) => {
          e.preventDefault()
          if (readOnly) return
          onLongPress()
        }}
        className={`relative isolate h-full w-full overflow-hidden transition-[transform,box-shadow] duration-150 group ${
          isSelected
            ? "ring-2 ring-primary ring-offset-1 ring-offset-background scale-[1.03] z-10"
            : isWishlisted
              ? "ring-1 ring-amber-500/40"
            : status === "finalized"
              ? "ring-1 ring-amber-500/60 shadow-[0_0_0_1px_rgba(245,158,11,0.18)]"
            : isVisuallyCollected && hasCardPreview
              ? "ring-1 ring-black/5 shadow-[0_6px_14px_rgba(15,23,42,0.04)] dark:ring-white/6 dark:shadow-[0_8px_18px_rgba(0,0,0,0.14)]"
              : isVisuallyCollected
              ? "ring-1 ring-green-500/40"
              : "hover:ring-1 hover:ring-primary/30 active:scale-[0.98]"
        }`}
        style={slotRadiusStyle}
      >
        <div
          className={`absolute inset-0 border shadow-[inset_0_1px_0_rgba(255,255,255,0.55),inset_0_-10px_18px_rgba(15,23,42,0.08)] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.08),inset_0_-10px_18px_rgba(0,0,0,0.24)] ${
            hasCardPreview
              ? "border-black/4 bg-transparent shadow-none dark:border-white/6 dark:shadow-none"
              : "border-white/55 bg-white/16 dark:border-white/10 dark:bg-white/[0.03]"
          }`}
          style={slotRadiusStyle}
        />
        {!hasCardPreview && (
          <div
            className={`absolute ${previewSurfaceInsetClass} border border-black/6 dark:border-white/8`}
            style={previewRadiusStyle}
          />
        )}
        {!hasCardPreview && (
          <div className={`absolute inset-0 transition-colors ${
            isVisuallyCollected
              ? "bg-gradient-to-br from-green-500/15 to-emerald-500/5"
              : isWishlisted
                ? "bg-gradient-to-br from-amber-500/12 to-orange-500/5"
                : "bg-gradient-to-br from-white/92 to-slate-100/88 dark:from-muted/80 dark:to-muted/40"
          }`} />
        )}

        <div className="absolute top-0.5 left-0.5 z-10 rounded bg-white/74 px-1 py-0.5 text-[7px] font-bold tabular-nums text-slate-600 sm:top-1 sm:left-1 sm:text-[8px] dark:bg-black/50 dark:text-white/70">
          {slotLabel}
        </div>

        {!hasCardPreview && (
          <div className="absolute inset-x-[7px] top-[7px] h-px bg-white/65 dark:bg-white/10" />
        )}

        {shouldShowPocketGlare ? (
          <BinderSlotGlare
            glareStyle={binderSlotGlareStyle}
            innerRadius={TRADING_CARD_INNER_CORNER_RADIUS}
          />
        ) : null}

        {hasCardPreview ? (
          <div
            className="absolute inset-0 z-[1] overflow-hidden"
            style={{
              borderRadius: TRADING_CARD_CORNER_RADIUS,
            }}
          >
            <CardImage
              fill
              sizes={imageSizes}
              key={previewImageSrc}
              src={previewImageSrc}
              alt={cardName || pokemon.name}
              className={`h-full w-full ${didFallbackPreviewImage ? "object-contain p-3 opacity-85" : "object-contain"} ${previewToneClass}`}
              loading="eager"
              fetchPriority={priority ? "high" : "auto"}
              decoding="async"
              draggable={false}
              onLoad={() => setLoadedPreviewImage(previewImageSrc)}
              onError={handlePreviewImageError}
            />
            {shouldShowCardFinish ? (
              <CardFinishShader
                finish={effectiveCardFinish}
                glintX={slotCardFinishGlint.x}
                glintY={slotCardFinishGlint.y}
                glintAngle={slotCardFinishGlint.angle}
                glintPhase={slotCardFinishGlint.phase}
                patternSeed={slotCardFinishGlint.patternSeed}
                finishIntensity={slotCardFinishGlint.intensity}
                hueOffset={slotCardFinishGlint.hueOffset}
                patternScale={slotCardFinishGlint.patternScale}
                fallbackClassName={finishEffectClass}
                fallbackStyle={slotCardFinishEffectStyle}
              />
            ) : null}
          </div>
        ) : (
          <div
            className={`absolute ${previewSurfaceInsetClass} z-[1] overflow-hidden`}
            style={{
              ...previewRadiusStyle,
              ...(cardPreviewPose ? { transform: cardPreviewPose, transformOrigin: "center center" } : {}),
            }}
          >
            <CardImage
              fill
              sizes={imageSizes}
              key={previewImageSrc}
              src={previewImageSrc}
              alt={cardName || pokemon.name}
              className={`h-full w-full ${previewFitClass} ${previewToneClass} group-hover:scale-[1.025] transition-transform duration-150`}
              loading="eager"
              fetchPriority={priority ? "high" : "auto"}
              decoding="async"
              draggable={false}
              onLoad={() => setLoadedPreviewImage(previewImageSrc)}
              onError={handlePreviewImageError}
            />
          </div>
        )}

        {!hasCardPreview && (
          <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 via-black/30 to-transparent p-1 sm:p-1.5">
            <p className="text-[8px] sm:text-[10px] text-white/90 font-semibold truncate capitalize leading-tight">
              {titleLabel}
            </p>
            <p className="text-[7px] sm:text-[9px] text-white/50 tabular-nums">
              {subtitleLabel}
            </p>
          </div>
        )}

        {showStatusChip && statusChip && (
          <div
            className={`absolute top-1 right-1 z-10 rounded-full border px-2 py-0.5 text-[7px] font-semibold uppercase tracking-[0.14em] shadow-none sm:top-1.5 sm:right-1.5 sm:text-[8px] ${statusChip.className}`}
          >
            {statusChip.label}
          </div>
        )}
      </button>

      {quickActions.canShowActions ? (
        <div className="pointer-events-none absolute inset-x-1.5 bottom-1.5 z-20 hidden translate-y-1 items-center justify-center gap-1 opacity-0 transition-all duration-150 sm:flex sm:group-hover/slot:pointer-events-auto sm:group-hover/slot:translate-y-0 sm:group-hover/slot:opacity-100 sm:group-focus-within/slot:pointer-events-auto sm:group-focus-within/slot:translate-y-0 sm:group-focus-within/slot:opacity-100">
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation()
              onAddCard()
            }}
            aria-label={`${quickActions.addAccessibleLabel} for ${pokemon.name}`}
            className="flex h-7 min-w-0 flex-1 items-center justify-center gap-1 rounded-full border border-emerald-300/45 bg-emerald-500/92 px-2 text-[10px] font-bold text-white shadow-[0_8px_18px_-12px_rgba(16,185,129,0.9)] backdrop-blur transition-colors hover:bg-emerald-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80"
          >
            <Check className="h-3 w-3 shrink-0" />
            <span className="truncate">{quickActions.addLabel}</span>
          </button>
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation()
              onAddWanted()
            }}
            aria-label={`${quickActions.wantAccessibleLabel} for ${pokemon.name}`}
            className="flex h-7 min-w-0 flex-1 items-center justify-center gap-1 rounded-full border border-amber-300/45 bg-amber-500/92 px-2 text-[10px] font-bold text-white shadow-[0_8px_18px_-12px_rgba(245,158,11,0.9)] backdrop-blur transition-colors hover:bg-amber-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80"
          >
            <Heart className="h-3 w-3 shrink-0 fill-current" />
            <span className="truncate">{quickActions.wantLabel}</span>
          </button>
        </div>
      ) : null}

      {!readOnly && isLongPressed && (
        <div className="absolute -top-10 left-1/2 z-30 hidden -translate-x-1/2 animate-scale-in sm:block">
          <div className="flex max-w-[min(22rem,calc(100vw-1rem))] items-center gap-1 rounded-full border border-border/50 bg-card/95 p-1 shadow-xl backdrop-blur-lg">
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation()
                onAddCard()
              }}
              className="flex h-7 items-center gap-1 rounded-full bg-emerald-500/10 px-2.5 text-xs font-medium text-emerald-600 transition-all hover:bg-emerald-500/20 dark:text-emerald-300"
            >
              <Check className="h-3 w-3" />
              {quickActions.addLabel}
            </button>
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation()
                onAddWanted()
              }}
              className="flex h-7 items-center gap-1 rounded-full bg-amber-500/10 px-2.5 text-xs font-medium text-amber-600 transition-all hover:bg-amber-500/20 dark:text-amber-300"
            >
              <Heart className="h-3 w-3 fill-current" />
              {quickActions.wantLabel}
            </button>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onQuickCollect(); }}
              className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium transition-all ${
                isCollected
                  ? "bg-destructive/10 text-destructive hover:bg-destructive/20"
                  : "bg-green-500/10 text-green-500 hover:bg-green-500/20"
              }`}
            >
              {isCollected ? <X className="w-3 h-3" /> : <Check className="w-3 h-3" />}
              {isCollected ? "Remove" : "Got it"}
            </button>
            {isCollected && hasAssignedCard && (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onToggleFavorite(); }}
                className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium transition-all ${
                  status === 'finalized'
                    ? "bg-amber-500/10 text-amber-500 hover:bg-amber-500/20"
                    : "bg-muted text-muted-foreground hover:bg-muted/80"
                }`}
              >
                {status === 'finalized' ? (
                  <><Star className="w-3 h-3 fill-current" /> Perfect</>
                ) : (
                  <><Star className="w-3 h-3" /> Fav</>
                )}
              </button>
            )}
          </div>
          <div className="absolute left-1/2 -translate-x-1/2 -bottom-1.5 w-3 h-3 bg-card/95 border-r border-b border-border/50 rotate-45" />
        </div>
      )}
    </div>
  )
})
