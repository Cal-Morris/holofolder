import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const sql = readFileSync(new URL("../scripts/104_audit_undo_write_speed.sql", import.meta.url), "utf8")
const fn = (name: string) => {
  const start = sql.indexOf(`CREATE OR REPLACE FUNCTION ${name}(`)
  assert.ok(start >= 0, `${name} is written out in full`)
  return sql.slice(start, sql.indexOf("$function$;", start))
}

test("104 redact gate covers every key redact() removes", () => {
  const redact = fn("collection_audit_private.redact")
  const gate = new RegExp(redact.match(/value::text !~ '([^']+)'/)![1])
  const keys = redact.match(/key NOT IN \(([^)]+)\)/)![1].split(",").map(k => k.trim().replace(/^'|'$/g, ""))
  assert.ok(keys.length >= 12)
  for (const key of [...keys, "artwork"]) assert.match(JSON.stringify({ [key]: 1 }).replace(":", ": "), gate, key)
  for (const key of ["xlabel", "Label", "labels", "cardId"]) assert.doesNotMatch(`{"${key}": 1}`, gate, key)
})

test("104 keeps placement checks on every column check_slot_placement_v1 reads", () => {
  assert.match(sql, /AFTER INSERT OR DELETE ON public\.binder_slots\s+DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public\.check_slot_placement_v1\(\)/)
  assert.match(sql, /AFTER UPDATE ON public\.binder_slots\s+DEFERRABLE INITIALLY DEFERRED FOR EACH ROW\s+WHEN \(OLD\.status IS DISTINCT FROM NEW\.status OR OLD\.id IS DISTINCT FROM NEW\.id OR OLD\.collection_id IS DISTINCT FROM NEW\.collection_id\)/)
})

test("104 keeps command and recovery semantics in the rewritten bodies", () => {
  assert.doesNotMatch(sql, /prosrc|replace\(p/i)
  assert.match(fn("collection_audit_private.capture"), /WHERE NOT EXISTS\(SELECT 1 FROM collection_audit_private\.pending p/)
  const inventory = fn("public.inventory_command_v1")
  assert.equal(inventory.match(/i\.id=ANY\(ARRAY\(SELECT u\.id FROM public\.inventory_items u/g)?.length, 2)
  assert.match(inventory, /ORDER BY i\.id COLLATE "C" LIMIT 1 FOR UPDATE;/)
  for (const body of [inventory, fn("public.slot_command_v1")]) {
    assert.match(body, /IF public\.billing_enforced\(\) AND NOT public\.billing_has_paid\(owner_id\) THEN saved_before:=public\.slot_saved_count_v1\(owner_id\); END IF;/)
    assert.match(body, /IF saved_before IS NOT NULL AND public\.billing_enforced\(\) AND NOT public\.billing_has_paid\(owner_id\) AND public\.slot_saved_count_v1\(owner_id\)>saved_before THEN/)
  }
  const plan = fn("collection_audit_private.recovery_plan_v1")
  assert.match(plan, /IF tbl IN \('pokemon_collection','binder_legacy_rows'\) THEN\s+EXECUTE format/)
  assert.doesNotMatch(plan, /e->>'table'='inventory_items' AND e->>'id'=key/)
})
