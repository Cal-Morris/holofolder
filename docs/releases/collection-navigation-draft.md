# Collection navigation release draft

Unpublished. Related #386/#385/#379; Slabs #390 is excluded. Do not announce the hidden host/harness as available. Publish only after authenticated production binding, enabled rollout and live verification.

## Draft enabled wording

Move between Inventory and your collections without losing your place. Inventory shows the copies you own and where they are stored. Open a location to jump to its current page, then go back to the same search and storage filter. Your device remembers the last collection, view and page you used.

Choose Binder or List for a collection. National Dex browsing, including missing Pokémon, remains reachable. Changing the view leaves your cards and their storage locations alone. If a location is unavailable offline, the app explains what it can show from saved data.

## Publication gates

Review wording against actual shipped behavior and the eventual offline transport. Keep Slabs out until #390 is enabled and verified. Attach live help/API coverage and Framer feature/changelog links through #393 only after #379 rollout. The present PR adds device-local navigation and synthetic integration, with no live transport, new public API, migration, production dock replacement or public layout preference.
