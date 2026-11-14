// Lean developer responses. REST keeps its full shapes by default (a public contract); MCP results go
// straight into a model's context, so MCP defaults to these smaller projections. An explicit include* input wins.
import { isDeepStrictEqual } from 'node:util';
import { quotedFinishFor, type CardPriceSnapshot } from '@/lib/card-pricing';
import type { CardPriceChecks } from '@/lib/card-price-checks';

type Row = Record<string, unknown>;
const isRow = (value: unknown): value is Row => !!value && typeof value === 'object' && !Array.isArray(value);

/** An include* input, else the transport default: on for REST, off for MCP. */
export function includeFlag(transport: 'rest' | 'mcp', input: Row, key: string): boolean {
  return typeof input[key] === 'boolean' ? (input[key] as boolean) : transport === 'rest';
}

/** The TCGdex sync stores each card/set twice: spread at the top of raw_json and again under
 * supplementalSources.tcgdex_rest. Drop the copy only when it is exactly the top-level data. */
export function withoutDuplicateTcgdexRest(raw: Row): Row {
  if (!isRow(raw.supplementalSources) || !('tcgdex_rest' in raw.supplementalSources)) return raw;
  const { supplementalSources, ...top } = raw;
  const { tcgdex_rest, ...others } = supplementalSources;
  return isDeepStrictEqual(tcgdex_rest, top) ? { ...top, supplementalSources: others } : raw;
}

/** A catalog card without its provider `details` (the whole stored raw record). */
export function withoutCardDetails<T>(card: T): T {
  if (!isRow(card)) return card;
  const { details: _details, ...rest } = card;
  return rest as T;
}

/** A set/series detail without its embedded card or set list and provider copies; list_cards?set= pages cards. */
export function leanCatalogGroup(group: unknown): unknown {
  if (!isRow(group) || !isRow(group.raw_json)) return group;
  const { cards: _cards, sets: _sets, supplementalSources: _sources, ...raw } = group.raw_json;
  return { ...group, raw_json: raw };
}

/** Price snapshot keys a summary read cannot know (history and trend series, root buy signal, FX date). */
const HISTORY_KEYS = ['historyPoints', 'trendPoints', 'buySignal', 'fxDate'] as const;
/** A saved price without history or trend series; finish quotes keep their headline fields and buy signal. */
export function leanPriceSnapshot(snapshot: CardPriceSnapshot): CardPriceSnapshot {
  const lean: Row = { ...snapshot };
  for (const key of HISTORY_KEYS) delete lean[key];
  if (snapshot.finishPrices)
    lean.finishPrices = snapshot.finishPrices.map(({ trendPoints: _trend, ...finish }) => finish);
  return lean as unknown as CardPriceSnapshot;
}

/** get_prices finish: keep only the finish quotes that price that finish (rarity-named finishes take holo). */
export function forFinish(snapshot: CardPriceSnapshot, finish: string | undefined): CardPriceSnapshot {
  if (!finish || !snapshot.finishPrices) return snapshot;
  const quoted = quotedFinishFor(finish);
  return { ...snapshot, finishPrices: snapshot.finishPrices.filter((quote) => quote.finish === quoted) };
}

/** check_deal's price as a headline only. */
export function headlinePrice(
  price: { gbpAmount: number | null; confidence: string; updatedAt: string | null } | null,
) {
  return price ? { gbpAmount: price.gbpAmount, confidence: price.confidence, updatedAt: price.updatedAt } : null;
}

/** An audit event with its before/after rows replaced by a change count and the changed field names. */
export function auditEventSummary(event: Row): Row {
  const { changes, ...rest } = event;
  const list = Array.isArray(changes) ? changes.filter(isRow) : [];
  const fields = new Set<string>();
  for (const change of list) {
    const before = isRow(change.before) ? change.before : {},
      after = isRow(change.after) ? change.after : {};
    for (const key of new Set([...Object.keys(before), ...Object.keys(after)]))
      if (!isDeepStrictEqual(before[key], after[key])) fields.add(key);
  }
  return { ...rest, changeCount: list.length, changedFields: [...fields].toSorted() };
}

/** Price checks keeping each source's summary, without the individual sold items and listings. */
export function withoutPriceCheckItems(result: CardPriceChecks): CardPriceChecks {
  const lean = (check: CardPriceChecks['ebay']) => {
    if (!check) return check;
    const { sales: _sales, listings: _listings, ...rest } = check;
    return rest;
  };
  return { ...result, ebay: lean(result.ebay), soldcomps: lean(result.soldcomps) };
}
