---
name: pricing-signal-changes
description: Change holofolder price providers, normalisation, confidence rules, buy signals, or the Rising and Breakout momentum scoring without inventing data or showing signals on weak evidence. Use for any change under lib/card-pricing.ts, lib/price-*.ts, lib/breakout-cards.ts or the price UI.
---

# Pricing signal changes

## Where things live

| File | Role |
|---|---|
| `lib/card-pricing.ts` | Provider fetches, FX (`parseEcbFxRates`), `readPriceAmount`, and the **single source** of pricing types and normalizers. `hooks/use-card-prices.ts` re-exports them and adds only client batching and the localStorage cache. |
| `lib/price-intelligence.ts` | `PriceProvider`, observation match scoring, `summarizePriceObservations`, `buildBuySignal` |
| `lib/price-freshness.ts` | Staleness caps and the last-known-price carry-forward |
| `lib/price-momentum.ts` | Rising rules and thresholds |
| `lib/breakout-cards.ts` | Breakout ranking |
| `lib/price-refresh-interval.ts` | Refresh interval validation (`15m`–`24h`, default `3h`) |
| `workflows/card-price-refresh.ts`, `app/api/card-prices/` | Refresh workflow, cron (`GET`, `CRON_SECRET`) and on-demand (`POST`) |

## Rules you must keep

- **Never invent prices.**
  - A usable amount is finite and > 0; zero, negative and NaN mean missing.
  - A missing or out-of-bounds FX rate means unpriced, never a guessed rate.
  - Test fixtures are labelled synthetic.
- **Confidence gates.** Rising, Breakout and the `rising` buy signal require **high or medium** confidence, never low or unknown.
- **Staleness.**
  - Provider data older than 7 days caps confidence at medium and can't call a trend.
  - Data older than 30 days caps it at low.
  - An empty refresh keeps the last known price for up to 30 days, at low confidence.
  - Caps only lower, never raise.
- **Momentum** (`lib/price-momentum.ts`):
  - Compare within a single source, never mixing providers or currencies.
  - Rising means ≥ +10% vs the 7d average, or ≥ +15% vs the 30d average.
  - Current and baseline prices must both be ≥ £1. A change above +300% is treated as a data error. A 30d rise is ignored if the 7d change is negative.
- **Breakout** (`lib/breakout-cards.ts`):
  - Uses the Rising gates.
  - Score = change × timeframe weight (7d = 1, 30d = 0.5).
  - Ties go to higher confidence, then higher price, then card id.
  - At most 10 printing/finish entries. Exact-finish rankings use finish-specific evidence, and ambiguous foil quotes are excluded. The section is hidden when nothing qualifies, and only shown on the unfiltered All view.
- **Provider list parity.** The server `PriceProvider`, the client sources and the SQL CHECK constraints must match. `tests/price-provider-sources.test.ts` enforces this, so add a migration when adding a provider.
- **Bundle safety.** `lib/card-pricing.ts` must import the admin Supabase client type-only and load it with `await import()`.
- **Region and currency.**
  - Pricing should respect the user's region and currency setting, and prefer sources from the card's native market for that region. Fall back to other markets only with lowered confidence and clear attribution.
  - Don't present converted prices as native ones.
  - Never mix currencies inside one momentum comparison.

## Steps

1. Write the rule as a pure function in `lib/`, with named, exported thresholds.
2. Add unit tests in `tests/` with labelled fixtures covering:
   - thresholds (including the inclusive edges)
   - every gate: low or unknown confidence, penny prices, implausible jumps, stale data, mixed sources
   - the empty case
3. If the change is user-visible, add or extend e2e (`e2e/price-rising.e2e.ts` and `e2e/price-breakout.e2e.ts` patterns, with `mockCardPrices`).
4. Document the rules in the PR description as a table or list of numbers. Reviewers check rules, not code.
5. Run the unit tests for the changed pricing logic and focused e2e specs when useful for user-visible changes. Follow `release-and-deploy` for CI gates and any quota-specific local checks. Run the full e2e suite only when Cal explicitly asks.
