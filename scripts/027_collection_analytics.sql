-- History relies on genuine partner consent, not a client-supplied owner id.
REVOKE ALL ON public.partnerships FROM anon, authenticated;
GRANT SELECT, INSERT, DELETE ON public.partnerships TO authenticated;
-- Existing acceptance uses upsert; columns need privileges, but no UPDATE policy permits changes.
GRANT UPDATE(user1_id,user2_id,owner_user_id) ON public.partnerships TO authenticated;
REVOKE ALL ON public.partner_invites FROM anon, authenticated;
GRANT SELECT, INSERT ON public.partner_invites TO authenticated;
GRANT UPDATE(status) ON public.partner_invites TO authenticated;
DROP POLICY IF EXISTS "Users can create partnerships" ON public.partnerships;
CREATE POLICY "Users can create partnerships" ON public.partnerships FOR INSERT TO authenticated WITH CHECK (
  user1_id <> user2_id AND owner_user_id IN (user1_id,user2_id)
  AND auth.uid() = CASE WHEN owner_user_id=user1_id THEN user2_id ELSE user1_id END
  AND EXISTS (SELECT 1 FROM public.partner_invites i WHERE i.inviter_id=owner_user_id
    AND i.invitee_email=COALESCE(auth.jwt()->>'email','') AND i.status='pending')
);

DROP POLICY IF EXISTS "Users can update invites they received" ON public.partner_invites;
CREATE POLICY "Users can update invites they received" ON public.partner_invites FOR UPDATE TO authenticated
  USING (invitee_email=COALESCE(auth.jwt()->>'email','') AND status='pending')
  WITH CHECK (invitee_email=COALESCE(auth.jwt()->>'email','') AND status IN ('accepted','rejected'));
CREATE OR REPLACE FUNCTION public.consume_partner_invite() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF auth.uid() IS NOT NULL THEN
    UPDATE public.partner_invites SET status='accepted' WHERE inviter_id=NEW.owner_user_id
      AND invitee_email=COALESCE(auth.jwt()->>'email','') AND status='pending';
    IF NOT FOUND THEN RAISE EXCEPTION 'A pending partner invite is required'; END IF;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.consume_partner_invite() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS consume_partner_invite ON public.partnerships;
CREATE TRIGGER consume_partner_invite AFTER INSERT ON public.partnerships FOR EACH ROW EXECUTE FUNCTION public.consume_partner_invite();

-- Actual committed collection changes; historical saved dates are not backfilled as events.
CREATE TABLE IF NOT EXISTS public.collection_activity (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  owner_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  pokemon_id INTEGER NOT NULL,
  pokemon_name TEXT NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  before_state JSONB,
  after_state JSONB
);
CREATE INDEX IF NOT EXISTS collection_activity_owner_cursor ON public.collection_activity(owner_user_id, id DESC);
ALTER TABLE public.collection_activity ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.collection_activity FROM anon, authenticated;
GRANT SELECT ON public.collection_activity TO authenticated;
GRANT ALL ON public.collection_activity TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.collection_activity_id_seq TO service_role;
DROP POLICY IF EXISTS "Read own or partner activity" ON public.collection_activity;
CREATE POLICY "Read own or partner activity" ON public.collection_activity FOR SELECT TO authenticated USING (
  auth.uid() = owner_user_id OR EXISTS (
    SELECT 1 FROM public.partnerships p WHERE p.owner_user_id = collection_activity.owner_user_id AND (p.user1_id = auth.uid() OR p.user2_id = auth.uid())
  )
);

-- Compact daily observations, limited to tracked cards and 90 days, not provider payloads.
CREATE TABLE IF NOT EXISTS public.card_price_history (
  card_id TEXT NOT NULL,
  language TEXT NOT NULL,
  finish TEXT NOT NULL,
  variant_key TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('tcgplayer','cardmarket','pokepulse')),
  observed_day DATE NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  gbp_amount NUMERIC NOT NULL CHECK (gbp_amount > 0 AND gbp_amount::text NOT IN ('NaN','Infinity','-Infinity')),
  confidence TEXT NOT NULL CHECK (confidence IN ('high','medium','low','unknown')),
  source_updated_at TIMESTAMPTZ,
  PRIMARY KEY(card_id, language, variant_key, source, observed_day)
);
CREATE INDEX IF NOT EXISTS card_price_history_retention ON public.card_price_history(observed_day);
ALTER TABLE public.card_price_history ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.card_price_history FROM anon, authenticated;
GRANT SELECT ON public.card_price_history TO authenticated;
GRANT ALL ON public.card_price_history TO service_role;
DROP POLICY IF EXISTS "Read recorded card quotes" ON public.card_price_history;
CREATE POLICY "Read recorded card quotes" ON public.card_price_history FOR SELECT TO authenticated USING (true);

