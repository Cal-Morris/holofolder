import test from "node:test"
import assert from "node:assert/strict"
import {
  cardLanguageFromLocale,
  normalizeDisplayCurrency,
  normalizePreferredCardLanguage,
  normalizePricingRegion,
  regionFromLocale,
  resolvePricingPreferences,
} from "../lib/pricing-region"
import {
  DEFAULT_BINDER_SETTINGS,
  isMissingColumnError,
  normalizeBinderSettings,
  settingsFromRow,
  settingsToRow,
  withoutPricingPreferenceColumns,
} from "../lib/settings"

test("an en-GB browser resolves to UK, GBP and English cards", () => {
  assert.deepEqual(resolvePricingPreferences(null, ["en-GB", "en"]), {
    region: "UK",
    currency: "GBP",
    cardLanguage: "en",
    regionIsAutomatic: true,
    currencyIsAutomatic: true,
    cardLanguageIsAutomatic: true,
  })
})

test("locale country picks the region", () => {
  assert.equal(regionFromLocale("en-US"), "US")
  assert.equal(regionFromLocale("es-US"), "US")
  assert.equal(regionFromLocale("fr-FR"), "EU")
  assert.equal(regionFromLocale("de-AT"), "EU")
  assert.equal(regionFromLocale("en-IE"), "EU")
  assert.equal(regionFromLocale("ja-JP"), "JP")
  assert.equal(regionFromLocale("en_GB"), "UK")
  assert.equal(regionFromLocale("zh-Hant-TW"), "UK")
  assert.equal(regionFromLocale("cy-GB"), "UK")
})

test("without a usable country the language decides, then the UK default", () => {
  assert.equal(regionFromLocale("ja"), "JP")
  assert.equal(regionFromLocale("de"), "EU")
  assert.equal(regionFromLocale("en"), "UK")
  assert.equal(regionFromLocale("es-419"), "EU")
  assert.equal(regionFromLocale([]), "UK")
  assert.equal(regionFromLocale(null), "UK")
})

test("card language follows the locale when the catalogue has it", () => {
  assert.equal(cardLanguageFromLocale("fr-CA"), "fr")
  assert.equal(cardLanguageFromLocale("ja-JP"), "ja")
  assert.equal(cardLanguageFromLocale("ko-KR"), "ko")
  assert.equal(cardLanguageFromLocale("pt-BR"), "pt-br")
  assert.equal(cardLanguageFromLocale("pt-PT"), "en")
  assert.equal(cardLanguageFromLocale("nl-NL"), "en")
  assert.equal(cardLanguageFromLocale(undefined), "en")
})

test("currency derives from the region unless overridden", () => {
  assert.equal(resolvePricingPreferences({ pricingRegion: "US" }, ["en-GB"]).currency, "USD")
  assert.equal(resolvePricingPreferences({ pricingRegion: "EU" }, ["en-GB"]).currency, "EUR")
  assert.equal(resolvePricingPreferences({ pricingRegion: "JP" }, null).currency, "JPY")
  const overridden = resolvePricingPreferences({ pricingRegion: "UK", preferredCurrency: "USD" }, ["en-GB"])
  assert.equal(overridden.currency, "USD")
  assert.equal(overridden.currencyIsAutomatic, false)
  // A region picked explicitly wins over the locale.
  assert.equal(resolvePricingPreferences({ pricingRegion: "US" }, ["ja-JP"]).region, "US")
  // Language override wins over the locale.
  assert.equal(resolvePricingPreferences({ preferredCardLanguage: "ja" }, ["en-GB"]).cardLanguage, "ja")
})

test("normalizers reject unknown values", () => {
  assert.equal(normalizePricingRegion("uk"), "UK")
  assert.equal(normalizePricingRegion("CA"), null)
  assert.equal(normalizeDisplayCurrency("cad"), null)
  assert.equal(normalizeDisplayCurrency("jpy"), "JPY")
  assert.equal(normalizePreferredCardLanguage("PT-BR"), "pt-br")
  assert.equal(normalizePreferredCardLanguage("zh"), null)
})

test("settings default the pricing preferences to automatic and round-trip them", () => {
  assert.equal(DEFAULT_BINDER_SETTINGS.pricingRegion, null)
  assert.equal(DEFAULT_BINDER_SETTINGS.preferredCurrency, null)
  assert.equal(DEFAULT_BINDER_SETTINGS.preferredCardLanguage, null)

  const row = settingsToRow({ ...DEFAULT_BINDER_SETTINGS, pricingRegion: "JP", preferredCurrency: "GBP", preferredCardLanguage: "ja" })
  assert.equal(row.pricing_region, "JP")
  assert.equal(settingsFromRow(row).preferredCardLanguage, "ja")
  assert.equal(settingsFromRow({ pricing_region: "Mars", preferred_currency: "BTC", preferred_card_language: "xx" }).pricingRegion, null)
})

test("local settings caches from before this change keep automatic pricing", () => {
  const fallback = { ...DEFAULT_BINDER_SETTINGS, binderPageColors: {} }
  const legacy = normalizeBinderSettings({ binderRows: 3, binderCols: 3 }, fallback)
  assert.equal(legacy.pricingRegion, null)
  const cleared = normalizeBinderSettings({ pricingRegion: null }, { ...fallback, pricingRegion: "US" })
  assert.equal(cleared.pricingRegion, null)
})

test("missing-column errors are detected so the API can fall back before migration 024", () => {
  assert.equal(isMissingColumnError({ code: "42703", message: "column user_settings.pricing_region does not exist" }), true)
  assert.equal(isMissingColumnError({ code: "PGRST204", message: "Could not find the 'pricing_region' column" }), true)
  assert.equal(isMissingColumnError({ code: "23505", message: "duplicate key" }), false)
  assert.equal(isMissingColumnError(null), false)

  const legacyRow = withoutPricingPreferenceColumns(settingsToRow(DEFAULT_BINDER_SETTINGS))
  assert.deepEqual(Object.keys(legacyRow).filter((key) => key.startsWith("pricing") || key.startsWith("preferred")), [])
  assert.equal(legacyRow.dark_mode, true)
})
