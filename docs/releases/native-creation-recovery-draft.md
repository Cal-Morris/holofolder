# Unpublished: recover an untouched new collection

Draft only. No app/API recovery is available from this internal slice. Do not publish before #396 recovery/Activity/API and #379 exposure/compatibility gates, hosted migration and production verification pass. Default collection recovery is prepared only through the explicit version-2 replacement contract below.

Review a recorded creation before undoing an untouched nondefault collection. Recovery removes its copied starting list together and preserves owned cards, wants and other collections. If the collection changed or gained dependent content, recovery explains the conflict instead of silently deleting it. Accepted recovery adds a linked history event and retries return the same result.

Before release, replace this draft with verified availability, supported API/help links, the actual default-collection limits and offline reconciliation behavior. This is preparation for the recovery feature block, not a separate backend release announcement.

## 085 preparation, not published

Default creation recovery can also be prepared when the user explicitly nominates another existing accessible native collection of the same owner, supplies its current versions and reviews the default reassignment. First-ever creation requires that an alternative now exists. Empty original collection removal and reassignment are atomic; copies, wants, acquisition/grade/label evidence and owner authority stay intact. No alternative, changed originals/replacement, incomplete history or dependents retain explicit conflicts. There is no automatic replacement, force cleanup or default reset. Existing nondefault/version-1 behavior is unchanged.

This is a hidden version-2 service-gateway contract, not a shipped Undo/Activity/REST/MCP feature. Parent review, fresh backup, migration 085 application and release remain required. Local SQL tests are not hosted cancellation/load/mobile proof; the inherited converted 4,096-copy maximum still has a recorded 10-second timeout gap. Do not publish this draft or mark #396/#384 complete. See [exact internal eligibility and conflicts](../explicit-default-creation-recovery.md).
