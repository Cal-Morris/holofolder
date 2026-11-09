# OCR and card scanning

## TLDR

Holo Folder runs card recognition in the browser. Show mode reads the Pokémon name and collector number with OCR, then searches the catalogue. Collection scanning combines handcrafted visual image descriptors, evidence from multiple camera frames and OCR to distinguish printings. Binder-page scanning adds page/grid detection and occupied-pocket classification before matching each card.

The shared OCR reader tries native `TextDetector`, then an English Tesseract.js worker. Camera images are processed on the device; online catalogue searches and reference-image downloads still use the network. Offline Show mode searches only cards saved on the device, and Tesseract needs its engine/data downloaded first.

Exact-printing recognition is heuristic. Similarity, confidence, the gap to the next candidate and repeated observations control automatic acceptance. Detecting an occupied pocket is separate from identifying its printing: page scans can mark the expected Pokémon collected without assigning an exact card.

## Entry points and pipelines

| Flow | Candidate scope | Recognition and result |
| --- | --- | --- |
| Show mode / price lookup | Online catalogue search, or saved cards offline | OCR name and collector number; open one clear result in the deal checker, otherwise return to search |
| Card selector | Cards already loaded for the selected Pokémon | Compare camera frames against reference images, aggregate results, rerank with OCR and show candidate cards for selection |
| Slot sweep | English cards with images for the Pokémon expected in that pocket | Match several frames and assign the printing only when acceptance checks pass |
| Whole-page sweep / uploaded page photo | Expected Pokémon at each occupied pocket | Detect the grid and occupancy, crop pockets, then run visual matching and OCR reranking |

UI orchestration lives in [quick-card-scanner](../components/quick-card-scanner.tsx), [card-selector](../components/card-selector.tsx), [page-scanner](../components/page-scanner.tsx) and [binder-app](../components/binder-app.tsx). Camera acquisition is shared through [use-camera-stream](../hooks/use-camera-stream.ts); guided captures use [camera-frame](../lib/camera-frame.ts).

## Shared OCR reader

[card-scan-ocr](../lib/card-scan-ocr.ts) accepts an image URL, Blob or canvas and returns structured text signals.

### Image preparation

The reader supports five regions: the full card, the bottom 32%, left and right collector-number corners, and the name line near the top. Callers choose which regions to read and in what order.

Each region is resized to 520–820 px wide, converted to grayscale using luminance weights, then given a contrast boost of 1.28 and a brightness offset of 4. White backing is drawn before the source image. This makes small printed text more legible without requiring a server image-processing step.

### Engines and scheduling

1. Try the browser's native `TextDetector`, if available. Extract and merge signals from the requested regions.
2. Unless the caller already has enough evidence, load Tesseract.js and create one reusable English worker with sparse-text segmentation, preserved spaces and a 300 DPI hint.
3. Run Tesseract calls through a shared promise queue so callers do not recognize images concurrently on the same worker.
4. Merge native and Tesseract signals. Return early when the caller's evidence condition is satisfied, or read all regions when `exhaustive: true` is set.

The default stop condition is finding a collector number. Show mode supplies a stricter condition: a recognized Pokémon name and a collector number including its set total. Exhaustive collection scans continue through all regions.

If Tesseract cannot load, the reader preserves any useful text already obtained. Show mode calls `warmCardTextReader()` when its scanner opens online to start the engine/data download before capture.

[card-scan-text](../lib/card-scan-text.ts) handles text normalization, collector-number extraction, merged signals and text-based candidate scoring.

## Show mode recognition

[quick-card-scanner](../components/quick-card-scanner.tsx) captures up to three frames with 300 ms gaps. Each frame reads the name, left/right number corners and bottom strip, with a 20-second timeout around that frame's OCR promise. It stops sampling once merged evidence contains a name and full collector number. These are processing limits, not a guaranteed end-to-end latency.

[card-scan-identify](../lib/card-scan-identify.ts) converts those signals into a lookup:

1. Normalize accents, case and punctuation, then compare tokens with the Pokémon name catalogue. Longer single-word names tolerate one character of edit distance. Names immediately following `from` are ignored to avoid choosing the evolution predecessor.
2. Prefer a collector-number fraction such as `6/165`; prefixed numbers such as `TG05` can also contribute.
3. Build a query such as `Charizard 6/165` and request `/app/api/tcg-card-search`. Offline or after a failed request, search the on-device card index.
4. Rank results by Pokémon identity/name, local collector number, official set total and additional text signals.
5. Accept a card only when name and number both match and either exactly one candidate also matches the set total, or no total matches and there is exactly one name/number candidate.

An ambiguous result returns the recognized query to Quick mode for selection. A failed read offers typed search. This flow does not use the visual descriptor matcher.

## Visual matching for collection scans

