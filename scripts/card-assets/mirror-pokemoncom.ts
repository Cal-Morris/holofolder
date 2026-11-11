/**
 * Copies official pokemon.com card scans into the card image store (R2) and records them on each card
 * (`external_ids_json.pokemoncom.image`), so the app serves them from R2 and never calls pokemon.com at runtime.
 * Only the asset CDN is fetched (URLs built from our own set and card ids), never the pokemon.com HTML pages.
 *
 *   bun run card-assets mirror-pokemoncom [--set a,b] [--concurrency 6] [--max-class-a 200000] [--max-gb 8] [--dry-run] [--recheck]
 *
 * Env: CARD_IMAGE_STORE=r2 and the R2_* variables, POSTGRES_URL_NON_POOLING (or DATABASE_URL), and
 * SUPABASE_SERVICE_ROLE_KEY for the image inventory. --dry-run HEADs pokemon.com and writes nothing (R2 optional).
 *
 * Idempotent: one R2 LIST per set skips copies already there without contacting pokemon.com, uploads never overwrite,
 * and the database is only written where the recorded URL changes. Every copy is tagged with its origin (R2 metadata:
 * source, source-url, source-etag, source-sha256). --recheck also HEADs each stored copy and its origin and replaces
 * only those whose origin ETag (an MD5 of the file on pokemon.com's S3 bucket) has changed. A set whose first cards all 404 is treated as not on pokemon.com.
 * Rerun after `sync-card-db` picks up a new set.
 */
import { Client } from "pg"
import { getMirrorDatabaseUrl } from "../../lib/card-db-sync"
import { createCardImageMirror } from "../../lib/card-image-blob"
import { recordMirroredCardImages } from "../../lib/card-image-inventory"
import { createR2Deps, getR2Config } from "../../lib/card-image-r2"
import { CARD_IMAGE_SOURCE_PREFIX, parseSourceCardImageUrl, type SourceCardImageRef } from "../../lib/card-image-sources"
import { getCardImageStoreKind } from "../../lib/card-image-store"
import { convertSourceImageToWebp } from "../../lib/card-image-transform"
import { loadProjectEnvFiles } from "../../lib/load-project-env"
import { pokemonComCardImageUrl, pokemonComSetCode } from "../../lib/pokemoncom-card-images"
import { createPoliteFetch } from "./mirror-tcgdex"

/** Consecutive 404s at the start of a set before it is treated as not on pokemon.com. */
const MISSING_SET_PROBE = 5

function arg(name: string) {
  const index = process.argv.indexOf(`--${name}`)
  return index >= 0 ? process.argv[index + 1] : undefined
}

async function mapWithConcurrency<T>(items: T[], concurrency: number, run: (item: T) => Promise<void>) {
  let next = 0
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (next < items.length) await run(items[next++])
  }))
}

