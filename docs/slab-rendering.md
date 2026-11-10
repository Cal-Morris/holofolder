# Staged Slabs rendering (#388)

This is a local, read-only presentation slice. It is **not enabled in production**. #389 owns exact ACE/custom/historic assets and uploads; #390 owns graded backup/API/share/asset privacy acceptance and explicit scoped certificate publication; #379 owns runtime admission. No SQL, conversion, hosted data, uploads, provider calls, verification, values or publication are added here.

## Implemented boundary

The real `CollectionNavigationHost` selects Binder, List or locally admitted Slabs. `BrowserCollectionSession` and cached native startup pass only their existing loopback/non-hosted harness admission. The actual BinderApp renders the host gallery in its scroll region with the existing dock. Production `browserHostAdmission` remains a hard denial. There is no environment flag or URL that enables production Slabs. Ordinary navigation harness runs retain their unavailable-view fallback; `?navigation=1&slabs=1` selects the synthetic mixed gallery inside the already gated `/app/e2e-harness/inventory` route.

`slabCollectionCopies` reuses the exact session/account/owner fence and validated Inventory index. It uses existing placement and item IDs, excludes Unassigned/other collections, permits linked partners through the existing resolved owner scope and rejects stale reads. Cached evidence can display saved copies, explicitly marked possibly incomplete, without conferring freshness, write or membership authority. Changing presentation makes no inventory/target/order/grade/location mutation. No queue or audit event is fabricated.

Last view, collection, search and scroll use the existing per-device/account/owner navigation store. Deep page/slot/item links still select Binder; unsupported views safely fall back. No selected copy, overlay, editing state, grade or certificate is saved as navigation. The gallery renders at most 24 copies per page. Gallery pagination is transient; existing meaningful collection search/scroll are restored. A tab/view change unmounts detail and clears layout editing; shared overlay primitives provide X, Escape, back, backdrop, swipe, focus return and dock dismissal.

`SlabCard` accepts a small safe `SlabPresentation`, not a private inventory item. `slabPresentation` copies only recorded provider/grade/designation/scale/subgrades and known catalog name/set/number/image. Certificate, provider-record URLs, label asset IDs, source metadata, owner and location are absent. Catalog image URLs are restricted to existing catalog source parsers or deterministic public card paths, with no query, fragment or credentials. No private slab/label image is loaded or hidden in the DOM. Certificate sharing stays default OFF; this lane adds no sharing control or public serializer. #390 must supply an explicit scoped public projection, derivative redaction and revoke proof before public reuse. A renderer DTO is not authorization to publish a copy.

No provider import/photo is required. Known layouts keep the catalog card and manually recorded metadata. Raw copies render as raw cards. Missing catalog artwork or failed image retries retain readable name/grade plus “Card image unavailable”. Unknown versions preserve entered text in a neutral case; ACE explicitly says exact artwork is unavailable. Current and historic CGC grades remain as entered, including 9.5. Missing grades/subgrades remain unknown, and even four 10 subgrades do not select Beckett Black without an explicit variant.

## Explicit recorded support keys

These are application presentation keys for an observed reference, not official manufacturer generation identifiers. They fit existing `GradingRecord.holder` and `label.variant` strings, with no schema change or migration. Existing unknown strings are preserved, never rewritten.

| Provider | Holder | Label variant | Layout |
| --- | --- | --- | --- |
| PSA | `psa-standard` | `psa-lighthouse` | Clear narrow case, red perimeter, left description/right grade, centered plain provider text |
| CGC | `cgc-2025` | `cgc-current`, `cgc-pristine` | Rounded clear case without triangular seal notches, black masthead, right grade compartment; Pristine gold label/black grade panel |
| CGC | `cgc-2023` | `cgc-current`, `cgc-pristine` | Previous notched holder with the same explicitly selected post-2023 label styles |
| CGC | `cgc-2020` | `cgc-blue` | Blue Universal Grade masthead, left white grade box, centered description and recorded subgrade area |
| Beckett | `beckett-standard` | `beckett-silver`, `beckett-gold`, `beckett-black` | Wide case and dark insert, separate dark provider column, upper description/right grade, lower subgrade rows; explicit silver/gold/black label |
| Custom | Any recorded holder | `custom-slate`, `custom-teal`, `custom-rose`, `custom-sand` | Neutral case with recorded custom provider text and one of four bounded colors |
| Other/unknown | Any | Any unsupported or mismatched combination | Neutral, known metadata retained, unknown appearance disclosed |