### Image descriptors

[card-image-match](../lib/card-image-match.ts) builds handcrafted descriptors on a 120×168 canvas. Features include regional colour statistics, a 10×14 micro-colour grid, edge-orientation signatures, row/column/border profiles, colour distributions and perceptual hashes.

Dedicated patches cover the top band, upper corners, collector-number strip and set area. Collector-number patches carry substantial weight so matching considers details beyond the artwork. The pipeline compares these descriptors with known reference card images and produces a similarity score.

This is classical image processing and similarity scoring. It does not use a trained card-recognition model or a vector embedding index.

### Evidence across frames and OCR reranking

[card-scan-matching](../lib/card-scan-matching.ts) aggregates candidate observations across frames, tracking appearances, appearance ratio, similarity, confidence and the margin over competing matches.

The card selector samples eight frames with 450 ms gaps and requires at least three usable frames. Its visual aggregation requires at least two appearances, or 45% of usable frames rounded up, whichever is greater. OCR is scheduled for up to four captured frames.

[card-scan-ranking](../lib/card-scan-ranking.ts) reranks aggregated visual matches using OCR evidence. Candidate text starts with catalogue metadata. A bounded subset of reference images is also OCR-read to provide text that metadata may omit; those results and image descriptors are cached in component memory. The card selector limits reference-image OCR to 18 candidates.

Page matching selects distinct, higher-quality captured crops using [card-scan-evidence](../lib/card-scan-evidence.ts), reading more crops when the leading visual candidates are close. Text evidence can introduce candidates outside the initial visual shortlist.

### Automatic acceptance

[card-scan-acceptance](../lib/card-scan-acceptance.ts) applies the following defaults to page matches:

| Check | Default |
| --- | --- |
| Minimum similarity | 0.58 |
| Minimum confidence | 0.62 |
| Clear margin over the next candidate | 0.045 |
| Alternative for a close margin | Similarity ≥ 0.68, confidence ≥ 0.82 and appearance ratio ≥ 0.72 |

Slot sweep overrides the minimum similarity to 0.56 and confidence to 0.58, retaining the other defaults. The card selector presents ranked candidates for the user to select rather than applying this page acceptance gate.

Confidence is a heuristic score, not a calibrated probability of correctness.

## Binder-page scanning

[binder-page-scan](../lib/binder-page-scan.ts) processes an uploaded photo or guided camera frame:

1. Scale the source to a maximum dimension of 1,200 px.
2. For uploaded photos, try Scanic page rectification, a custom page/grid-based rectification and the original image. Guided captures use their guided grid path.
3. Locate the configured rows and columns, then refine pocket boundaries.
4. Classify occupancy using luminance and chroma variation, saturation, edge density, spatial activity and highlight/glare checks.
5. Produce 240×336 crops for occupied pockets.
6. Compare each crop against English printings with images for the Pokémon expected at that slot, then aggregate and OCR-rerank the matches.

Slot sweep captures eight frames with 360 ms gaps. Whole-page sweep samples 16 frames with 800 ms gaps, requires at least two usable frames and uses occupancy votes across frames. Its required vote count is the greater of two or 45% of usable frames rounded up. These configured sampling gaps exclude processing time.

[binder-page-scan-aggregate](../lib/binder-page-scan-aggregate.ts) stabilizes occupancy across frames. The page-photo and whole-page flows can collect a newly occupied expected Pokémon without a printing; exact card fields are attached only when a match passes the acceptance gate. Slot sweep rejects an uncertain printing and asks the user to retry or skip.

## Network, offline and recognition limits

- OCR and visual comparison run on the device. Catalogue search, candidate data and reference images can still require network requests; camera frames are not sent to a cloud recognition API by these pipelines.
- Tesseract's first use downloads its engine and English data. Offline readiness depends on the reader assets being available, and offline Show mode can only match saved catalogue entries.
- Collection image matching also needs candidate data and reference images. Running recognition locally does not guarantee a cold offline scan can load those resources.
- Tesseract is configured for English. Page matching explicitly requests English candidates, and Show mode identifies names through the application's Pokémon catalogue.
- Glare, blur, tiny collector numbers and visually similar printings can leave a result ambiguous. Recognizing a printing does not independently establish its physical finish or condition.
- The thresholds above describe implemented rules, not measured accuracy. Synthetic tests exercise recognition logic and UI paths; real camera accuracy and latency require device testing.

## Tests

Unit coverage is in `tests/card-scan-*.test.ts`, `tests/card-image-match.test.ts` and `tests/binder-page-scan-aggregate.test.ts`. Browser coverage includes [show-scan](../e2e/show-scan.e2e.ts) and [page-scanner](../e2e/page-scanner.e2e.ts). See [testing](testing.md) for focused execution and the six mobile browser/standalone projects.
