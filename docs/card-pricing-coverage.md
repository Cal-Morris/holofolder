# Price coverage and historical evidence

Pricing first requests the card's exact TCGdex ID, then its reviewed aliases. The returned quote retains the saved binder ID. Explicit stamped-printing IDs keep their existing variant-specific matching; they cannot fall back to base-card prices. Reviewed TCGCSV product links also feed the exact English TCGplayer fallback. Other card languages never borrow those English product prices.

Positive quotes retain the two-hour cache. Missing prices retry after five minutes. Legacy client evidence refreshes online while remaining available offline.

## Tracked refresh selection

The internal workflow selector (`lib/server/tracked-price-selection.ts`) reads the current collection authority before selecting any provider requests. Legacy collections retain their saved card and explicit wanted-card selection. Slot-authoritative collections use physical `inventory_items` (including Unassigned copies after storage deletion) and explicit `binder_slots.wanted_cards`. Frozen `pokemon_collection` rows for converted collections are excluded. Empty preset targets and Pokémon-only identities do not request prices. No species/catalog join is required, so Trainer, Energy and other non-Pokémon card identities participate.

Distinct physical copies and known finishes share the existing **card ID + language** provider/cache request, whose snapshot contains available finish evidence. Saved IDs are preserved, including stamped variants; the selector does not resolve aliases, guess a finish or create a finish-specific provider key. Known language strings use the existing trim/lowercase normalization. Omitted legacy languages retain the existing English compatibility default; omitted native languages remain unknown and are skipped. Missing finishes remain unknown even when a card/language snapshot can be refreshed. Unsupported explicit language/finish values fail the selection rather than becoming English/normal. A raw reference quote never establishes graded market value.

Every table read uses exact counts and stable unique-key pagination in pages of 500. Null/malformed pages, count drift, repeated IDs, invalid owner/collection scope, unknown authority and changed owner revisions or authority metadata fail the entire selection before the workflow can call a provider. The per-selection limits are 512 requests, 32 MiB of JSON read data and a 30-second abort deadline. Exceeding a limit is an error, never a partial refresh. These are bounded multi-request reads, not a database transaction; ordinary concurrent legacy card edits may be picked up on the next pass.

The pre-073 compatibility path requires both inventory-root and storage-state tables to be absent (`42P01`/`PGRST205`). An absent state row on an existing binder retains legacy authority. Partial schema installation, missing columns, authorization failures and network failures never trigger legacy fallback. No migration, grant, conversion or native mutation admission is introduced.

The workflow keeps its existing owner-wide manual selection and all-owner scheduled selection, batch size, force flag, repeat/interval handling, provider transport, confidence/freshness, billing and refresh/cooldown rules. REST/MCP operations and generated OpenAPI remain unchanged: this is internal tracked-card discovery, not a new public refresh permission or inventory endpoint. Synthetic selector/query-shape tests do not establish hosted schema readiness, provider success, pricing coverage, cost or speed improvements. #374 and #379 remain staged acceptance gates.

## Free bulk import

```bash
bun run sync-card-prices --source-dir /path/to/source-cache --report /path/to/report.json
```

The default is a dry run. It reconciles the English TCGCSV catalog by exact normalized card name, collector number and set, rejecting ambiguous products and unsupported printing subtypes. It imports current TCGplayer market/low quotes and up to 90 days of dated native USD observations. No price is a guessed conversion, sold listing or acquisition value. Existing current quotes are not replaced. A missing current price can be filled by an exact TCGCSV quote using verified current ECB FX; historical USD amounts are never converted with today's rates.

Reviewed source differences include full subgroup and promo set names, gender notation, Full Art/Secret/Prime labels, and Celebrations' A-suffixed Classic Collection numbers. Stamp labels are never stripped, and Classic Collection prices cannot match the original set's printing. Use `--card <saved-id>` for a targeted backfill.

Apply migration `029_card_price_history_evidence.sql`, inspect the report, then add `--apply`. Apply is transactional and serialized with a price-import advisory lock. It changes public price data and reviewed product links, not user collections. Repeating an import merges by date/product/finish. `--days` limits the historical window to 1–90 days. Cached source files are reused for 24 hours, requests identify Holo Folder and are paced, and the importer stops on source or validation errors. Keep reports and cached source data outside Git.

The TCGCSV current feed is a [daily TCGplayer API export](https://tcgcsv.com/docs). Its main historical archive was withdrawn, so historical backfill uses the independently published [PokeFolio snapshot archive](https://github.com/landonrroy/pokefolio-data/tree/84eeee7331ded271a31dbd77727b2cfa5cd86deb), pinned to that commit. The archive ends on **15 September 2026**. Receipts record each downloaded archive's date, size and SHA-256. Only English category 3 is used. Gaps after that date, and products without a verified match or price, stay empty. No paid API or private endpoint is required.

## Ongoing evidence and card-show use

Migration 029 records native TCGplayer observations during the existing refresh. It requires the reviewed product link to match the quote's actual product ID and an exact supported finish. Source dates are preserved; undated thin/carried evidence cannot acquire a new date. The 90-day retention matches existing collection analytics. This capture has no additional polling schedule. Re-run the bulk importer to seed newly added catalog entries or recover additional missing quotes.

The card detail's separate history disclosure shows original USD, finish and actual quoted dates. Current GBP prices, Cardmarket rolling averages and momentum signals remain separate. The disclosure shows the latest 12 quotes and the recorded date range, not an interpolated daily series. Full evidence lives in the existing IndexedDB store, outside localStorage's small quota. The localStorage cache retains compact current quotes, and IndexedDB evidence hydrates without replacing a fresher quote. Client requests use batches of 25 with at most two requests in flight. Older bulk callers still receive current quotes, without the larger historical payload.

“Prepare for card show” explicitly downloads prices and available history for every card in the chosen sets, in batches of 25, and persists the existing client cache. It reports how many cards have prices. API or storage failures cannot report a successful price download. Missing prices remain unknown; downloaded quotes can change before the show.

Before migration 029 is applied, the app continues to read and write current prices normally; history is optional. The importer requires the migration before applying data.
