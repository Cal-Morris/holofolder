# Synthetic import fixtures

Every file here is a **synthetic test fixture**: made-up rows, no real user's collection. Each one copies the exact
header row of a real export so header detection and column mapping are tested against the real shape.

| File                          | Header source (checked 14 November 2026)                                                                         |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `synthetic-collectr.csv`      | Collectr PRO export, 16 columns, as in public 2026 export files (Collectr help: "Import/Export Your Collection") |
| `synthetic-tcgcollector.csv`  | TCG Collector Premium collection export, 11 columns                                                              |
| `synthetic-pricecharting.csv` | PriceCharting "export collection" CSV, 15 columns                                                                |

Set names in these files are a mix of the plain names seen in real exports and code-prefixed or series-prefixed
variants, so name normalisation is exercised. Rows include cases that must stay unmatched for review: 1st Edition and
pattern prints, sealed products, watchlist rows, Japanese cards, promos and unknown sets.
