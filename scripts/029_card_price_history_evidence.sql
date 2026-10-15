-- Native, dated provider quotes are separate from current prices and rolling averages.
ALTER TABLE public.card_prices ADD COLUMN IF NOT EXISTS history_points JSONB NOT NULL DEFAULT '[]'::jsonb;

-- Keep collecting real native quotes during the existing refresh, without another polling job.
CREATE OR REPLACE FUNCTION public.capture_native_price_history() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  product TEXT; quote JSONB; evidence JSONB; points JSONB; amount NUMERIC; low_amount NUMERIC; provider_at TIMESTAMPTZ; observed_day DATE;
BEGIN
  IF NEW.language <> 'en' THEN RETURN NEW; END IF;
  IF TG_OP='UPDATE' AND NEW.fetched_at IS NOT DISTINCT FROM OLD.fetched_at THEN RETURN NEW; END IF;
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
$$;
REVOKE ALL ON FUNCTION public.capture_native_price_history() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS native_price_history_capture ON public.card_prices;
CREATE TRIGGER native_price_history_capture BEFORE INSERT OR UPDATE ON public.card_prices
FOR EACH ROW EXECUTE FUNCTION public.capture_native_price_history();
