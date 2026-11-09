# Operation coverage

The operation registry in `lib/developer-api/operations.ts` defines the REST schemas, MCP tools and generated reference. Implemented interfaces remain subject to release verification.

| UI data capability | Shared REST/MCP operations | Verification |
| --- | --- | --- |
| Catalog search, card lookup, stored details, canonical aliases, external identifiers | list_cards, get_card | query-bound cursors, strict schemas, nested R2 image regressions |
| Languages, Pokémon/dex, series, sets, set contents, illustrators | list_languages, list_pokemon, get_pokemon, list_series, get_series, list_sets, get_set, get_set_slots, list_illustrators | real >1000-record pagination, finite route/schema tests |
| Binder creation, renaming, ordering, deletion | list_binders, create_binder, update_binder, reorder_binders, delete_binder | hosted transactional retries and order/ownership checks; existing binder tests |
| Owned slots, status, wanted printings, assignments and acquisition intents | list_collection, save_collection_item, delete_collection_item | existing normalization/conflict suites, atomic SQL and stale-delete proof |
| Collection settings and per-binder layouts | get_settings, update_settings | existing settings/layout fixtures and strict input schemas |
| Public account identity | get_identity, update_identity | existing identity rules; service-only transaction-local identity delegation |
| Binder slugs and sharing | get_binder_identity, update_binder_identity, get_sharing, update_sharing | owner-only server guards, existing name reservations/sharing tests |
| Appearance and uploaded artwork | get_appearance, update_appearance, prepare_artwork_upload, get_artwork | revision checks, real private R2 MIME/size/overwrite/signature tests, six phone/PWA configurations |
| Partners and invitations | list_partners, invite_partner, accept_partner_invite, reject_partner_invite, disconnect_partner | real recipient denial, retry, ownership and disconnect SQL proof; UI uses the same transactional actions |
| Saved prices, refreshes and comparison evidence | get_prices, refresh_prices, get_price_checks, refresh_price_checks | existing provider confidence, currency, finish and cooldown suites |
| Background comparison jobs | inspect_comparison_job, start_comparison_job, get_comparison_job, cancel_comparison_job | app-only start denial, seeded inert job read/cancel, existing UI job fixtures and hosted idempotency SQL proof |
| Activity and historical price evidence | get_collection_analytics, get_price_history | existing analytics tests, 1001 synthetic history records paginated exactly once |
| Import identity resolution | resolve_import | existing exact catalog identity resolution and bounded batch schemas |
| Listings and deal evaluation | get_listings, check_deal | existing listing/deal/FX/confidence suites; no invented prices |
| Show purchases and undo | list_show_purchases, add_show_purchase, remove_show_purchase | shared row normalization, existing purchase sync tests, idempotent owner-scoped mutations |

Website-only: billing and checkout, account deletion, credential administration, push-device enrollment. Device-only: camera capture/OCR, wake lock, offline storage/queues. Admin sync/backfill and payment webhooks are not public tools.

Internal foundation: [editable binder contracts](../binder-slot-contracts.md) define stable slots, copied presets and pure layout plans under #360. They have no runtime caller or new REST/MCP operation. [Inventory/placement/grading contracts](../inventory-contracts.md) under #382 add unused owned-copy identity, trusted candidate adaptation, pure assignment/move/unassign plans and shared AuditContext. They add no public operations or OpenAPI schemas; grading UI/provider calls and runtime exposure remain downstream. Authoritative writes (#362/#383), exposed API schemas/docs (#376) and rollout gates (#379) must ship before these capabilities are publicly advertised. Existing collection operations above retain their legacy contract.

API keys are REST-only. MCP requires resource-bound OAuth with explicit grants. Signup trials are excluded. Raw API authentication ignores cookies and query-string secrets. Current membership and paid access are checked on every operation. Images are R2-only, including private binder artwork in a separate bucket.

Internal storage preparation (#361): [schema and legacy transition](../inventory-storage-migration.md) adds private tables and an unused service-only conversion primitive. No REST/MCP registry, generated OpenAPI, public data or runtime exposure changes. #362/#383 own authenticated transactional commands, #363 guest/offline reconciliation and #394 the existing audit recorder integration. Schema application and conversion remain separately gated.
