# Unpublished: recover an untouched new collection

Draft only. No app/API recovery is available from this internal slice. Do not publish before #396 recovery/Activity/API and #379 exposure/compatibility gates, hosted migration and production verification pass. First/default collection recovery still needs explicit replacement semantics.

Review a recorded creation before undoing an untouched nondefault collection. Recovery removes its copied starting list together and preserves owned cards, wants and other collections. If the collection changed or gained dependent content, recovery explains the conflict instead of silently deleting it. Accepted recovery adds a linked history event and retries return the same result.

Before release, replace this draft with verified availability, supported API/help links, the actual default-collection limits and offline reconciliation behavior. This is preparation for the recovery feature block, not a separate backend release announcement.
