/**
 * Pricing region, display currency and preferred card language.
 *
 * Each preference is stored as an explicit choice or `null` ("automatic"). Automatic values are
 * resolved on the device from the browser locale:
 *   - region: locale country (GB/UK, IM, JE, GG -> UK; EU member states -> EU; US, PR -> US;
 *     JP -> JP). Without a usable country: ja -> JP; fr/de/es/it/nl/pt -> EU; otherwise UK
 *     (the app's home market, prices are cached in GBP).
 *   - currency: derived from the region (UK GBP, EU EUR, US USD, JP JPY) unless overridden.
 *   - card language: locale language when the TCG catalogue has it (pt-BR -> pt-br), else en.
 * So an en-GB browser resolves to UK / GBP / English.
 */
import type { CardLanguage } from '@/lib/card-pricing';

export const PRICING_REGIONS = ['UK', 'EU', 'US', 'JP'] as const;
export type PricingRegion = (typeof PRICING_REGIONS)[number];

export const DISPLAY_CURRENCIES = ['GBP', 'EUR', 'USD', 'JPY'] as const;
export type DisplayCurrency = (typeof DISPLAY_CURRENCIES)[number];

export const PREFERRED_CARD_LANGUAGES: CardLanguage[] = ['en', 'fr', 'de', 'es', 'it', 'pt-br', 'ja', 'ko'];

export const DEFAULT_PRICING_REGION: PricingRegion = 'UK';

export const REGION_CURRENCY: Record<PricingRegion, DisplayCurrency> = {
  UK: 'GBP',
  EU: 'EUR',
  US: 'USD',
  JP: 'JPY',
};

export const PRICING_REGION_LABELS: Record<PricingRegion, string> = {
  UK: 'United Kingdom',
  EU: 'European Union',
  US: 'United States',
  JP: 'Japan',
};

export const CARD_LANGUAGE_LABELS: Record<CardLanguage, string> = {
  en: 'English',
  fr: 'French',
  de: 'German',
  es: 'Spanish',
  it: 'Italian',
  'pt-br': 'Portuguese (BR)',
  ja: 'Japanese',
  ko: 'Korean',
};

const UK_COUNTRIES = new Set(['GB', 'UK', 'IM', 'JE', 'GG']);
const EU_COUNTRIES = new Set([
  'AT',
  'BE',
  'BG',
  'HR',
  'CY',
  'CZ',
  'DK',
  'EE',
  'FI',
  'FR',
  'DE',
  'GR',
  'HU',
  'IE',
  'IT',
  'LV',
  'LT',
  'LU',
  'MT',
  'NL',
  'PL',
  'PT',
  'RO',
  'SK',
  'SI',
  'ES',
  'SE',
]);
const US_COUNTRIES = new Set(['US', 'PR']);
const EU_LANGUAGES = new Set(['fr', 'de', 'es', 'it', 'nl', 'pt']);

export interface PricingPreferences {
  pricingRegion: PricingRegion | null;
  preferredCurrency: DisplayCurrency | null;
  preferredCardLanguage: CardLanguage | null;
}

export interface ResolvedPricingPreferences {
  region: PricingRegion;
  currency: DisplayCurrency;
  cardLanguage: CardLanguage;
  regionIsAutomatic: boolean;
  currencyIsAutomatic: boolean;
  cardLanguageIsAutomatic: boolean;
}

export function normalizePricingRegion(value: unknown): PricingRegion | null {
  return typeof value === 'string' && (PRICING_REGIONS as readonly string[]).includes(value.toUpperCase())
    ? (value.toUpperCase() as PricingRegion)
    : null;
}

export function normalizeDisplayCurrency(value: unknown): DisplayCurrency | null {
  return typeof value === 'string' && (DISPLAY_CURRENCIES as readonly string[]).includes(value.toUpperCase())
    ? (value.toUpperCase() as DisplayCurrency)
    : null;
}

export function normalizePreferredCardLanguage(value: unknown): CardLanguage | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  return (PREFERRED_CARD_LANGUAGES as string[]).includes(normalized) ? (normalized as CardLanguage) : null;
}

function parseLocale(locale: string) {
  const parts = locale.trim().replace(/_/g, '-').split('-').filter(Boolean);
  const language = (parts[0] ?? '').toLowerCase();
  // Country is the first 2-letter (or UN M.49 digits, ignored) subtag after the language/script.
  const country =
    parts
      .slice(1)
      .find((part) => /^[a-z]{2}$/i.test(part))
      ?.toUpperCase() ?? null;
  return { language, country };
}

function firstLocale(locales: readonly string[] | string | null | undefined) {
  const list = typeof locales === 'string' ? [locales] : (locales ?? []);
  return list.find((locale) => typeof locale === 'string' && locale.trim().length > 0) ?? null;
}

export function regionFromLocale(locales: readonly string[] | string | null | undefined): PricingRegion {
  const locale = firstLocale(locales);
  if (!locale) return DEFAULT_PRICING_REGION;

  const { language, country } = parseLocale(locale);
  if (country) {
    if (UK_COUNTRIES.has(country)) return 'UK';
    if (EU_COUNTRIES.has(country)) return 'EU';
    if (US_COUNTRIES.has(country)) return 'US';
    if (country === 'JP') return 'JP';
  }

  if (language === 'ja') return 'JP';
  if (EU_LANGUAGES.has(language)) return 'EU';
  return DEFAULT_PRICING_REGION;
}

export function cardLanguageFromLocale(locales: readonly string[] | string | null | undefined): CardLanguage {
  const locale = firstLocale(locales);
  if (!locale) return 'en';

  const { language, country } = parseLocale(locale);
  if (language === 'pt') return country === 'BR' ? 'pt-br' : 'en';
  return normalizePreferredCardLanguage(language) ?? 'en';
}

export function resolvePricingPreferences(
  preferences: Partial<PricingPreferences> | null | undefined,
  locales: readonly string[] | string | null | undefined,
): ResolvedPricingPreferences {
  const explicitRegion = normalizePricingRegion(preferences?.pricingRegion);
  const explicitCurrency = normalizeDisplayCurrency(preferences?.preferredCurrency);
  const explicitLanguage = normalizePreferredCardLanguage(preferences?.preferredCardLanguage);
  const region = explicitRegion ?? regionFromLocale(locales);

  return {
    region,
    currency: explicitCurrency ?? REGION_CURRENCY[region],
    cardLanguage: explicitLanguage ?? cardLanguageFromLocale(locales),
    regionIsAutomatic: explicitRegion == null,
    currencyIsAutomatic: explicitCurrency == null,
    cardLanguageIsAutomatic: explicitLanguage == null,
  };
}

/** Browser locale list, or null during SSR. */
export function getBrowserLocales(): readonly string[] | null {
  if (typeof navigator === 'undefined') return null;
  if (Array.isArray(navigator.languages) && navigator.languages.length > 0) return navigator.languages;
  return navigator.language ? [navigator.language] : null;
}
