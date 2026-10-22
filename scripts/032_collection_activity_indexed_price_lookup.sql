-- Fast collection writes.
-- The collection_activity_capture trigger (027) looked up the card's tracked prices with
--   card_prices WHERE (card matches) OR EXISTS (wanted card matches)
-- The OR EXISTS can't use an index, so every insert, update or delete on pokemon_collection walked all
-- ~22k card_prices rows: ~180 ms of trigger time per collection write.
-- This version builds the (card_id, language) keys first (the slot's card plus its wanted cards) and
-- joins them to card_prices on its primary key. It reads the same rows and records the same history.
-- Idempotent: CREATE OR REPLACE of the 027 function; the trigger itself is unchanged.

CREATE OR REPLACE FUNCTION public.record_collection_activity() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE before_row JSONB; after_row JSONB; row_data JSONB; price_row RECORD;
BEGIN
  IF TG_OP <> 'INSERT' THEN before_row := to_jsonb(OLD); END IF;
  IF TG_OP <> 'DELETE' THEN after_row := to_jsonb(NEW); END IF;
  row_data := COALESCE(after_row,before_row);
  IF public.analytics_collection_identity(before_row) IS DISTINCT FROM public.analytics_collection_identity(after_row)
    AND EXISTS(SELECT 1 FROM auth.users WHERE id=(row_data->>'user_id')::uuid) THEN
    INSERT INTO public.collection_activity(owner_user_id,pokemon_id,pokemon_name,before_state,after_state)
    VALUES((row_data->>'user_id')::uuid,(row_data->>'pokemon_id')::integer,row_data->>'pokemon_name',public.analytics_collection_state(before_row),public.analytics_collection_state(after_row));
  END IF;
  IF after_row IS NOT NULL THEN
    FOR price_row IN
      SELECT p.* FROM public.card_prices p
      JOIN (
        SELECT after_row->>'card_id' AS card_id, COALESCE(after_row->>'card_language','en') AS language
        UNION
        SELECT w->>'card_id', COALESCE(w->>'card_language','en')
        FROM jsonb_array_elements(CASE WHEN jsonb_typeof(after_row->'wanted_cards')='array' THEN after_row->'wanted_cards' ELSE '[]'::jsonb END) w
      ) tracked ON p.card_id=tracked.card_id AND p.language=tracked.language
    LOOP PERFORM public.analytics_capture_price(to_jsonb(price_row)); END LOOP;
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END
$$;

REVOKE ALL ON FUNCTION public.record_collection_activity() FROM PUBLIC, anon, authenticated;
