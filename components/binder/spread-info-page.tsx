"use client"

import { GENERATIONS } from "@/components/binder/binder-app-model"
import type { BinderSettings } from "@/hooks/use-settings"
import type { PokemonEntry } from "@/lib/pokemon-catalog"
import type { CollectionViewFilter } from "@/components/binder/binder-app-model"
import type { BinderColorTheme } from "@/lib/binder-colors"

export interface SpreadInfoPageContext {
  activeCollectionFilterOption: { id: CollectionViewFilter; label: string; mobileLabel: string; description: string; }
  binderIntroStats: { label: string; value: string; }[]
  canEditBinder: boolean
  filteredPokemonList: PokemonEntry[]
  filteredTotalLabel: string
  getBinderThemeForPage: (pageNumber?: number | null | undefined) => BinderColorTheme
  hasTrackedCards: boolean
  isDarkMode: boolean
  isDesktopViewport: boolean
  isSpreadLayout: boolean
  selectedGen: number
  settings: BinderSettings
  totalBinderPages: number
}

export function renderSpreadInfoPageView(ctx: SpreadInfoPageContext, side: "left" | "right") {
  const { activeCollectionFilterOption, binderIntroStats, canEditBinder, filteredPokemonList, filteredTotalLabel, getBinderThemeForPage, hasTrackedCards, isDarkMode, isDesktopViewport, isSpreadLayout, selectedGen, settings, totalBinderPages } = ctx
  const pageTheme = getBinderThemeForPage(0)
  const spreadPanelClass = isDarkMode
    ? "border-white/10 bg-background/58"
    : "border-black/6 bg-white/84 shadow-[0_18px_44px_-34px_rgba(15,23,42,0.26)]"
  const spreadStatClass = isDarkMode
    ? "border-white/10 bg-background/52"
    : "border-black/6 bg-white/78 shadow-[0_16px_38px_-32px_rgba(15,23,42,0.22)]"
  const middleRowSpan = Math.max(settings.binderRows - 2, 1)

  return (
    <div key={`spread-info-${side}`} className="relative h-full w-full overflow-hidden rounded-2xl">
      <div
        className="absolute inset-0 rounded-2xl border"
        style={{
          background: pageTheme.background,
          borderColor: pageTheme.border,
          boxShadow: pageTheme.shadow,
        }}
      />
      <div
        className="absolute inset-0 rounded-2xl"
        style={{ background: pageTheme.gloss }}
      />
      {(isSpreadLayout || isDesktopViewport) && (
        <div className={`absolute top-3 z-10 rounded-full border border-white/15 bg-black/25 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-white/78 backdrop-blur-sm ${side === "left" ? "left-3" : "right-3"}`}>
          Page 0
        </div>
      )}
      <div
        className="absolute inset-0 p-2 sm:p-4"
        style={{
          display: "grid",
          gridTemplateColumns: `repeat(${settings.binderCols}, minmax(0, 1fr))`,
          gridTemplateRows: `repeat(${settings.binderRows}, minmax(0, 1fr))`,
          gap: "0.375rem",
        }}
      >
        <div
          className={`min-h-0 rounded-[1.15rem] border px-4 py-3 backdrop-blur-md ${spreadPanelClass}`}
          style={{
            gridColumn: "1 / -1",
            gridRow: "1 / span 1",
          }}
        >
          <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-muted-foreground">Inside Cover</p>
          <h2 className="mt-2 text-[clamp(1.35rem,2.2vw,2rem)] font-semibold tracking-tight">Holo Folder</h2>
          <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
            {selectedGen === 0 ? "National Dex binder" : `${GENERATIONS[selectedGen].name} binder`} with {settings.binderRows}x{settings.binderCols} slots per page.
          </p>
        </div>

        <div
          className="grid min-h-0 grid-cols-2 gap-2"
          style={{
            gridColumn: "1 / -1",
            gridRow: `2 / span ${middleRowSpan}`,
          }}
        >
          {binderIntroStats.map((stat) => (
            <div
              key={stat.label}
              className={`min-h-0 rounded-[1rem] border px-3 py-3 backdrop-blur-sm ${spreadStatClass}`}
            >
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">{stat.label}</p>
              <p className="mt-1 text-lg font-semibold tabular-nums sm:text-[1.4rem]">{stat.value}</p>
            </div>
          ))}
        </div>

        <div
          className={`min-h-0 space-y-1.5 rounded-[1.15rem] border px-4 py-3 text-sm backdrop-blur-sm ${spreadStatClass}`}
          style={{
            gridColumn: "1 / -1",
            gridRow: `${settings.binderRows} / span 1`,
          }}
        >
          <div className="flex items-center justify-between gap-3">
            <span className="text-muted-foreground">Visible mode</span>
            <span className="font-medium">{activeCollectionFilterOption.label}</span>
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="text-muted-foreground">Binder pages</span>
            <span className="font-medium tabular-nums">{totalBinderPages}</span>
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="text-muted-foreground">Visible Pokemon</span>
            <span className="font-medium tabular-nums">{filteredPokemonList.length}</span>
          </div>
          {hasTrackedCards && filteredTotalLabel ? (
            <div className="flex items-center justify-between gap-3">
              <span className="text-muted-foreground">Tracked value</span>
              <span className="font-medium">{filteredTotalLabel}</span>
            </div>
          ) : null}
          <p className="pt-1 text-[11px] leading-relaxed text-muted-foreground">
            {canEditBinder
              ? "Open any slot to collect, wishlist, or swap a card. Wide screens show facing pages like a real binder."
              : "This shared binder is read-only. Search and browse pages, but edits stay disabled."}
          </p>
        </div>
      </div>
    </div>
  )
}