CREATE OR REPLACE FUNCTION public.analytics_collection_state(row_data JSONB) RETURNS JSONB LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT CASE WHEN row_data IS NULL THEN NULL ELSE jsonb_build_object(
    'status', row_data->'status', 'card_id',row_data->'card_id','card_name',row_data->'card_name',
    'card_image',row_data->'card_image','card_set',row_data->'card_set','card_language',row_data->'card_language',
    'card_finish',row_data->'card_finish','collected_at',row_data->'collected_at','wanted_cards',row_data->'wanted_cards') END
$$;
CREATE OR REPLACE FUNCTION public.analytics_collection_identity(row_data JSONB) RETURNS JSONB LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT jsonb_build_object(
    'owned', COALESCE(row_data->>'status' <> 'wishlisted',false),
    'card', CASE WHEN row_data->>'status' <> 'wishlisted' AND row_data->>'card_id' IS NOT NULL THEN jsonb_build_array(row_data->>'card_id',COALESCE(row_data->>'card_language','en'),COALESCE(row_data->>'card_finish','normal')) ELSE NULL END,
    'wanted', COALESCE((SELECT jsonb_agg(identity ORDER BY identity) FROM (
      SELECT DISTINCT jsonb_build_array(card->>'card_id',COALESCE(card->>'card_language','en'),COALESCE(card->>'card_finish','normal')) AS identity
      FROM jsonb_array_elements(CASE WHEN jsonb_typeof(row_data->'wanted_cards')='array' THEN row_data->'wanted_cards' ELSE '[]'::jsonb END) card
      WHERE card->>'card_id' IS NOT NULL
      UNION
      SELECT jsonb_build_array(row_data->>'card_id',COALESCE(row_data->>'card_language','en'),COALESCE(row_data->>'card_finish','normal'))
      WHERE row_data->>'status'='wishlisted' AND row_data->>'card_id' IS NOT NULL AND COALESCE(jsonb_array_length(CASE WHEN jsonb_typeof(row_data->'wanted_cards')='array' THEN row_data->'wanted_cards' ELSE '[]'::jsonb END),0)=0
    ) wanted), '[]'::jsonb)
  )
$$;

CREATE INDEX IF NOT EXISTS collection_analytics_card_identity ON public.pokemon_collection(card_id,card_language);
CREATE INDEX IF NOT EXISTS collection_analytics_wanted_identity ON public.pokemon_collection USING gin(wanted_cards jsonb_path_ops);

