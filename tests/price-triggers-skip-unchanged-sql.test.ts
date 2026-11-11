import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const sql = readFileSync(new URL('../scripts/037_price_triggers_skip_unchanged.sql', import.meta.url), 'utf8').replace(
  /^\s*--.*$/gm,
  '',
);

test('both price triggers stay security definer with an empty search path', () => {
  const fns = sql.split(/CREATE OR REPLACE FUNCTION/).slice(1);
  assert.equal(fns.length, 2);
  for (const fn of fns) {
    assert.match(fn, /SECURITY DEFINER/);
    assert.match(fn, /SET search_path TO ''/);
  }
  assert.match(
    sql,
    /REVOKE ALL ON FUNCTION public\.capture_native_price_history\(\), public\.record_card_price_history\(\) FROM PUBLIC, anon, authenticated;/,
  );
});

test('the upsert insert attempt skips history work when the row already exists', () => {
  assert.match(
    sql,
    /TG_OP='INSERT' AND COALESCE\(NEW\.history_points,'\[\]'::jsonb\) = '\[\]'::jsonb\s+AND EXISTS \(SELECT 1 FROM public\.card_prices p WHERE p\.card_id=NEW\.card_id AND p\.language=NEW\.language\) THEN RETURN NEW;/,
  );
});

test('unchanged prices on the same UTC day skip both triggers', () => {
  const [native, record] = sql.split(/CREATE OR REPLACE FUNCTION/).slice(1);
  for (const col of ['finish_prices', 'source_updated_at', 'history_points']) {
    assert.match(native, new RegExp(`NEW\\.${col} IS NOT DISTINCT FROM OLD\\.${col}`));
  }
  for (const col of ['finish_prices', 'gbp_amount', 'market_gbp_amount', 'source', 'confidence', 'source_updated_at']) {
    assert.match(record, new RegExp(`NEW\\.${col} IS NOT DISTINCT FROM OLD\\.${col}`));
  }
  assert.match(native, /\(OLD\.fetched_at AT TIME ZONE 'UTC'\)::date = \(now\(\) AT TIME ZONE 'UTC'\)::date/);
  assert.match(
    record,
    /\(OLD\.fetched_at AT TIME ZONE 'UTC'\)::date = \(now\(\) AT TIME ZONE 'UTC'\)::date THEN RETURN NEW;/,
  );
  // Changed prices still capture.
  assert.match(record, /PERFORM public\.analytics_capture_price\(to_jsonb\(NEW\)\);/);
});
