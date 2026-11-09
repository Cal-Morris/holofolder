# Public API smoke and performance checks

Run the registered public REST operations against a deployed environment:

```sh
bun run test:api:smoke --isolated-fixtures --output /tmp/holofolder-api-smoke.json
```

The runner needs the target project's Supabase admin environment (`NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `POSTGRES_URL_NON_POOLING` or `DATABASE_URL`). Use `bun --env-file=<file> scripts/api-smoke.ts ...` to select an environment explicitly. `--base-url` defaults to `https://app.holofolder.com/app/api/v1`. The API and database must belong to the same environment.

This is an opt-in integration check, separate from `bun test`. It creates two labelled synthetic accounts, grants temporary paid access, seeds 1,010 collection slots, and issues 30-minute API keys. It never uses a personal collection. It invokes real non-sold price providers for one card, asserts sold-comps and background-start API denials, and seeds then cancels an inert comparison job without starting a workflow. Production rate limits remain enabled; pacing happens outside measured request time.

All 52 registered operations need an expected response and an explicit response assertion. Job starts are app-only and require an asserted `403 ui_only`; the other operations require successful responses. A new operation without coverage fails the suite. Additional checks exercise pagination beyond one page, full collection counts, stale-write conflicts, cross-owner denial, key revocation, and private artwork upload/download. Mutations use disposable state. Registry coverage concerns the REST transport and shared operation implementation; this does not exercise the MCP transport or OAuth browser flow.

Reads run once plus two repeats by default (`--repeats 0..5`). Writes run once. The report records HTTP status, assertion results, response bytes, full client latency and `Server-Timing` for auth, operation and total server duration. “First” means first observed in this run, not a forced cold start. Repeated server medians are compared to the 30 ms target. Provider-backed operations are labelled separately without that target. These small samples are smoke checks, not a load test or reliable tail-latency estimate.

By default functional/coverage/cleanup failures fail the process; latency misses remain visible in the report. Add `--strict-performance` to make any non-provider median above 30 ms fail too. Missing timing data fails successful-operation verification.

Cleanup always runs after a failure. Accounts, namespace reservations and actor-specific rate budgets are removed. Private artwork cleanup also requires the real R2 credentials documented for the private artwork store. If those are unavailable, the runner reports the exact disposable object key in `cleanup.artwork` and exits 2. Delete only those keys from `holofolder-private-artwork` through the connected Cloudflare account and verify absence. Do not call that run clean until the pending list is empty. Reports contain fixture identifiers but never keys, signed URLs or response bodies. Preserve the report if a process is interrupted so remaining fixture identifiers can be cleaned up.

Sold-comps refreshes and background comparison starts are available only through the signed-in app. REST and MCP can read saved sold evidence, inspect/read/cancel jobs, and refresh eBay comparisons with explicit `source: "ebay"`. A sold source or omitted source on API refresh, and any API job start, returns `ui_only` (HTTP 403 on REST). These denials happen before provider or workflow calls.

For public API changes, run after the exact production deployment is ready and inspect every operation's verification and timing. Keep the report with the release evidence. Run focused unit/rollback checks before shipping; do not run this fixture-creating suite automatically on every unit test invocation.

## Price-check rate limits

The REST API's existing per-actor 60 reads / 20 writes per minute also covers sold-check reads and refresh requests. Main-app `/api/card-price-checks` and `/api/ebay/listings` share owner-account counters: 60 saved/listing reads and 20 refresh requests per minute. Partners share the owner's app allowance.

Actual upstream sold-comps requests have a global 10/minute budget; eBay listing searches have a global 60/minute budget. These Postgres counters apply across instances, accounts, REST/MCP operations and background jobs. They are fixed calendar-minute windows, separate from each card/finish/source's existing shared refresh claim and cooldown. Saved checks and cache hits never consume provider budget. They limit request rate, not monthly spend.

Exhausted limits return HTTP 429 and `Retry-After`; unavailable counters fail closed with 503. Background comparison jobs treat exhausted/unavailable budgets as retryable and use their existing two-minute backoff. Tests use synthetic counters and assert no upstream request follows a denial; do not exhaust shared production provider counters to smoke-test a 429.

For native staged contracts run `bun test tests/native-developer-operations.test.ts` for actual REST/MCP HTTP round trips with isolated synthetic auth/backend dependencies. The unmodified admission gate proves zero executor requests; a subprocess-only module mock separately exercises dispatcher-to-bridge forwarding, replay/error/privacy behavior. This is not hosted SQL/OAuth or enabled-feature proof. No native live write smoke is authorized while #379 admission is denied. Native reads/pagination remain blocked on the exact cookie-RLS/developer projection incompatibility in `docs/native-developer-operations.md`.
