import type { Page, Route } from "@playwright/test"
import { collectionFingerprint } from "../lib/collection/sync"
import { normalizeCollectionItem } from "../lib/collection/normalize"
import type { CollectedPokemon } from "../lib/domain/cards"
import { expect, SEEDED_COLLECTION, SUPABASE_URL } from "./fixtures"

type Row = Record<string, unknown> & { pokemon_id: number }

/**
 * In-memory stand-in for pokemon_collection behind /api/collection, with the same contract as the real route:
 * upsert on (user, pokemon_id), delete by key, and compare-and-set via baseFingerprint (409 + current row).
 */
export class FakeCollectionServer {
  rows = new Map<number, Row>()
  writes: Array<{ method: string; pokemonId: number; status: number; at: number }> = []
  failNext: Array<{ method: string; pokemonId: number; status: number }> = []

  constructor() {
    for (const row of SEEDED_COLLECTION) this.rows.set(row.pokemon_id, { ...row })
  }

  fingerprint(pokemonId: number) {
    const row = this.rows.get(pokemonId)
    return collectionFingerprint(row ? normalizeCollectionItem(row as Partial<CollectedPokemon>) : null)
  }

  async install(page: Page) {
    await page.route("**/api/collection**", (route) => this.handle(route))
    await page.route(`${SUPABASE_URL}/rest/v1/pokemon_collection**`, (route) =>
      route.request().method() === "GET"
        ? route.fulfill({ json: [...this.rows.values()].sort((a, b) => a.pokemon_id - b.pokemon_id) })
        : route.fallback())
  }

  private async handle(route: Route) {
    const request = route.request()
    const url = new URL(request.url())
    const method = request.method()
    const body = method === "POST" ? request.postDataJSON() : null
    const pokemonId = Number(method === "POST" ? body?.pokemonId : url.searchParams.get("pokemonId"))
    const baseFingerprint = method === "POST" ? body?.baseFingerprint : url.searchParams.get("baseFingerprint")

    const failure = this.failNext.findIndex((entry) => entry.method === method && entry.pokemonId === pokemonId)
    if (failure >= 0) {
      const [{ status }] = this.failNext.splice(failure, 1)
      this.writes.push({ method, pokemonId, status, at: Date.now() })
      return route.fulfill({ status, json: { error: `simulated ${status}` } })
    }

    if (typeof baseFingerprint === "string" && baseFingerprint && baseFingerprint !== this.fingerprint(pokemonId)) {
      this.writes.push({ method, pokemonId, status: 409, at: Date.now() })
      return route.fulfill({ status: 409, json: { error: "changed", item: this.rows.get(pokemonId) ?? null } })
    }

    if (method === "DELETE") {
      this.rows.delete(pokemonId)
      this.writes.push({ method, pokemonId, status: 200, at: Date.now() })
      return route.fulfill({ json: { success: true } })
    }

    const existing = this.rows.get(pokemonId)
    const row: Row = {
      id: existing?.id ?? `server-${pokemonId}`,
      user_id: "00000000-0000-4000-8000-0000000000e2",
      pokemon_id: pokemonId,
      pokemon_name: body.pokemonName,
      card_id: body.cardId ?? null,
      card_name: body.cardName ?? null,
      card_image: body.cardImage ?? null,
      card_set: body.cardSet ?? null,
      card_language: body.cardLanguage ?? "en",
      card_finish: body.cardFinish ?? "normal",
      wanted_cards: body.wantedCards ?? [],
      status: body.status ?? "collected",
      collected_at: existing?.collected_at ?? new Date().toISOString(),
    }
    this.rows.set(pokemonId, row)
    this.writes.push({ method, pokemonId, status: 200, at: Date.now() })
    return route.fulfill({ json: { item: row } })
  }
}

const cdpSessions = new WeakMap<Page, Awaited<ReturnType<ReturnType<Page["context"]>["newCDPSession"]>>>()

export async function setNetwork(page: Page, offline: boolean) {
  await page.context().setOffline(offline)
  // CDP keeps navigator.onLine right in emulated standalone mode too (the session must stay attached).
  let session = cdpSessions.get(page)
  if (!session) {
    session = await page.context().newCDPSession(page)
    cdpSessions.set(page, session)
  }
  await session.send("Network.emulateNetworkConditions", { offline, latency: 0, downloadThroughput: -1, uploadThroughput: -1 })
  await expect.poll(() => page.evaluate(() => navigator.onLine)).toBe(!offline)
}
