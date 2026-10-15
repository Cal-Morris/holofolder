-- Run against the isolated importer fixture DB after migration 029 and the small import.
BEGIN;
UPDATE public.card_prices SET gbp_amount=999 WHERE card_id='swsh4.5-SV068' AND language='en';
UPDATE public.card_prices SET fetched_at=now(), source_updated_at=now(), finish_prices=jsonb_build_array(jsonb_build_object(
  'finish','holo','variantKey','holo','confidence','high','sourcePrices',jsonb_build_array(jsonb_build_object(
    'source','tcgplayer','currency','USD','originalCurrency','USD','productId','232439',
    'originalMarketAmount',7,'originalLowAmount',2,'updatedAt',now()
  )))) WHERE card_id='swsh4.5-SV068' AND language='en';
DO $$ BEGIN
  IF (SELECT count(*) FROM public.card_prices p CROSS JOIN LATERAL jsonb_array_elements(p.history_points) point
    WHERE p.card_id='swsh4.5-SV068' AND point->>'date'=to_char(now(),'YYYY-MM-DD') AND point->>'amount'='7' AND point->>'currency'='USD') <> 1
    THEN RAISE EXCEPTION 'The refresh must capture one real native quote'; END IF;
END $$;
UPDATE public.card_prices SET fetched_at=now()+interval '1 second', finish_prices=jsonb_build_array(jsonb_build_object(
  'finish','holo','variantKey','holo','confidence','high','sourcePrices',jsonb_build_array(jsonb_build_object(
    'source','tcgplayer','originalCurrency','USD','productId','999999',
    'originalMarketAmount',99,'updatedAt',now()
  )))) WHERE card_id='swsh4.5-SV068' AND language='en';
DO $$ BEGIN
  IF EXISTS(SELECT FROM public.card_prices p CROSS JOIN LATERAL jsonb_array_elements(p.history_points) point WHERE p.card_id='swsh4.5-SV068' AND point->>'amount'='99')
    THEN RAISE EXCEPTION 'A mismatched product cannot supply history'; END IF;
END $$;
UPDATE public.card_prices SET fetched_at=now()+interval '2 seconds', source_updated_at=NULL, finish_prices=jsonb_build_array(jsonb_build_object(
  'finish','holo','variantKey','holo','confidence','low','sourcePrices',jsonb_build_array(jsonb_build_object(
    'source','tcgplayer','originalCurrency','USD','productId','232439','originalMarketAmount',88
  )))) WHERE card_id='swsh4.5-SV068' AND language='en';
DO $$ BEGIN
  IF EXISTS(SELECT FROM public.card_prices p CROSS JOIN LATERAL jsonb_array_elements(p.history_points) point WHERE p.card_id='swsh4.5-SV068' AND point->>'amount'='88')
    THEN RAISE EXCEPTION 'Undated thin evidence must not acquire a new date'; END IF;
  IF (SELECT gbp_amount FROM public.card_prices WHERE card_id='swsh4.5-SV068' AND language='en')<>999
    THEN RAISE EXCEPTION 'History must never replace the current price'; END IF;
END $$;
UPDATE public.card_prices SET fetched_at=now()+interval '3 seconds', finish_prices=jsonb_build_array(jsonb_build_object(
  'finish','holo','variantKey','holo','sourcePrices',jsonb_build_array(jsonb_build_object(
    'source','tcgplayer','originalCurrency','USD','productId','232439','originalMarketAmount',87
  )))) WHERE card_id='swsh4.5-SV068' AND language='en';
DO $$ BEGIN
  IF EXISTS(SELECT FROM public.card_prices p CROSS JOIN LATERAL jsonb_array_elements(p.history_points) point WHERE p.card_id='swsh4.5-SV068' AND point->>'amount'='87')
    THEN RAISE EXCEPTION 'Undated evidence without confidence must not acquire a new date'; END IF;
END $$;
ROLLBACK;