Grade and designation are never derived from a variant key or converted between provider scales. No logo artwork, holograms, security graphics, certificate numbers, barcodes or QR codes are fabricated. Brand names are plain text. Custom text uses existing recorded provider, grade and designation; there is no HTML or arbitrary CSS input. Exact artwork, other historical versions (including legacy CGC Pristine/Perfect label artwork), unusual-size holders and provider-specific photos remain unsupported and honest fallback. Existing manual editor text fields can record the explicit keys in local drafts; no new persisted grading-edit workflow is exposed here.

## Official reference ledger, checked 2026-11-10

| Source and date | Observed visual evidence and use | Limits |
| --- | --- | --- |
| [PSA Security](https://www.psacard.com/security), live Nov 10; [buyer's guide](https://www.psacard.com/services/psasecurityabuyersguide) identifies the 2017 LightHouse update | Inspected the official page in the shared browser: clear case, red label perimeter, left stacked description, number/designation/grade on right, lower centered provider mark. Narrow holder silhouette used. | Direct GIF fetch was challenged, browser page imagery worked. No security artwork copied. Earlier PSA versions unsupported. |
| [CGC holder/label page](https://www.cgccards.com/card-grading/holder-label/), live Nov 10 | Downloaded and inspected official `superior-display.png?cb=20230623` and `unique-identification.png?cb=20230623`: case seams, distinct black masthead and right grade block. | Back-label QR/hologram imagery only informed omission, never bundled. |
| [CGC holder evolution](https://www.cgcgrading.com/guides/cgc-cards-holders-labels/), live Nov 10 | Inspected official Current Cards Holder and OG Holder images: current black masthead/gold Pristine badge, blue historic Universal Grade with left grade box. The source distinguishes 2020–2023, 2023–2025 and September 2025 onward; current seal has no triangular notches. | Support is limited to the recorded standard-size versions listed above. No historic grade conversion. |
| [CGC launch](https://www.cgcgrading.com/news/articles/cgc-cards-launch-1CEIjKJeI0abmpLx2oEkpb/), July 11, 2023 | Documents the 2023 label/scale change, gold Pristine label and discontinued subgrades. Used to keep historic and current scales separate. | Launch illustrations alone do not support every earlier special label. |
| [Beckett grading](https://beckett.com/grading), live Nov 10 | Inspected official browser hero and “Three Labels” image: dark provider column, right grade, compact two-column subgrades, dark card insert; separate black/gold/silver labels. Source explicitly lists both Gold Pristine 10 and Black perfect 10. | Current observed standard only. Official [older Black Label article](https://www.beckett.com/news/bgs-black-sparks-added-interest-in-perfect-10s/) returned 404. Browser challenge cleared normally; no cookies/tokens replayed or saved. |

Case width/height design ratios are approximately PSA 81:136, CGC 85:137 and Beckett 87:136, chosen from the standard-card reference silhouettes, not published metrology or a claim of exact millimetres. Label height is about 18% of the inner holder. The window is separate from the label, with catalog artwork contained at its original ratio. Synthetic phone screenshots below are compared for silhouette, hierarchy, compartment placement and legibility. They are application depictions, not photos, certificates or evidence of physical authenticity.

## API/help/release

This slice adds no data operation, mutation or API entitlement. Read-only CSS/React rendering, detail visibility and device-local navigation are a concrete UI-only boundary, so REST/MCP registry, shared authoritative operations, generated OpenAPI and agent response schemas remain unchanged. Supported native read/write parity and public graded projection are still owned by #376/#390/#379. [Help](../content/docs/slabs.mdx) and [coverage](public-api/coverage.md) describe that boundary. [Release text](releases/slabs-rendering-draft.md) is unpublished; there is no live feature or Framer announcement claim.

## Verification

Commands, final counts and screenshot comparisons are recorded in [the evidence note](evidence/slabs/README.md). Unit coverage exercises all explicit/mismatched versions, missing metadata, raw fallback, bounded custom colors, image allowlisting, private DTO redaction, owner/partner/session/cached fences and local navigation admission. Focused phone coverage uses the actual shared host and BinderApp, all six browser/standalone sizes, safe insets, long/missing text, gallery/detail, all dismissals, view restoration, cached offline switching and account teardown. No full-repo e2e, hosted read/write, real provider fetch, physical phone or installed-PWA process-kill proof is claimed.
