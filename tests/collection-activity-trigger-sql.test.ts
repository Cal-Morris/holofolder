import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

test("collection activity trigger looks up tracked prices by primary key, not a full card_prices scan", () => {
  const sql = readFileSync(new URL("../scripts/032_collection_activity_indexed_price_lookup.sql", import.meta.url), "utf8")
  const body = sql.slice(sql.indexOf("CREATE OR REPLACE FUNCTION public.record_collection_activity()"))
  // An OR EXISTS over wanted cards can't use an index and walks every card_prices row per write.
  assert.doesNotMatch(body, /\)\s+OR\s+EXISTS\s*\(/i)
  assert.match(body, /JOIN \(/)
  assert.match(body, /ON p\.card_id=tracked\.card_id AND p\.language=tracked\.language/)
  // Keeps the 027 contract: definer function with an empty search_path, not callable by clients.
  assert.match(body, /SECURITY DEFINER SET search_path = ''/)
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.record_collection_activity\(\) FROM PUBLIC, anon, authenticated/)
})
