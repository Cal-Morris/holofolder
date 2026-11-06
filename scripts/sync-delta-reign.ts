/** Scoped, additive TCGCSV fallback. Dry run by default; --apply commits only Delta Reign.
 * Images are checked at the approved origin, never uploaded here. Follow with the bounded me06 backfill.
 * After applying, the production mirror cache must expire or be revalidated before claiming availability.
 */
import { Client } from "pg"
import { getMirrorDatabaseUrl, upsertRestSetPayload } from "../lib/card-db-sync"
import { mapWithConcurrency } from "../lib/card-db-sync-concurrency"
import { DELTA_REIGN, planDeltaReignSupplement, type SupplementGroup } from "../lib/card-set-supplement"
import type { GapProduct } from "../lib/card-gap-fill"
import { loadProjectEnvFiles } from "../lib/load-project-env"

async function source<T>(path: string): Promise<T[]> {
  const response = await fetch(`https://tcgcsv.com/tcgplayer/3/${path}`, {
    headers: { "User-Agent": "binderdex/1.0.0", Accept: "application/json" }, signal: AbortSignal.timeout(30_000),
  })
  if (!response.ok) throw new Error(`TCGCSV ${path}: HTTP ${response.status}`)
  const body = await response.json() as { success?: boolean; results?: T[] }
  if (!body.success || !Array.isArray(body.results)) throw new Error("Invalid TCGCSV response")
  return body.results
}

async function main() {
  const args = process.argv.slice(2)
  if (args.some(arg => arg !== "--apply")) throw new Error("Usage: bun scripts/sync-delta-reign.ts [--apply]")
  await loadProjectEnvFiles()
  const [groups, products] = await Promise.all([source<SupplementGroup>("groups"), source<GapProduct>(`${DELTA_REIGN.group}/products`)])
  const group = groups.find(row => row.groupId === DELTA_REIGN.group)
  if (!group) throw new Error("Delta Reign group missing from source")
  // Validate before touching the database or making image requests.
  const draft = planDeltaReignSupplement(group, products, new Set())
  if (draft.cards.length > 250) throw new Error("Source exceeds this import's 250-card budget")
  const images = new Set<string>()
  await mapWithConcurrency(draft.externalSources, 4, async card => {
    const response = await fetch(`https://product-images.tcgplayer.com/${card.source_card_id}.jpg`, {
      method: "HEAD", signal: AbortSignal.timeout(15_000),
    }).catch(() => null)
    if (response?.ok && response.headers.get("content-type")?.startsWith("image/")) images.add(card.source_card_id)
  })
  const payload = planDeltaReignSupplement(group, products, images)
  const client = new Client({ connectionString: getMirrorDatabaseUrl() })
  await client.connect()
  try {
    await client.query("BEGIN")
    // Same lock as the existing catalog sync; don't race TCGdex or another supplement.
    const lock = await client.query<{ locked: boolean }>("select pg_try_advisory_xact_lock(10250418) as locked")
    if (!lock.rows[0]?.locked) throw new Error("A card database sync is already running")
    const series = await client.query("select id from public.tcg_series where id = 'me'")
    if (!series.rowCount) throw new Error("Mega Evolution series missing from target catalog")
    const existing = await client.query<{ raw_json: { supplementalSources?: { tcgcsv?: SupplementGroup } } }>("select raw_json from public.tcg_sets where id = $1", [DELTA_REIGN.id])
    if (existing.rowCount && existing.rows[0].raw_json.supplementalSources?.tcgcsv?.groupId !== DELTA_REIGN.group) throw new Error("Set is already supplied by another source; refusing to overwrite")
    const before = await client.query("select count(*)::int as cards from public.tcg_cards where set_id = $1", [DELTA_REIGN.id])
    console.log(JSON.stringify({ mode: args.includes("--apply") ? "apply" : "dry-run", set: payload.sets[0], sourceProducts: products.length,
      cards: payload.cards.length, categories: Object.fromEntries(["Pokemon", "Trainer", "Energy"].map(category => [category, payload.cards.filter(c => c.category === category).length])),
      verifiedImages: images.size, dexLinks: payload.dexLinks.length, existingCards: before.rows[0].cards, imageUploads: 0 }, null, 2))
    if (!args.includes("--apply")) { await client.query("ROLLBACK"); return }
    await upsertRestSetPayload(client, payload, undefined, false)
    const result = await client.query("select count(*)::int as cards, count(distinct local_id)::int as numbers from public.tcg_cards where set_id = $1", [DELTA_REIGN.id])
    if (result.rows[0].cards !== payload.cards.length || result.rows[0].numbers !== payload.cards.length) throw new Error("Post-import count mismatch")
    await client.query("COMMIT")
    console.log(JSON.stringify({ committed: true, ...result.rows[0] }))
  } catch (error) {
    await client.query("ROLLBACK")
    throw error
  } finally {
    await client.end()
  }
}

main().catch(error => { console.error(error instanceof Error ? error.message : "Import failed"); process.exitCode = 1 })
