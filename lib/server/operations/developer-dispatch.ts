import { PRESET_OPERATIONS } from '@/lib/developer-api/presets';
import { setBinderLayout, type BinderLayoutInput } from './binder-layout';
import { moveBinderPage, type BinderPageMoveInput } from './binder-page-move';
import { executePresetOperation } from './presets';
import { NATIVE_READ_OPERATIONS } from '@/lib/developer-api/native-read';
import { executeNativeDeveloperRead } from './native-developer-read';
import { readCollectionAudit } from './audit';
import { executeNativeDeveloperOperation } from './native-developer';
import { NATIVE_DEVELOPER_OPERATIONS } from '@/lib/developer-api/storage';
import { withAuditActor } from '@/lib/server/audit-context';
import { requiresPriceCheckUi } from '@/lib/developer-api/price-check-policy';
import {
  includeFlag,
  withoutCardDetails,
  leanCatalogGroup,
  leanPriceSnapshot,
  forFinish,
  headlinePrice,
  auditEventSummary,
  withoutPriceCheckItems,
} from '@/lib/developer-api/lean';
import type { CardPriceSnapshot } from '@/lib/card-pricing';
import {
  readDeveloperIdentity,
  updateDeveloperIdentity,
  developerBinderIdentity,
  developerSharing,
  developerAppearance,
  developerArtwork,
} from './management';
import { readDeveloperPartners, changeDeveloperPartner } from './partners';
import { listDeveloperPurchases, addDeveloperPurchase, removeDeveloperPurchase } from './show-purchases';
import { loadEbayListingIndicator } from '@/lib/server/ebay-listings';
import { regionalizeCardPrice, getRegionalFinishPrices, getGbpPerUnit } from '@/lib/regional-price';
import type { DisplayCurrency, PricingRegion } from '@/lib/pricing-region';
import { readComparisonOperation, writeComparisonOperation } from './comparisons';
import { readDeveloperPriceHistory } from './analytics';
import { loadCardPriceChecks } from '@/lib/server/card-price-checks';
import { checkDeal, normalizeDealThresholds } from '@/lib/deal-check';
import { getPriceDataAgeDays } from '@/lib/price-freshness';
import { getRisingMomentum } from '@/lib/price-momentum';
import { NextRequest } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import type { OperationContext } from '@/lib/developer-api/types';
import { DeveloperAccessError } from '@/lib/developer-api/permissions';
import { paginateEntries } from '@/lib/developer-api/pagination';
import { normalizeCardLanguage, CARD_LANGUAGES } from '@/lib/domain/cards';
import { collectionFingerprint } from '@/lib/collection/sync';
import { normalizeCollectionItem } from '@/lib/collection/normalize';
import { sanitizeDeveloperImages } from '@/lib/server/developer-image-fields';
import {
  listCatalogCards,
  getCatalogCard,
  getCatalogSimilarCards,
  suggestCatalogCards,
  getCatalogCardsByIds,
  listCatalogGroups,
  getCatalogGroup,
} from './catalog';
import {
  decodeIdentifyImage,
  identifyLanguages,
  shapeIdentifyResult,
  IDENTIFY_DEFAULT_LIMIT,
  IDENTIFY_RATE_LIMITS,
} from '@/lib/card-identify';
import { identifyCardPicture } from '@/lib/server/card-identify';
import { consumeCardIdentifyLimit } from '@/lib/server/developer-access/limits';
import { EMBEDDING_MODEL } from '@/lib/card-assets/embeddings-db';
import { listBinders, createBinder, updateBinder, deleteBinder } from './binders';
import { getCollectionSettings, saveCollectionSettings } from './settings';
import { getMirroredIllustratorDirectory, getMirroredSetDexSlots } from '@/lib/tcg-mirror';
import { POKEMON_CATALOG } from '@/lib/pokemon-catalog';
import {
  loadSavedCardPrices,
  normalizeCardPriceLookups,
  refreshCardPriceLookups,
  loadDisplayFxRates,
} from '@/lib/card-pricing';

