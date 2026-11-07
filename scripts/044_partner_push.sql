-- Partner acquisitions: individual device subscriptions and a durable delivery outbox.
-- Additive, service-role writes only. Old clients continue saving collections normally.
SET lock_timeout = '3s';

CREATE TABLE IF NOT EXISTS public.push_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  label TEXT NOT NULL DEFAULT 'This device' CHECK (length(label) BETWEEN 1 AND 80),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS push_subscriptions_user_idx ON public.push_subscriptions(user_id);
ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.push_subscriptions FROM anon, authenticated;
GRANT SELECT ON public.push_subscriptions TO authenticated;
DROP POLICY IF EXISTS push_devices_own ON public.push_subscriptions;
CREATE POLICY push_devices_own ON public.push_subscriptions FOR SELECT TO authenticated USING (user_id = (select auth.uid()));

CREATE TABLE IF NOT EXISTS public.partner_acquisitions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  operation_id UUID NOT NULL,
  actor_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  recipient_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  owner_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  partnership_id UUID NOT NULL REFERENCES public.partnerships(id) ON DELETE CASCADE,
  binder_id UUID NOT NULL REFERENCES public.binders(id) ON DELETE CASCADE,
  pokemon_id INTEGER NOT NULL,
  card_id TEXT NOT NULL,
  card_name TEXT NOT NULL,
  actor_name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  UNIQUE (actor_id, operation_id),
  CHECK (actor_id <> recipient_id)
);
CREATE INDEX IF NOT EXISTS partner_acquisitions_recipient_idx ON public.partner_acquisitions(recipient_id);
CREATE INDEX IF NOT EXISTS partner_acquisitions_owner_idx ON public.partner_acquisitions(owner_user_id);
CREATE INDEX IF NOT EXISTS partner_acquisitions_partnership_idx ON public.partner_acquisitions(partnership_id);
CREATE INDEX IF NOT EXISTS partner_acquisitions_binder_idx ON public.partner_acquisitions(binder_id);
ALTER TABLE public.partner_acquisitions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.partner_acquisitions FROM anon, authenticated;

CREATE TABLE IF NOT EXISTS public.partner_push_deliveries (
  event_id UUID NOT NULL REFERENCES public.partner_acquisitions(id) ON DELETE CASCADE,
  subscription_id UUID NOT NULL REFERENCES public.push_subscriptions(id) ON DELETE CASCADE,
  lease_token UUID,
  lease_until TIMESTAMPTZ,
  attempts INTEGER NOT NULL DEFAULT 0,
  delivered_at TIMESTAMPTZ,
  last_status TEXT,
  PRIMARY KEY (event_id, subscription_id)
);
CREATE INDEX IF NOT EXISTS partner_push_deliveries_subscription_idx ON public.partner_push_deliveries(subscription_id);
ALTER TABLE public.partner_push_deliveries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.partner_push_deliveries FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.register_push_subscription(p_user UUID, p_endpoint TEXT, p_p256dh TEXT, p_auth TEXT, p_label TEXT)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE device_id UUID;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(p_user::text, 0));
  SELECT id INTO device_id FROM public.push_subscriptions WHERE endpoint = p_endpoint AND user_id = p_user;
  IF device_id IS NULL AND (SELECT count(*) FROM public.push_subscriptions WHERE user_id = p_user) >= 12 THEN
    RAISE EXCEPTION 'Device limit reached';
  END IF;
  INSERT INTO public.push_subscriptions(user_id,endpoint,p256dh,auth,label)
    VALUES(p_user,p_endpoint,p_p256dh,p_auth,left(p_label,80))
    ON CONFLICT(endpoint) DO UPDATE SET p256dh=excluded.p256dh,auth=excluded.auth,label=excluded.label,last_seen_at=now()
      WHERE push_subscriptions.user_id = p_user
    RETURNING id INTO device_id;
  IF device_id IS NULL THEN RAISE EXCEPTION 'Subscription belongs to another account'; END IF;
  RETURN device_id;
