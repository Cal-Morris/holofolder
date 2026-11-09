# Collection import

Settings → Account → Import reads CSV files from trackers that provide an export, or the collection portion of a Holo Folder version-1 JSON backup. Generic column mapping is the compatibility path; no vendor-specific export format has been verified or promised. Files stay on the device. Only selected identity fields are sent to the catalogue resolver, never the original cells or a backup's settings, artwork or account IDs.

The limits are 10 MiB, 5,000 data records, 128 columns and 16,384 characters per CSV cell. CSV supports BOM, CRLF, quoted commas, escaped quotes and embedded newlines. Headers must be unique and rows rectangular. JSON must have the exact backup format and version. Exported prices, settings, artwork and people assignments are not restored.

Holo Folder CSV headers map automatically. External CSV requires either a catalogue/TCGdex ID, an explicitly mapped TCGplayer product ID, or name, set and collector number. Leading zeroes are preserved in the input. Matching normalizes numeric padding but requires exact set/name/language and a supported finish. It checks a denominator when supplied. Missing, ambiguous, unsupported or multi-Pokémon identities remain unresolved. No fuzzy matching or fallback to English. A full file-wide language, finish and owned/wanted default is displayed for confirmation where columns are absent.

The read-only, same-origin `/app/api/collection-import/resolve` POST accepts at most 25 bounded lookups, performs at most three simultaneous catalogue reads, and returns private, uncached responses. Identity reads use the existing mirror cache and tag. This endpoint never writes a collection. External matching needs a connection. Holo Folder parsing and eligible imports work offline once Settings is cached on the device.

Preview shows each row's reason and projected saved-entry allowance. Only explicit user application writes. Existing owned selections are preserved, wants are combined by ID/language/finish, and repeated imports are no-ops. Multiple owned printings for an empty Pokémon require choosing one. Rows with quantity other than one, condition, grades or unsupported product types are excluded. Map those columns to detect the omissions; other unmapped fields are explicitly acknowledged before application. Downloadable CSV reports retain original cells and neutralize spreadsheet formulas.

Writes use the existing collection hook, optimistic persistence, allowance guard, queue and compare-and-set fingerprints. Import refuses a slot with pending edits and verifies each expected base again. It does not capture acquisition notifications for historical cards. The additive `importOnly: true` queue flag survives reloads and retries: a remote owned selection/status wins, wanted removals are never propagated, and an already existing slot deleted remotely is not resurrected. A later manual edit keeps the usual manual-edit conflict policy.

Closing Settings, switching account/owner/binder, cancelling or replacing the file stops future work. An already submitted write may complete. A hard failure stops remaining writes and leaves completed/queued work intact. The report distinguishes saved, queued, skipped, failed and unapplied rows; queued writes still require server checks. Partial catalogue resolutions remain reviewable after a network failure.

No schema or environment changes. Roll back by reverting this PR. Review/sync outstanding import writes before reverting installed clients, since older clients ignore the additive conservative conflict flag. Reverting does not remove cards that a user has already imported.

## JSON v2 preparation

The production Settings importer still accepts only v1 JSON and the Dex CSV contract above. JSON v2 serialization and immutable inventory-copy/arrangement previews are internal preparation under #365, not an enabled restore feature. Do not flatten a v2 file into legacy per-species writes. See [the v2 format and exact execution/offline/asset gates](binder-backup-v2.md). No public API, production UI or hosted restore has been enabled by this preparation.
