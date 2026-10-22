-- Price writes: skip trigger work that can't change anything.
-- * capture_native_price_history (BEFORE INSERT OR UPDATE) ran twice per upserted row: once on the proposed insert
--   (discarded when it conflicts) and again on the update. It now skips the insert attempt when the row already
--   exists and the insert carries no history of its own, and skips the update when the quotes, history and UTC day
--   are unchanged.
-- * record_card_price_history (AFTER INSERT OR UPDATE) skips analytics capture when the prices are unchanged and
--   today's history was already recorded from them.
-- Same function signatures, owner, SECURITY DEFINER and search_path; grants are unchanged by CREATE OR REPLACE.
-- Idempotent.

CREATE OR REPLACE FUNCTION public.capture_native_price_history()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $fn$
DECLARE
  product TEXT; quote JSONB; evidence JSONB; points JSONB; amount NUMERIC; low_amount NUMERIC; provider_at TIMESTAMPTZ; observed_day DATE;
BEGIN
  IF NEW.language <> 'en' THEN RETURN NEW; END IF;
  IF TG_OP='UPDATE' AND NEW.fetched_at IS NOT DISTINCT FROM OLD.fetched_at THEN RETURN NEW; END IF;
  -- Upsert of an existing row with no history of its own: the insert attempt will conflict and the row it
  -- computes here is thrown away (the app's upserts don't SET history_points). The BEFORE UPDATE run does the work.
  IF TG_OP='INSERT' AND COALESCE(NEW.history_points,'[]'::jsonb) = '[]'::jsonb
    AND EXISTS (SELECT 1 FROM public.card_prices p WHERE p.card_id=NEW.card_id AND p.language=NEW.language) THEN RETURN NEW; END IF;
  -- Same quotes, same history, same UTC day as the last capture: the result would be identical.
  IF TG_OP='UPDATE' AND NEW.finish_prices IS NOT DISTINCT FROM OLD.finish_prices
    AND NEW.source_updated_at IS NOT DISTINCT FROM OLD.source_updated_at
    AND NEW.history_points IS NOT DISTINCT FROM OLD.history_points
    AND (OLD.fetched_at AT TIME ZONE 'UTC')::date = (now() AT TIME ZONE 'UTC')::date
    AND (NEW.fetched_at AT TIME ZONE 'UTC')::date = (now() AT TIME ZONE 'UTC')::date THEN RETURN NEW; END IF;
  SELECT source_card_id INTO product FROM public.tcg_card_external_sources WHERE card_id=NEW.card_id AND source='tcgcsv-pricing';
  IF product IS NULL OR product !~ '^[1-9][0-9]*$' THEN RETURN NEW; END IF;
  points := NEW.history_points;
  FOR quote IN SELECT value FROM jsonb_array_elements(NEW.finish_prices) LOOP
    IF COALESCE(quote->>'finish','') NOT IN ('normal','holo','reverse_holo')
      OR COALESCE(quote->>'variantKey','') NOT IN ('normal','holo','holofoil','reverse','reverseHolofoil','reverse-holofoil') THEN CONTINUE; END IF;
    FOR evidence IN SELECT value FROM jsonb_array_elements(COALESCE(quote->'sourcePrices','[]'::jsonb)) LOOP
      IF evidence->>'source' IS DISTINCT FROM 'tcgplayer' OR evidence->>'originalCurrency' IS DISTINCT FROM 'USD'
        OR evidence->>'productId' IS DISTINCT FROM product
        OR jsonb_typeof(evidence->'originalMarketAmount') IS DISTINCT FROM 'number' THEN CONTINUE; END IF;
      amount := (evidence->>'originalMarketAmount')::numeric;
      IF amount <= 0 OR amount::text IN ('NaN','Infinity','-Infinity') THEN CONTINUE; END IF;
      low_amount := CASE WHEN jsonb_typeof(evidence->'originalLowAmount')='number' THEN (evidence->>'originalLowAmount')::numeric ELSE NULL END;
      IF low_amount <= 0 OR low_amount::text IN ('NaN','Infinity','-Infinity') THEN low_amount := NULL; END IF;
      BEGIN
        provider_at := NULLIF(evidence->>'updatedAt','')::timestamptz;
      EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN CONTINUE;
      END;
      IF provider_at IS NULL THEN
        -- Undated thin or carried evidence must not acquire a new observation date.
        IF COALESCE(quote->>'confidence','unknown') NOT IN ('high','medium') THEN CONTINUE; END IF;
        provider_at := NEW.source_updated_at;
        IF provider_at IS NULL THEN provider_at := NEW.fetched_at; END IF;
      END IF;
      observed_day := (provider_at AT TIME ZONE 'UTC')::date;
      IF observed_day > (now() AT TIME ZONE 'UTC')::date OR observed_day < (now() AT TIME ZONE 'UTC')::date - 89 THEN CONTINUE; END IF;
      points := points || jsonb_build_array(jsonb_build_object('date',observed_day,'source','tcgplayer','currency','USD',
        'amount',amount,'lowAmount',low_amount,'finish',quote->>'finish','productId',product));
    END LOOP;
  END LOOP;
  SELECT COALESCE(jsonb_agg(point ORDER BY point->>'date',point->>'finish'),'[]'::jsonb) INTO NEW.history_points FROM (
    SELECT DISTINCT ON (point->>'date',point->>'productId',point->>'finish') point
    FROM jsonb_array_elements(points) WITH ORDINALITY AS entries(point,ordinality)
    WHERE point->>'date' >= to_char(now()-interval '89 days','YYYY-MM-DD')
    ORDER BY point->>'date',point->>'productId',point->>'finish',ordinality DESC
  ) deduplicated;
  RETURN NEW;
END
$fn$;

CREATE OR REPLACE FUNCTION public.record_card_price_history()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $fn$
BEGIN
  -- Today's history rows were already written from identical prices when the row was last saved today. A slot
  -- added since then is captured by the collection_activity_capture trigger (032), so nothing is lost.
  IF TG_OP='UPDATE'
    AND NEW.finish_prices IS NOT DISTINCT FROM OLD.finish_prices
    AND NEW.gbp_amount IS NOT DISTINCT FROM OLD.gbp_amount
    AND NEW.market_gbp_amount IS NOT DISTINCT FROM OLD.market_gbp_amount
    AND NEW.source IS NOT DISTINCT FROM OLD.source
    AND NEW.confidence IS NOT DISTINCT FROM OLD.confidence
    AND NEW.source_updated_at IS NOT DISTINCT FROM OLD.source_updated_at
    AND (OLD.fetched_at AT TIME ZONE 'UTC')::date = (now() AT TIME ZONE 'UTC')::date THEN RETURN NEW; END IF;
  PERFORM public.analytics_capture_price(to_jsonb(NEW));
  RETURN NEW;
END
$fn$;

REVOKE ALL ON FUNCTION public.capture_native_price_history(), public.record_card_price_history() FROM PUBLIC, anon, authenticated;
