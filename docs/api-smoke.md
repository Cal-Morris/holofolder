# Public API smoke and performance checks

Run the registered public REST operations against a deployed environment:

```sh
bun run test:api:smoke --isolated-fixtures --output /tmp/holofolder-api-smoke.json
```

The runner needs the target project's Supabase admin environment (`NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `POSTGRES_URL_NON_POOLING` or `DATABASE_URL`). Use `bun --env-file=<file> scripts/api-smoke.ts ...` to select an environment explicitly. `--base-url` defaults to `https://app.holofolder.com/app/api/v1`. The API and database must belong to the same environment.

This is an opt-in integration check, separate from `bun test`. It creates two labelled synthetic accounts, grants temporary paid access, seeds 1,010 collection slots, and issues 30-minute API keys. It never uses a personal collection. It invokes real non-sold price providers for one card, asserts sold-comps and background-start API denials, and seeds then cancels an inert comparison job without starting a workflow. Production rate limits remain enabled; pacing happens outside measured request time.

Every registered operation needs a successful response and explicit assertion for execution coverage, with the existing asserted `403 ui_only` job-start exception. The runner currently covers legacy fixtures only. Native reads/commands/presets now execute through trusted boundaries, so historical fixed-503 inputs have been removed. Native operations remain uncovered in this hosted runner until a reviewed native fixture lifecycle is implemented; the report exits 1 for incomplete coverage. Focused synthetic REST/MCP tests verify their local transport contracts without hosted writes.

Reads run once plus two repeats by default (`--repeats 0..5`). Writes run once. The report records HTTP status, assertion results, response bytes, full client latency and `Server-Timing` for auth, operation and total server duration. “First” means first observed in this run, not a forced cold start. Repeated server medians are compared to the 30 ms target. Provider-backed operations are labelled separately without that target. These small samples are smoke checks, not a load test or reliable tail-latency estimate.

The report separates successful execution and performance from coverage. Historical staged denial samples cannot satisfy any currently admitted native operation. Exit 0 requires successful assertions and complete coverage plus cleanup; pending artwork cleanup exits 2 only after all other requirements pass. Functional, coverage and account cleanup failures exit 1. Missing timing data fails successful-operation verification; `--strict-performance` also fails measured non-provider medians above 30 ms.

Activity coverage removes a disposable fixture card, previews and applies its recovery, retries the exact apply request and verifies both directions of the linked history. The MCP HTTP/SDK integration regression in `tests/activity-mcp.test.ts` separately verifies tool discovery, preview/apply dispatch, mutation/idempotency hints, permission denial and revoked OAuth access with synthetic authentication. That regression is not a live OAuth browser-flow test.

Cleanup always runs after a failure. Accounts, namespace reservations and actor-specific rate budgets are removed. Private artwork cleanup also requires the real R2 credentials documented for the private artwork store. If those are unavailable, the runner reports the exact disposable object key in `cleanup.artwork` and exits 2. Delete only those keys from `holofolder-private-artwork` through the connected Cloudflare account and verify absence. Do not call that run clean until the pending list is empty. Reports contain fixture identifiers but never keys, signed URLs or response bodies. Preserve the report if a process is interrupted so remaining fixture identifiers can be cleaned up.

Sold-comps refreshes and background comparison starts are available only through the signed-in app. REST and MCP can read saved sold evidence, inspect/read/cancel jobs, and refresh eBay comparisons with explicit `source: "ebay"`. A sold source or omitted source on API refresh, and any API job start, returns `ui_only` (HTTP 403 on REST). These denials happen before provider or workflow calls.

For public API changes, run after the exact production deployment is ready and inspect every operation's verification and timing. Keep the report with the release evidence. Run focused unit/rollback checks before shipping; do not run this fixture-creating suite automatically on every unit test invocation.

## Price-check rate limits

The REST API's existing per-actor 60 reads / 20 writes per minute also covers sold-check reads and refresh requests. Main-app `/api/card-price-checks` and `/api/ebay/listings` share owner-account counters: 60 saved/listing reads and 20 refresh requests per minute. Partners share the owner's app allowance.

Actual upstream sold-comps requests have a global 10/minute budget; eBay listing searches have a global 60/minute budget. These Postgres counters apply across instances, accounts, REST/MCP operations and background jobs. They are fixed calendar-minute windows, separate from each card/finish/source's existing shared refresh claim and cooldown. Saved checks and cache hits never consume provider budget. They limit request rate, not monthly spend.

Exhausted limits return HTTP 429 and `Retry-After`; unavailable counters fail closed with 503. Background comparison jobs treat exhausted/unavailable budgets as retryable and use their existing two-minute backoff. Tests use synthetic counters and assert no upstream request follows a denial; do not exhaust shared production provider counters to smoke-test a 429.

## Native proof

Run focused `native-production-routes`, `native-developer-operations`, `native-developer-read`, `preset-developer`, `api-smoke-coverage` and `api-performance-checks` unit tests. They exercise actual production route exports, REST and MCP HTTP/SDK dispatch with synthetic auth/backend dependencies, without an admission mock. They are not hosted SQL/OAuth or production/device acceptance proof. Developer pages are not private complete planning snapshots or browser queue ACKs.

## Release operator handoff

1. Parent verifies the exact deployed head, supported operation scope and matching API/database environment, then runs the isolated suite once after release review. Inspect `failures`, every coverage row, successful-operation timings and cleanup, not just the final count. Do not reuse previous fixture accounts or artwork.
2. Retain the original report and exit status. Let its `finally` cleanup finish. If interrupted, use only that run's `runId`, `cleanup.accountIds` and exact `cleanup.artwork` keys to identify disposable resources; verify the fixture metadata before account deletion.
3. If external artwork cleanup is pending, use the connected Cloudflare account to delete only those exact private-bucket keys. Verify each key is absent and the run's fixture-owner prefix is empty. Verify fixture accounts are absent too. Record the checks and cleanup evidence alongside the report; clear pending entries only after verified deletion. An external-cleanup annotation alone does not override pending/unknown runner state or turn the original exit into 0.
4. Parent owns deployed isolated smoke, external cleanup, acceptance and issue/project closure. These local tests and a PR do not complete release acceptance. This is an internal check, with no customer release or Framer announcement.

Terminal slot/inventory responses have a separate `assertTerminalStorageSmokeResponse` check, bound to the submitted operation ID and the strict declared error schema. An ordinary 409 or accepted receipt cannot pass it. Synthetic real-transport fixtures cover both terminal replay and unknown retry; these errors never count as successful operation/latency coverage. This adds no hosted smoke scenario or authorization to execute native commands.

## Public identity contract (#509)

Smoke coverage follows the current registry, not removed public species-row operations. Catalog assertions require `game:"pokemon"` for cards, sets and series and preserve exact application IDs. Species set grouping is `get_pokemon_set_slots`. Activity physical-copy filtering uses `inventoryItemId`.

The legacy Activity Undo success scenario seeds its deletion through the retained internal compare-and-set RPC on the disposable account. This is fixture setup, not a public CRUD alias or generic native inventory fixture. The all-operation report still fails on missing admitted native success coverage; this patch does not manufacture successful execution from staged errors. Running this hosted smoke requires parent authorization and cleanup proof; implementation here runs synthetic contract tests only.
