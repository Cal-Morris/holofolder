# Collection import

**Binder storage menu → Import cards** reads a CSV exported from another tracker and adds the cards to the open binder. It replaced the Settings importer that was removed with the legacy collection model (c717cba3). Signed-in owners and partners can use it; it is free on every plan.

## Supported files

The source is recognised from the exact header row (`detectImportSource` in `lib/collection-import.ts`):

| Source        | Export                                                                                                                    | What we read                                                                                                                                         |
| ------------- | ------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Collectr      | PRO only. Portfolio → ⋯ → Export, emailed CSV                                                                             | Set, Product Name (a `(JP)` tag means Japanese), Card Number, Variance, Grade, Quantity, Watchlist, Category                                         |
| TCG Collector | Premium only. Web export of the collection                                                                                | Expansion, Card number, Card name, Card variant, Card language, Quantity                                                                             |
| PriceCharting | Free. Account settings → Export collection, emailed zip                                                                   | product-name (`Name [Variant] #Number`), console-name (`Pokemon <Set>`, `Pokemon Japanese <Set>`), include-string (grade), grading-cert-id, quantity |
| Holo Folder   | Our own CSV exports                                                                                                       | Catalogue ID, language, finish, quantity, list                                                                                                       |
| Anything else | Generic column names: name, set, number, finish/printing, language, quantity, grade, catalogue ID or TCGplayer product ID | as named                                                                                                                                             |

Dex (dextcg.com) has a Dex+ CSV export on iOS whose columns aren't published, so it only works if its headers happen to match the generic names. Pokellector has no export.

Columns we don't keep (condition, price paid, notes) are named in the preview as not carried over. A generic file without a language column is read as English, and the preview says so.

## Matching

Only each row's name, set, number, language and print go to the same-origin `POST /app/api/collection-import/resolve` (25 lookups per request, three catalogue reads at a time, private and uncached). The file never leaves the device.

- **Set:** our set ID, or the set's name in English or the row's language, compared without case, accents or punctuation. If that fails, it tries without a code prefix (`SV03: Obsidian Flames`), without a `Base Set` suffix, without a series prefix (`Scarlet & Violet 151` → `151`), and promo set spellings (`SV Black Star Promos`, `Scarlet & Violet Promo Cards` → `SVP Black Star Promos`). Each step must name exactly one set. The set's Trainer Gallery, Galarian Gallery or Shiny Vault subset is searched too.
- **Card:** the number within those sets, ignoring leading zeros. A plain denominator must equal the set's printed count; gallery totals such as `TG30` aren't checked. The name must agree with the localised or English name, allowing a qualifier or number suffix (`Charizard ex - 199/165`, `Umbreon VMAX (Secret)`). Catalogue duplicates of one printing are folded into the canonical card.
- **Print:** trackers' "Normal" and "Holofoil" mean the standard print, which becomes the printing's own finish (double rare, special illustration rare and so on). Reverse holo must be a real variant. A printing with no recorded variants takes the file's print.

Anything else stays in the review list with its reason and is never guessed: 1st Edition, Shadowless, Poké Ball, Master Ball and Cosmos prints (not tracked separately), sealed products, unknown sets or languages, unreadable grades, and watchlist or wanted rows (not imported yet). The list can be downloaded as CSV; cells are formula-neutralised.

## Writing

`planImport` (`lib/collection/import-plan.ts`) plans on what this device shows, like Show mode's Bought:

- a raw card fills the open binder's first empty pocket whose target accepts it, preferring one that wants that exact printing (the want is fulfilled);
- otherwise it gets a new card-target pocket at the end of the binder;
- a second copy of a card the binder already holds, and every graded copy (PSA, CGC, Beckett, ACE or a custom grader, with the certificate when the file has one), is added to the collection without a pocket.

Copies are batched 50 commands per inventory intent, each planned on the projected result of the one before, and handed to the device queue through the same `acquire` admission as Bought, so a started import survives reloads and syncs like any other edit. One Activity entry is recorded per batch. Acquisition dates are left unknown. The limits are 10 MiB, 5,000 rows, 5,000 copies, 128 columns and 16,384 characters per cell.

## API

Import is an app feature, not a developer operation: parsing is on the device and the resolve route is same-origin with the signed-in session (the old public `resolve_import` was removed with the legacy model). Developers can do the same with `list_cards` / `get_card` to find printings and `execute_inventory_commands` (`add`, `insertAssign`, `assign`) to write them. See `docs/public-api/coverage.md`.

## Verification

Synthetic fixtures with each source's real header row are in `tests/fixtures/imports/`. Unit tests: `tests/collection-import.test.ts`, `tests/collection-import-resolve.test.ts`, `tests/collection-import-plan.test.ts`. End to end on the synthetic harness: `e2e/collection-import.e2e.ts`.