export async function run() {
  await loadProjectEnvFiles()
  const dryRun = process.argv.includes("--dry-run")
  const recheck = process.argv.includes("--recheck")
  const concurrency = Number(arg("concurrency") ?? 6)
  const config = getCardImageStoreKind() === "r2" ? getR2Config() : null
  if (!config && !dryRun) throw new Error("Set CARD_IMAGE_STORE=r2 and the R2_* variables (this script only targets R2)")
  const { politeFetch, stats } = createPoliteFetch({
    maxClassA: Number(arg("max-class-a") ?? 200_000),
    maxBytes: Number(arg("max-gb") ?? 8) * 1024 ** 3,
    endpointPrefix: `https://${config?.accountId}.r2.cloudflarestorage.com/`,
  })
  const deps = config && createR2Deps(config, { fetch: politeFetch, onObjects: dryRun ? undefined : (keys) => recordMirroredCardImages(config.bucket, keys) })
  const mirror = deps && createCardImageMirror({ ...deps, logger: (message) => console.warn(`[pokemoncom] ${message}`), transformSourceImage: convertSourceImageToWebp })

  const db = new Client({ connectionString: getMirrorDatabaseUrl() })
  await db.connect()
  const requested = new Set((arg("set") ?? "").split(",").map((id) => id.trim()).filter(Boolean))
  const setIds = (await db.query<{ id: string }>("select id from public.tcg_sets order by id")).rows
    .map((row) => row.id)
    .filter((id) => !requested.size || requested.has(id))

  const totals = { sets: 0, setsMissing: [] as string[], cards: 0, existing: 0, uploaded: 0, replaced: 0, unchanged: 0, notFound: 0, failed: 0, recorded: 0 }
  for (const setId of setIds) {
    const code = pokemonComSetCode(setId)
    if (!code) continue
    const cards = (await db.query<{ id: string; local_id: string; image: string | null }>(
      "select id, local_id, external_ids_json->'pokemoncom'->>'image' as image from public.tcg_cards where set_id = $1 order by local_id_sort, local_id",
      [setId],
    )).rows.flatMap((card) => {
      const ref = parseSourceCardImageUrl(pokemonComCardImageUrl(setId, card.local_id) ?? "")
      return ref ? [{ ...card, ref }] : []
    })
    if (!cards.length) continue

    const stored = new Set(deps ? await deps.list(`${CARD_IMAGE_SOURCE_PREFIX}/pokemoncom/${code}/`) : [])
    const found = new Map<string, SourceCardImageRef>()
    let notFound = 0
    let failed = 0
    const missing = cards.filter((card) => {
      if (!stored.has(card.ref.pathname)) return true
      found.set(card.id, card.ref)
      return false
    })

    // Probe the start of a set nothing is stored for yet, so uncovered sets cost a handful of requests.
    const probe = found.size ? [] : missing.slice(0, MISSING_SET_PROBE)
    const copy = async (card: (typeof cards)[number]) => {
      try {
        if (dryRun || !mirror) {
          const response = await fetch(card.ref.url, { method: "HEAD", signal: AbortSignal.timeout(20_000) })
          if (response.status === 404) notFound += 1
          else if (response.ok) found.set(card.id, card.ref)
          else failed += 1
          return
        }
        await mirror.ensureSourceMirrored(card.ref, { assumeMissing: true })
        found.set(card.id, card.ref)
        totals.uploaded += 1
      } catch (error) {
        if ((error as { status?: number }).status === 404) notFound += 1
        else {
          failed += 1
          console.warn(`[pokemoncom] ${card.id}: ${error instanceof Error ? error.message : error}`)
        }
      }
    }
    await mapWithConcurrency(probe, concurrency, copy)
    if (probe.length === MISSING_SET_PROBE && !found.size && notFound === MISSING_SET_PROBE) {
      totals.setsMissing.push(setId)
      continue
    }
    await mapWithConcurrency(missing.slice(probe.length), concurrency, copy)

    if (recheck && deps && mirror) {
      await mapWithConcurrency(cards.filter((card) => stored.has(card.ref.pathname)), concurrency, async (card) => {
        try {
          const [origin, copy] = await Promise.all([
            fetch(card.ref.url, { method: "HEAD", signal: AbortSignal.timeout(20_000) }),
            deps.head(card.ref.pathname),
          ])
          const originEtag = origin.headers.get("etag")?.replaceAll('"', "")
          if (!origin.ok || !originEtag || copy?.metadata?.["source-etag"] === originEtag) {
            totals.unchanged += 1
            return
          }
          if (dryRun) return void (totals.replaced += 1)
          const image = await mirror.fetchFromSource(card.ref)
          await deps.put(card.ref.pathname, image.body, image.contentType, { metadata: image.metadata, overwrite: true })
          totals.replaced += 1
        } catch (error) {
          failed += 1
          console.warn(`[pokemoncom] recheck ${card.id}: ${error instanceof Error ? error.message : error}`)
        }
      })
    }

    const changed = cards.filter((card) => found.has(card.id) && card.image !== card.ref.url)
    if (!dryRun && changed.length) {
      await db.query(
        `update public.tcg_cards c
            set external_ids_json = c.external_ids_json || jsonb_build_object('pokemoncom', jsonb_build_object('image', u.image)),
                updated_at = now()
           from unnest($1::text[], $2::text[]) as u(id, image)
          where c.id = u.id`,
        [changed.map((card) => card.id), changed.map((card) => card.ref.url)],
      )
    }

    totals.sets += 1
    totals.cards += cards.length
    totals.existing += cards.length - missing.length
    totals.notFound += notFound
    totals.failed += failed
    totals.recorded += dryRun ? 0 : changed.length
    console.log(`[pokemoncom] ${setId} (${code}): ${cards.length} cards, ${found.size} on pokemon.com, ${notFound} not found, ${failed} failed, ${changed.length} ${dryRun ? "to record" : "recorded"}`)
  }

  await db.end()
  console.log(JSON.stringify({ dryRun, ...totals, ...stats }, null, 2))
  if (totals.failed) process.exitCode = 2
}

