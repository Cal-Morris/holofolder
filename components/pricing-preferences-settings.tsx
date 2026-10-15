"use client"

import { useId, useMemo } from "react"
import { Globe2 } from "lucide-react"
import type { BinderSettings } from "@/hooks/use-settings"
import type { CardLanguage } from "@/lib/card-pricing"
import {
  CARD_LANGUAGE_LABELS,
  DISPLAY_CURRENCIES,
  PREFERRED_CARD_LANGUAGES,
  PRICING_REGIONS,
  PRICING_REGION_LABELS,
  getBrowserLocales,
  normalizeDisplayCurrency,
  normalizePreferredCardLanguage,
  normalizePricingRegion,
  resolvePricingPreferences,
} from "@/lib/pricing-region"

type PricingSettings = Pick<BinderSettings, "pricingRegion" | "preferredCurrency" | "preferredCardLanguage">

interface PricingPreferencesSettingsProps {
  settings: PricingSettings
  onUpdateSettings: (settings: Partial<BinderSettings>) => void
  /** Injected in tests; defaults to the browser locale list. */
  locales?: readonly string[] | null
}

const AUTO = "auto"
const selectClassName =
  "h-12 w-full appearance-none rounded-2xl border border-border/60 bg-background/70 px-3 text-base font-medium outline-none focus:border-primary/60 sm:h-11 sm:text-sm"

export function PricingPreferencesSettings({ settings, onUpdateSettings, locales }: PricingPreferencesSettingsProps) {
  const baseId = useId()
  const browserLocales = useMemo(() => locales ?? getBrowserLocales(), [locales])
  const resolved = resolvePricingPreferences(settings, browserLocales)
  const automaticRegion = resolvePricingPreferences({ ...settings, pricingRegion: null }, browserLocales).region
  const automaticCurrency = resolvePricingPreferences({ ...settings, preferredCurrency: null }, browserLocales).currency
  const automaticLanguage = resolvePricingPreferences({ ...settings, preferredCardLanguage: null }, browserLocales).cardLanguage

  return (
    <section aria-labelledby={`${baseId}-title`} className="space-y-3">
      <div className="flex items-center gap-2">
        <Globe2 className="h-4 w-4 text-primary" aria-hidden="true" />
        <h3 id={`${baseId}-title`} className="font-semibold">Region &amp; pricing</h3>
      </div>
      <p className="text-xs leading-relaxed text-muted-foreground">
        Prices lead with your region&apos;s own market and currency, with the converted price after it.
      </p>

      <div className="grid gap-3">
        <div className="grid gap-1.5">
          <label htmlFor={`${baseId}-region`} className="text-sm font-medium">Region</label>
          <select
            id={`${baseId}-region`}
            className={selectClassName}
            value={settings.pricingRegion ?? AUTO}
            onChange={(event) => onUpdateSettings({ pricingRegion: normalizePricingRegion(event.target.value) })}
          >
            <option value={AUTO}>Automatic ({PRICING_REGION_LABELS[automaticRegion]})</option>
            {PRICING_REGIONS.map((region) => (
              <option key={region} value={region}>{PRICING_REGION_LABELS[region]}</option>
            ))}
          </select>
        </div>

        <div className="grid gap-1.5">
          <label htmlFor={`${baseId}-currency`} className="text-sm font-medium">Currency</label>
          <select
            id={`${baseId}-currency`}
            className={selectClassName}
            value={settings.preferredCurrency ?? AUTO}
            onChange={(event) => onUpdateSettings({ preferredCurrency: normalizeDisplayCurrency(event.target.value) })}
          >
            <option value={AUTO}>From region ({automaticCurrency})</option>
            {DISPLAY_CURRENCIES.map((currency) => (
              <option key={currency} value={currency}>{currency}</option>
            ))}
          </select>
        </div>

        <div className="grid gap-1.5">
          <label htmlFor={`${baseId}-language`} className="text-sm font-medium">Card language</label>
          <select
            id={`${baseId}-language`}
            className={selectClassName}
            value={settings.preferredCardLanguage ?? AUTO}
            onChange={(event) => onUpdateSettings({ preferredCardLanguage: normalizePreferredCardLanguage(event.target.value) })}
          >
            <option value={AUTO}>Automatic ({CARD_LANGUAGE_LABELS[automaticLanguage]})</option>
            {PREFERRED_CARD_LANGUAGES.map((language: CardLanguage) => (
              <option key={language} value={language}>{CARD_LANGUAGE_LABELS[language]}</option>
            ))}
          </select>
        </div>
      </div>

      <p className="text-xs text-muted-foreground" data-testid="pricing-preferences-summary">
        Showing {PRICING_REGION_LABELS[resolved.region]} prices in {resolved.currency}; new cards default to {CARD_LANGUAGE_LABELS[resolved.cardLanguage]}.
      </p>
    </section>
  )
}