function paramsOf(input: Record<string, unknown>) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(input))
    if (value !== undefined && value !== null && typeof value !== 'object') params.set(key, String(value));
  return params;
}
function operationRequest(input: Record<string, unknown>, method = 'POST') {
  const params = paramsOf(input);
  params.set('fingerprintVersion', '2');
  return new NextRequest(`https://operations.holofolder.invalid/?${params}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(typeof input.idempotencyKey === 'string' ? { 'idempotency-key': input.idempotencyKey } : {}),
    },
    ...(method === 'GET' || method === 'DELETE' ? {} : { body: JSON.stringify({ ...input, fingerprintVersion: 2 }) }),
  });
}
async function actor(context: OperationContext) {
  const { data, error } = await createAdminClient().auth.admin.getUserById(context.principal.actorId);
  if (error || !data.user) throw new DeveloperAccessError('invalid_actor', 'This account is no longer available.', 401);
  return data.user;
}
async function unwrap(response: Response) {
  const result = await response.json();
  if (!response.ok)
    throw new DeveloperAccessError(
      typeof result.code === 'string' ? result.code : response.status === 409 ? 'conflict' : 'operation_failed',
      response.status >= 500
        ? 'This operation is temporarily unavailable.'
        : typeof result.error === 'string'
          ? result.error
          : 'The request could not be completed.',
      response.status >= 500 ? 503 : response.status,
    );
  return result;
}
async function sanitizeImages(value: unknown): Promise<unknown> {
  const output = await sanitizeDeveloperImages(value);
  function fingerprints(raw: unknown, clean: unknown) {
    if (Array.isArray(raw) && Array.isArray(clean)) {
      raw.forEach((row, index) => fingerprints(row, clean[index]));
      return;
    }
    if (!raw || typeof raw !== 'object' || !clean || typeof clean !== 'object') return;
    const row = raw as Record<string, unknown>,
      target = clean as Record<string, unknown>;
    if (typeof row.pokemon_id === 'number' && Array.isArray(row.wanted_cards))
      target.fingerprint = collectionFingerprint(normalizeCollectionItem(raw));
    for (const [key, child] of Object.entries(row)) fingerprints(child, target[key]);
  }
  fingerprints(value, output);
  return output;
}

/** identify_card: candidates for a photo, never a pick (lib/card-identify.ts). Costs CPU, so it has its own budget. */
async function identifyCatalogCard(actorId: string, input: Record<string, unknown>) {
  const image = decodeIdentifyImage(String(input.image));
  if (typeof image === 'string') throw new DeveloperAccessError('invalid_image', image, 400);
  await consumeCardIdentifyLimit(`developer:${actorId}`, IDENTIFY_RATE_LIMITS.developer);
  const language = typeof input.language === 'string' ? normalizeCardLanguage(input.language) : undefined;
  const { matches } = await identifyCardPicture(image, identifyLanguages(language));
  // A match on the shared English picture is shown in the language asked for.
  const cardLanguage = (match: { language: string }) =>
    normalizeCardLanguage(match.language === 'en' && language ? language : match.language);
  const cards = await getCatalogCardsByIds(matches.map((m) => ({ id: m.id, language: cardLanguage(m) })));
  const found = matches.flatMap((m) => {
    const card = cards.get(`${cardLanguage(m)}:${m.id}`) as Parameters<typeof shapeIdentifyResult>[0][number]['card'];
    return card ? [{ card, similarity: m.score }] : [];
  });
  const hints = {
    name: typeof input.name === 'string' ? input.name : undefined,
    number: typeof input.number === 'string' ? input.number : undefined,
  };
  return {
    model: EMBEDDING_MODEL,
    ...shapeIdentifyResult(found, hints, Number(input.limit ?? IDENTIFY_DEFAULT_LIMIT)),
  };
}

function sliceEntries<T>(entries: T[], input: Record<string, unknown>, key: (entry: T) => string) {
  return paginateEntries(entries, paramsOf(input), key);
}
async function dispatchDeveloperOperation(
  context: OperationContext,
  name: string,
  input: Record<string, unknown>,
): Promise<unknown> {
  if (PRESET_OPERATIONS.some((op) => op.name === name)) return executePresetOperation(context, name, input);
  if (NATIVE_DEVELOPER_OPERATIONS.some((op) => op.name === name))
    return executeNativeDeveloperOperation(context, name, input);
  if (NATIVE_READ_OPERATIONS.some((op) => op.name === name)) return executeNativeDeveloperRead(context, name, input);
  if (requiresPriceCheckUi(name, input))
    throw new DeveloperAccessError(
      'ui_only',
      'Start sold-comps checks in the Holo Folder app. Saved comparisons remain available through the API.',
      403,
    );
  const { includeDetails: _d, includeChanges: _c, ...filters } = input;
  const params = paramsOf(filters),
    identity = { id: context.principal.actorId },
    include = (key: string) => includeFlag(context.principal.transport, input, key);
  // Cards carry their whole stored provider record in `details`; MCP leaves it out unless asked.
  const card = include('includeDetails') ? <T>(value: T) => value : withoutCardDetails;
  const prices = (snapshots: CardPriceSnapshot[]) =>
    include('includeHistory') ? snapshots : snapshots.map(leanPriceSnapshot);
  switch (name) {
    case 'list_cards': {
      const page = await listCatalogCards(params.toString());
      return { ...page, data: page.data.map(card) };
    }
    case 'get_card': {
      const found = await getCatalogCard(String(input.id), normalizeCardLanguage(input.language));
      if (!found) throw new DeveloperAccessError('not_found', 'Card not found.', 404);
      return card(found);
    }
    case 'get_similar_cards': {
      const similar = await getCatalogSimilarCards(String(input.id), normalizeCardLanguage(input.language));
      if (!similar) throw new DeveloperAccessError('not_found', 'Card not found.', 404);
      const entries = (list: typeof similar.sameArtwork) => list.map((entry) => ({ ...entry, card: card(entry.card) }));
      return { ...similar, sameArtwork: entries(similar.sameArtwork), similarLook: entries(similar.similarLook) };
    }
    case 'suggest_cards': {
      const suggested = await suggestCatalogCards(
        input.cardIds as string[],
        (input.pokemon as number[] | undefined) ?? [],
        normalizeCardLanguage(input.language),
      );
      return { ...suggested, cards: suggested.cards.map(card) };
    }
    case 'identify_card': {
      const identified = await identifyCatalogCard(context.principal.actorId, input);
      return {
        ...identified,
        candidates: identified.candidates.map((candidate) => ({ ...candidate, card: card(candidate.card) })),
      };
    }
    case 'list_sets':
      return listCatalogGroups('sets', params.toString());
    case 'list_series':
      return listCatalogGroups('series', params.toString());
    case 'get_set':
    case 'get_series': {
      const kind = name === 'get_set' ? 'tcg_sets' : 'tcg_series';
      const data = await getCatalogGroup(kind, String(input.id));
      if (!data) throw new DeveloperAccessError('not_found', 'Catalog record not found.', 404);
      return include('includeRaw') ? data : leanCatalogGroup(data);
    }
    case 'list_languages':
      return { data: CARD_LANGUAGES };
    case 'list_pokemon':
      return sliceEntries(
        POKEMON_CATALOG.filter((p) => !input.q || p.name.toLowerCase().includes(String(input.q).toLowerCase())),
        input,
        (p) => String(p.id).padStart(4, '0'),
      );
    case 'get_pokemon': {
      const entry = POKEMON_CATALOG.find((p) => p.id === Number(input.id));
      if (!entry) throw new DeveloperAccessError('not_found', 'Pokémon not found.', 404);
      return entry;
    }
    case 'list_illustrators':
      return sliceEntries(
        (await getMirroredIllustratorDirectory()).filter(
          (p) => !input.q || p.name.toLowerCase().includes(String(input.q).toLowerCase()),
        ),
        input,
        (p) => p.name,
      );
    case 'list_binders':
      return unwrap(await listBinders(identity, context.ownerUserId));
    case 'create_binder':
      return unwrap(await createBinder(operationRequest(input), identity, context.ownerUserId));
    case 'update_binder':
    case 'reorder_binders':
      return unwrap(await updateBinder(operationRequest(input, 'PATCH'), identity, context.ownerUserId));
    case 'set_binder_layout':
      return setBinderLayout(context, input as unknown as BinderLayoutInput);
    case 'move_binder_page':
      return moveBinderPage(context, input as unknown as BinderPageMoveInput);
    case 'delete_binder': {
      const request = operationRequest({ ...input, confirm: input.confirm ? '1' : '0' }, 'DELETE');
      return unwrap(await deleteBinder(request, identity, context.ownerUserId));
    }
    case 'get_settings':
      return unwrap(await getCollectionSettings(operationRequest(input, 'GET'), identity, true, context.ownerUserId));
    case 'get_prices': {
      const requested = input.cards as { cardId: string; language?: string; finish?: string }[];
      // A summary read skips history_points and the trend columns; those keys are then left out, not empty.
      const saved = await loadSavedCardPrices(normalizeCardPriceLookups(requested), {
        summary: !include('includeHistory'),
      });
      return {
        prices: prices(saved).map((snapshot) =>
          forFinish(
            snapshot,
            requested.find(
              (card) => card.cardId === snapshot.cardId && normalizeCardLanguage(card.language) === snapshot.language,
            )?.finish,
          ),
        ),
      };
    }
    case 'update_settings':
      return unwrap(await saveCollectionSettings(operationRequest(input, 'PUT'), identity, true, context.ownerUserId));
    case 'refresh_prices': {
      const result = await refreshCardPriceLookups(normalizeCardPriceLookups(input.cards as unknown[]), {
        force: false,
      });
      return { ...result, prices: prices(result.prices) };
    }
    case 'get_price_checks':
    case 'refresh_price_checks': {
      const result = await loadCardPriceChecks(
        String(input.id),
        String(input.finish ?? 'any'),
        name === 'refresh_price_checks',
        input.source as 'ebay' | 'soldcomps' | undefined,
      );
      if (!result)
        throw new DeveloperAccessError('unsupported_printing', 'This exact printing is not supported yet.', 422);
      return sanitizeImages(include('includeItems') ? result : withoutPriceCheckItems(result));
    }
    case 'get_comparison_job':
      return unwrap(await readComparisonOperation(operationRequest(input, 'GET'), identity, context.ownerUserId));
    case 'inspect_comparison_job':
    case 'start_comparison_job':
    case 'cancel_comparison_job': {
      const action =
        name === 'inspect_comparison_job' ? 'inspect' : name === 'cancel_comparison_job' ? 'stop' : 'start';
      return unwrap(
        await writeComparisonOperation(operationRequest({ ...input, action }), identity, context.ownerUserId),
      );
    }
    case 'get_price_history':
      return readDeveloperPriceHistory(input);
    case 'list_collection_audit': {
      // The first-party Activity sheet reads readCollectionAudit directly and always keeps the changes.
      const page = await readCollectionAudit(context, filters);
      return sanitizeImages(
        include('includeChanges') || !('data' in page) ? page : { ...page, data: page.data.map(auditEventSummary) },
      );
    }
    case 'get_collection_audit':
      return sanitizeImages(await readCollectionAudit(context, input, true));
    case 'check_deal': {
      const [[stored], fxRates] = await Promise.all([
        loadSavedCardPrices(normalizeCardPriceLookups([{ cardId: input.cardId, language: input.language }])),
        loadDisplayFxRates(),
      ]);
      const region = (input.region ?? 'UK') as PricingRegion,
        currency = input.currency as DisplayCurrency;
      const snapshot = stored ? regionalizeCardPrice(stored, region) : null;
      const price =
        input.finish && stored
          ? getRegionalFinishPrices(stored, region)[input.finish as 'normal' | 'holo' | 'reverse_holo']
          : snapshot;
      const confidence = price?.confidence ?? 'unknown',
        rate = getGbpPerUnit(currency, fxRates, snapshot ?? undefined);
      const trusted = confidence === 'high' || confidence === 'medium';
      const market = rate && price?.gbpAmount ? price.gbpAmount / rate : null;
      const verdict = trusted
        ? checkDeal({
            askingPrice: Number(input.askingPrice),
            marketPrice: market,
            confidence,
            dataAgeDays: getPriceDataAgeDays(price?.updatedAt, Date.now()),
            isRising: snapshot ? Boolean(getRisingMomentum(snapshot, Date.now())) : false,
            thresholds: normalizeDealThresholds(input.thresholds),
          })
        : null;
      return {
        currency,
        region,
        marketPrice: market,
        price: include('includeHistory') ? (price ?? null) : headlinePrice(price ?? null),
        verdict,
        reason: verdict
          ? null
          : !rate
            ? 'A verified exchange rate is not available.'
            : 'A reliable saved market price is not available.',
      };
    }
    case 'get_pokemon_set_slots': {
      const result = await getMirroredSetDexSlots(
        String(input.id),
        normalizeCardLanguage(input.language),
        undefined,
        true,
      );
      if (!result.selectedSet) throw new DeveloperAccessError('not_found', 'Set not found.', 404);
      const page = sliceEntries(result.slots, input, (slot) => String(slot.dexId).padStart(4, '0'));
      return sanitizeImages({
        ...page,
        data: page.data.map((slot) => ({
          dexId: slot.dexId,
          pokemonName: slot.pokemonName,
          cardIds: slot.cards.slice(0, 100).map((card) => card.id),
          cardCount: slot.cards.length,
          hasMoreCards: slot.cards.length > 100,
        })),
        selectedSet: { ...result.selectedSet, game: 'pokemon' },
      });
    }
    case 'get_listings': {
      const result = await loadEbayListingIndicator(
        String(input.id),
        input.finish === 'reverse_holo' ? 'reverse' : ((input.finish as 'normal' | 'holo' | undefined) ?? null),
      );
      if (!result)
        throw new DeveloperAccessError(
          'unsupported_printing',
          'This exact printing is not supported by listing lookup.',
          422,
        );
      return sanitizeImages(result);
    }
    case 'get_identity':
      return readDeveloperIdentity(context);
    case 'update_identity':
      return updateDeveloperIdentity(context, input);
    case 'get_binder_identity':
      return developerBinderIdentity(context, input);
    case 'update_binder_identity':
      return developerBinderIdentity(context, input, true);
    case 'get_sharing':
      return developerSharing(context, input);
    case 'update_sharing':
      return developerSharing(context, input, true);
    case 'get_appearance':
      return developerAppearance(context, input);
    case 'update_appearance':
      return developerAppearance(context, input, true);
    case 'list_partners':
      return readDeveloperPartners(await actor(context), params);
    case 'invite_partner':
      return changeDeveloperPartner(context.principal.actorId, 'invite', input);
    case 'accept_partner_invite':
      return changeDeveloperPartner(context.principal.actorId, 'accept', input);
    case 'reject_partner_invite':
      return changeDeveloperPartner(context.principal.actorId, 'reject', input);
    case 'disconnect_partner':
      return changeDeveloperPartner(context.principal.actorId, 'disconnect', input);
    case 'list_show_purchases':
      return listDeveloperPurchases(context, params);
    case 'add_show_purchase':
      return addDeveloperPurchase(context, input);
    case 'remove_show_purchase':
      return removeDeveloperPurchase(context, String(input.clientId));
    case 'prepare_artwork_upload':
      return developerArtwork(context, input, true);
    case 'get_artwork':
      return developerArtwork(context, input);
    default:
      throw new DeveloperAccessError('not_found', 'Operation not found.', 404);
  }
}

export function executeDeveloperOperation(
  context: OperationContext,
  name: string,
  input: Record<string, unknown>,
): Promise<unknown> {
  return withAuditActor(context.principal.actorId, () => dispatchDeveloperOperation(context, name, input), context);
}
