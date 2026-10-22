import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const sql = readFileSync(new URL("../scripts/038_pin_function_search_path.sql", import.meta.url), "utf8").replace(/^\s*--.*$/gm, "")

const flagged = [
  "graphile_worker.add_job(text, json, text, timestamp with time zone, integer, text, integer, text[], text)",
  "graphile_worker.add_jobs(graphile_worker.job_spec[], boolean)",
  "graphile_worker.complete_jobs(bigint[])",
  "graphile_worker.force_unlock_workers(text[])",
  "graphile_worker.permanently_fail_jobs(bigint[], text)",
  "graphile_worker.remove_job(text)",
  "graphile_worker.reschedule_jobs(bigint[], timestamp with time zone, integer, integer, integer)",
  "public.infer_card_finish_from_tcg_metadata(text, text, integer, jsonb)",
]

test("every flagged function gets an empty search_path", () => {
  for (const fn of flagged) assert.ok(sql.includes(`'${fn}'`), fn)
  assert.match(sql, /ALTER FUNCTION %s SET search_path = %L', to_regprocedure\(fn\), ''\)/)
})

test("missing functions are skipped so the script runs anywhere", () => {
  assert.match(sql, /IF to_regprocedure\(fn\) IS NOT NULL THEN/)
  assert.doesNotMatch(sql, /CREATE OR REPLACE|DROP /i)
})