CREATE OR REPLACE FUNCTION public.analytics_capture_price(row_data JSONB) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  quote JSONB; quotes JSONB; amount NUMERIC; provider_at TIMESTAMPTZ; quote_finish TEXT; quote_variant TEXT; quote_source TEXT; quote_confidence TEXT;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.pokemon_collection c WHERE
      (c.card_id=row_data->>'card_id' AND c.card_language=COALESCE(row_data->>'language','en'))
      OR (c.wanted_cards @> jsonb_build_array(jsonb_build_object('card_id',row_data->>'card_id')) AND EXISTS (SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(c.wanted_cards)='array' THEN c.wanted_cards ELSE '[]'::jsonb END) w WHERE w->>'card_id'=row_data->>'card_id' AND COALESCE(w->>'card_language','en')=COALESCE(row_data->>'language','en')))
  ) THEN RETURN; END IF;
  quotes := CASE WHEN jsonb_typeof(row_data->'finish_prices')='array' THEN row_data->'finish_prices' ELSE '[]'::jsonb END;
  IF jsonb_array_length(quotes)=0 THEN quotes := jsonb_build_array(jsonb_build_object(
    'marketGbpAmount',COALESCE(NULLIF(row_data->'market_gbp_amount','null'::jsonb),row_data->'gbp_amount'),
    'source',row_data->'source','confidence',row_data->'confidence','updatedAt',row_data->'source_updated_at','finish','','variantKey','unverified')); END IF;
  FOR quote IN SELECT value FROM jsonb_array_elements(quotes) LOOP
    quote_source := quote->>'source';
    quote_finish := COALESCE(quote->>'finish','');
    quote_variant := quote->>'variantKey';
    quote_confidence := COALESCE(quote->>'confidence','unknown');
    IF quote_source IS NULL OR quote_source NOT IN ('tcgplayer','cardmarket','pokepulse') OR quote_variant IS NULL OR quote_variant='' OR quote_finish NOT IN ('','normal','holo','reverse_holo') OR quote_confidence NOT IN ('high','medium','low','unknown') OR jsonb_typeof(quote->'marketGbpAmount') IS DISTINCT FROM 'number' THEN CONTINUE; END IF;
    amount := (quote->>'marketGbpAmount')::numeric;
    IF amount <= 0 THEN CONTINUE; END IF;
    BEGIN
      provider_at := NULLIF(quote->>'updatedAt','')::timestamptz;
    EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN
      provider_at := NULL;
    END;
    INSERT INTO public.card_price_history(card_id,language,finish,variant_key,source,observed_day,gbp_amount,confidence,source_updated_at)
    VALUES(row_data->>'card_id',COALESCE(row_data->>'language','en'),quote_finish,quote_variant,quote_source,(now() AT TIME ZONE 'UTC')::date,amount,quote_confidence,provider_at)
    ON CONFLICT(card_id,language,variant_key,source,observed_day) DO UPDATE SET gbp_amount=EXCLUDED.gbp_amount,confidence=EXCLUDED.confidence,source_updated_at=EXCLUDED.source_updated_at,recorded_at=now();
  END LOOP;
  DELETE FROM public.card_price_history WHERE observed_day < (now() AT TIME ZONE 'UTC')::date - 89;
END
$$;

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
    FOR price_row IN SELECT p.* FROM public.card_prices p WHERE
      (p.card_id=after_row->>'card_id' AND p.language=COALESCE(after_row->>'card_language','en')) OR EXISTS (
        SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(after_row->'wanted_cards')='array' THEN after_row->'wanted_cards' ELSE '[]'::jsonb END) w WHERE w->>'card_id'=p.card_id AND COALESCE(w->>'card_language','en')=p.language
      ) LOOP PERFORM public.analytics_capture_price(to_jsonb(price_row)); END LOOP;
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END
$$;
CREATE OR REPLACE FUNCTION public.record_card_price_history() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN PERFORM public.analytics_capture_price(to_jsonb(NEW)); RETURN NEW; END
$$;
REVOKE ALL ON FUNCTION public.analytics_collection_state(JSONB), public.analytics_collection_identity(JSONB), public.analytics_capture_price(JSONB), public.record_collection_activity(), public.record_card_price_history() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS collection_activity_capture ON public.pokemon_collection;
CREATE TRIGGER collection_activity_capture AFTER INSERT OR UPDATE OR DELETE ON public.pokemon_collection FOR EACH ROW EXECUTE FUNCTION public.record_collection_activity();
DROP TRIGGER IF EXISTS card_price_history_capture ON public.card_prices;
CREATE TRIGGER card_price_history_capture AFTER INSERT OR UPDATE ON public.card_prices FOR EACH ROW EXECUTE FUNCTION public.record_card_price_history();

-- First observed quotes are dated now. Reruns do not overwrite this day's observations.
DO $$ DECLARE price_row RECORD; BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.card_price_history) THEN
    FOR price_row IN SELECT p.* FROM public.card_prices p WHERE EXISTS (
      SELECT 1 FROM public.pokemon_collection c WHERE (c.card_id=p.card_id AND c.card_language=p.language) OR EXISTS (
        SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(c.wanted_cards)='array' THEN c.wanted_cards ELSE '[]'::jsonb END) w WHERE w->>'card_id'=p.card_id AND COALESCE(w->>'card_language','en')=p.language
      )
    ) LOOP PERFORM public.analytics_capture_price(to_jsonb(price_row)); END LOOP;
  END IF;
END $$;
