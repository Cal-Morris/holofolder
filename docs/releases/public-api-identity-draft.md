# Public API identity clarification (#509), unpublished

Draft only. Parent owns review, merge, production contract verification and any later feature-block publication. No Framer item or announcement was created.

## Proposed release copy

Holo Folder's developer API now makes the difference between a catalog printing, a physical copy and a storage slot explicit. Card, set and series results identify the current game as Pokémon. Application IDs remain unchanged; provider product IDs stay source-specific evidence rather than interchangeable card IDs.

Use native inventory and storage operations for physical copies, wants and stable slots. Trainer and Energy printings work with card and free-slot targets without National Dex links. Pokémon species targets remain dedicated species identities.

The unused public species-row read/save/delete operations are removed without aliases. Dex-grouped set contents are named `get_pokemon_set_slots` at `/pokemon/sets/{id}/slots`. Legacy Pokémon history and import resolution are removed, since every binder is native. Activity's physical-copy query filter is now `inventoryItemId`; existing durable command fields keep their meanings.

REST, MCP discovery, generated OpenAPI and current help describe the same boundary. Current native read/command guides reflect authenticated server admission after #507. This release does not add another game, a provider framework, migration, data conversion, onboarding or offline guarantee.

## Publication gates

Exact-head review, CI, parent integration, deployed public docs/OpenAPI/Markdown/LLM and authorized affected API smoke verification remain required. Local synthetic tests are not hosted proof. Related app/onboarding/cache work and issue completion remain with the parent and #508 lane.