END $$;
REVOKE ALL ON FUNCTION public.register_push_subscription(UUID,TEXT,TEXT,TEXT,TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.register_push_subscription(UUID,TEXT,TEXT,TEXT,TEXT) TO service_role;

CREATE OR REPLACE FUNCTION public.save_collection_with_acquisition(
  p_owner UUID, p_binder UUID, p_actor UUID, p_pokemon INTEGER, p_row JSONB, p_expected JSONB, p_acquisition JSONB, p_actor_name TEXT
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  previous public.pokemon_collection%ROWTYPE;
  saved public.pokemon_collection%ROWTYPE;
  membership public.partnerships%ROWTYPE;
  event_id UUID;
  other_id UUID;
  new_identity TEXT;
  previous_identity TEXT;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.binders WHERE id=p_binder AND owner_user_id=p_owner) THEN
    RAISE EXCEPTION 'Binder not found';
  END IF;
  SELECT * INTO membership FROM public.partnerships
    WHERE owner_user_id=p_owner AND (user1_id=p_actor OR user2_id=p_actor) LIMIT 1 FOR KEY SHARE;
  IF p_actor <> p_owner AND membership.id IS NULL THEN RAISE EXCEPTION 'Collection access denied'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_binder::text || ':' || p_pokemon::text, 0));
  SELECT * INTO previous FROM public.pokemon_collection WHERE binder_id=p_binder AND pokemon_id=p_pokemon FOR UPDATE;
  IF (CASE WHEN previous.id IS NULL THEN NULL ELSE to_jsonb(previous) END) IS DISTINCT FROM p_expected THEN
    RETURN jsonb_build_object('conflict',true);
  END IF;
  IF previous.id IS NULL THEN
    INSERT INTO public.pokemon_collection(user_id,binder_id,pokemon_id,pokemon_name,card_id,card_name,card_image,card_set,card_language,card_finish,wanted_cards,status)
      VALUES(p_owner,p_binder,p_pokemon,p_row->>'pokemon_name',p_row->>'card_id',p_row->>'card_name',p_row->>'card_image',p_row->>'card_set',p_row->>'card_language',p_row->>'card_finish',p_row->'wanted_cards',p_row->>'status')
      ON CONFLICT(binder_id,pokemon_id) DO NOTHING RETURNING * INTO saved;
    IF saved.id IS NULL THEN RETURN jsonb_build_object('conflict',true); END IF;
  ELSE
    UPDATE public.pokemon_collection SET pokemon_name=p_row->>'pokemon_name',card_id=p_row->>'card_id',card_name=p_row->>'card_name',card_image=p_row->>'card_image',card_set=p_row->>'card_set',card_language=p_row->>'card_language',card_finish=p_row->>'card_finish',wanted_cards=p_row->'wanted_cards',status=p_row->>'status'
      WHERE id=previous.id RETURNING * INTO saved;
  END IF;
  IF saved.card_id IS NOT NULL AND saved.status <> 'wishlisted' THEN
    new_identity := saved.card_id || ':' || saved.card_language || ':' || saved.card_finish;
  END IF;
  IF previous.card_id IS NOT NULL AND previous.status <> 'wishlisted' THEN
    previous_identity := previous.card_id || ':' || previous.card_language || ':' || previous.card_finish;
  END IF;
  other_id := CASE WHEN membership.user1_id=p_actor THEN membership.user2_id ELSE membership.user1_id END;
  IF p_acquisition IS NOT NULL AND membership.id IS NOT NULL AND new_identity IS NOT NULL AND new_identity IS DISTINCT FROM previous_identity
    AND p_acquisition->>'actorId'=p_actor::text AND p_acquisition->>'partnershipId'=membership.id::text
    AND p_acquisition->>'recipientId'=other_id::text AND p_acquisition->>'printingKey'=new_identity THEN
    INSERT INTO public.partner_acquisitions(operation_id,actor_id,recipient_id,owner_user_id,partnership_id,binder_id,pokemon_id,card_id,card_name,actor_name)
      VALUES((p_acquisition->>'operationId')::uuid,p_actor,other_id,p_owner,membership.id,p_binder,p_pokemon,saved.card_id,left(coalesce(saved.card_name,saved.pokemon_name),120),left(coalesce(nullif(p_actor_name,''),'Your partner'),60))
      ON CONFLICT(actor_id,operation_id) DO NOTHING RETURNING id INTO event_id;
  END IF;
  RETURN jsonb_build_object('item',to_jsonb(saved),'event_id',event_id);
END $$;
REVOKE ALL ON FUNCTION public.save_collection_with_acquisition(UUID,UUID,UUID,INTEGER,JSONB,JSONB,JSONB,TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_collection_with_acquisition(UUID,UUID,UUID,INTEGER,JSONB,JSONB,JSONB,TEXT) TO service_role;

CREATE OR REPLACE FUNCTION public.claim_partner_push(p_event UUID, p_subscription UUID)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE token UUID := gen_random_uuid(); claimed UUID;
BEGIN
  IF NOT EXISTS(
    SELECT 1 FROM public.partner_acquisitions e
    JOIN public.partnerships p ON p.id=e.partnership_id AND p.owner_user_id=e.owner_user_id
    JOIN public.push_subscriptions s ON s.id=p_subscription AND s.user_id=e.recipient_id
    WHERE e.id=p_event AND ((p.user1_id=e.actor_id AND p.user2_id=e.recipient_id) OR (p.user2_id=e.actor_id AND p.user1_id=e.recipient_id))
  ) THEN RETURN NULL; END IF;
  INSERT INTO public.partner_push_deliveries AS d(event_id,subscription_id,lease_token,lease_until,attempts)
    VALUES(p_event,p_subscription,token,now()+interval '30 seconds',1)
    ON CONFLICT(event_id,subscription_id) DO UPDATE SET lease_token=token,lease_until=now()+interval '30 seconds',attempts=d.attempts+1
      WHERE d.delivered_at IS NULL AND d.attempts < 4 AND (d.lease_until IS NULL OR d.lease_until < now())
    RETURNING lease_token INTO claimed;
  RETURN claimed;
END $$;
REVOKE ALL ON FUNCTION public.claim_partner_push(UUID,UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_partner_push(UUID,UUID) TO service_role;
