# Native developer operations (#376, current after #507)

Supported native commands, creation, arrangement import, raw restore and recovery now execute through the existing authenticated REST/MCP dispatcher and trusted `storage_execute_v1` bridge. There is no fixed `native_operations_staged` admission guard. See [the direct server handoff](native-direct-server-handoff.md) for the first-party route contract. This guide describes server admission, not completion of app host, onboarding, offline or hosted acceptance work.

## Authority and writes

`lib/developer-api/storage.ts` defines the current strict inputs, response/error schemas and byte limits. `executeNativeDeveloperOperation` revalidates schemas and permissions for trusted dispatcher callers. Commands and creation require `collection:write` and `binders:write`; recovery additionally requires `collection:read`. REST keys and MCP OAuth use their existing paid entitlement, revocation, membership, owner and request-budget boundaries. Preview uses read budget; apply/commands use write budget. The SQL bridge separately rechecks authority, billing, versions and caps.

The body operation ID identifies exact retry intent. Retain the original owner, operation/collection/slot/item IDs, preconditions and request after an unknown outcome. Do not replace lifetime native replay with the legacy 24-hour idempotency policy. Generic conflicts are not terminal noncommit proof. Only the operation's declared bound rejection contract proves terminal rejection. Safe receipts omit private certificates, label assets and recovery evidence.

`privateFields:"preserve"` requires `expectedOwnerUserId` and uses the existing intent-based private-preserving bridge for supported edits. Replacement remains explicit and may clear hidden fields. Redacted read models are not lossless replacement inputs. Use the current [native storage help](../content/docs/native-storage.mdx) and exact registry schema for supported intents and expected-want preconditions. No HTTP-side private read/merge or reconstructed retry payload is introduced.

## Generic identities and legacy boundaries

Printing `cardId`, physical `inventoryItemId`, stable `slotId` and `collectionId` have different meanings. Existing durable commands retain `itemId` where their versioned schema uses it; it means a physical copy. These fields, SQL and backups are not renamed by public Activity's `inventoryItemId` filter.

`{kind:"pokemon",pokemonId}` is a species identity. Card targets and free slots accept Trainers and Energy without dex links. Catalog application IDs and reviewed aliases are globally unique, not reusable provider-local keys. See [catalog identity](card-catalog.md).

Public species-row `list_collection`, `save_collection_item` and `delete_collection_item` have been removed from discovery and dispatch. There are no compatibility aliases or public legacy species-row CRUD routes. The first-party legacy `/api/collection` handlers are deleted too; frozen rows remain until migration 107 drops them. Legacy Activity Undo (`preview_collection_recovery` / `apply_collection_recovery`) remains separate from native recovery. Every binder is native, so the legacy-only `get_legacy_pokemon_analytics` and `resolve_import` operations have been removed without aliases.

## Verification and remaining work

`tests/native-developer-operations.test.ts` exercises actual REST/MCP transports and trusted bridge forwarding with synthetic dependencies: strict schemas, permissions, recipient checks, exact replay, typed errors and private output rejection. These tests do not prove hosted SQL atomicity, real OAuth issuer validation or production conversion. [Native reads](native-developer-read.md) use their separate authenticated redacted adapter.

Parent owns independent review, integration, hosted verification and release. App/bootstrap/onboarding, durable sender and fresh-read ACK, offline relaunch, recovery acceptance and hosted timeout/load/conversion remain independently verified gates. This contract update adds no migration, hosted write or publication.
