"use client"

import type { CSSProperties } from "react"
import { Sparkles } from "lucide-react"
import { GENERATIONS, type CollectionViewFilter } from "@/components/binder/binder-app-model"
import type { BinderSettings } from "@/hooks/use-settings"
import type { PokemonEntry } from "@/lib/pokemon-catalog"
import type { BinderColorTheme } from "@/lib/binder-colors"
import styles from "./spread-info-page.module.css"

export interface SpreadInfoPageContext {
  activeCollectionFilterOption: { id: CollectionViewFilter; label: string; mobileLabel: string; description: string }
  collectionStats: { collected: number; total: number; percentage: number }
  neededCount: number
  perfectCount: number
  canEditBinder: boolean
  filteredPokemonList: PokemonEntry[]
  filteredTotalLabel: string
  getBinderThemeForPage: (pageNumber?: number | null | undefined) => BinderColorTheme
  hasTrackedCards: boolean
  selectedGen: number
  settings: BinderSettings
  totalBinderPages: number
}

export function renderSpreadInfoPageView(ctx: SpreadInfoPageContext, side: "left" | "right") {
  const { activeCollectionFilterOption, collectionStats, neededCount, perfectCount, canEditBinder, filteredPokemonList, filteredTotalLabel, getBinderThemeForPage, hasTrackedCards, selectedGen, settings, totalBinderPages } = ctx
  const pageTheme = getBinderThemeForPage(0)

  return (
    <section key={`spread-info-${side}`} aria-label="Inside cover" className={styles.cover} style={{ background: pageTheme.background, borderColor: pageTheme.border, boxShadow: pageTheme.shadow }}>
      <div className={styles.paper}>
        <div className={styles.content}>
          <header className={styles.header}>
            <div className={styles.brand}><span className={styles.emblem} aria-hidden="true"><Sparkles /></span>Holo Folder<span className={styles.edition}>Inside cover</span></div>
            <h2>Your collection,<br />beautifully kept.</h2>
            <p>{selectedGen === 0 ? "National Dex" : GENERATIONS[selectedGen].name}<span className={styles.separator}>/</span>{settings.binderRows} × {settings.binderCols} pockets</p>
          </header>

          <div className={styles.progress} role="progressbar" aria-label="Collection completion" aria-valuemin={0} aria-valuemax={100} aria-valuenow={collectionStats.percentage} aria-valuetext={`${collectionStats.collected} of ${collectionStats.total} Pokémon collected`}>
            <div className={styles.orbit} aria-hidden="true" />
            <div className={styles.ring} style={{ "--completion": `${collectionStats.percentage}%` } as CSSProperties} aria-hidden="true" />
            <div className={styles.progressLabel} aria-hidden="true"><strong>{collectionStats.percentage}<span>%</span></strong><span>complete</span></div>
          </div>

          <dl className={styles.stats}>
            <div><dt>Collected</dt><dd>{collectionStats.collected} <span>/ {collectionStats.total}</span></dd></div>
            <div><dt>Needed</dt><dd>{neededCount}</dd></div>
            <div><dt>Perfect</dt><dd>{perfectCount}<Sparkles aria-hidden="true" /></dd></div>
          </dl>

          {hasTrackedCards && filteredTotalLabel && <div className={styles.value}><span>Tracked value</span><strong>{filteredTotalLabel}</strong></div>}

          <footer className={styles.footer}>
            <p><span>{activeCollectionFilterOption.label}</span><span>{totalBinderPages} pages</span><span>{filteredPokemonList.length} Pokémon</span>{!canEditBinder && <span>Read-only</span>}</p>
            <p className={styles.hint}>{canEditBinder ? "Every empty pocket is a possibility." : "A collection to explore. Shared read-only."}</p>
          </footer>
        </div>
      </div>
    </section>
  )
}
