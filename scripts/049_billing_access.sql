-- Billing is staged off; grandfather licences exist before any paywall is enabled.
SET lock_timeout = '3s';
CREATE TABLE IF NOT EXISTS public.billing_configuration (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  grandfather_cutoff timestamptz NOT NULL DEFAULT clock_timestamp(),
  enforced boolean NOT NULL DEFAULT false
);
INSERT INTO public.billing_configuration(id) VALUES(true) ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS public.perpetual_licences (
  owner_user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  granted_at timestamptz NOT NULL DEFAULT now(),
  source text NOT NULL CHECK (source IN ('grandfathered','manual'))
);
INSERT INTO public.perpetual_licences(owner_user_id,source)
 SELECT u.id,'grandfathered' FROM auth.users u, public.billing_configuration c
 WHERE u.created_at < c.grandfather_cutoff ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS public.billing_accounts (
  owner_user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  stripe_customer_id text UNIQUE,
  stripe_subscription_id text UNIQUE,
  status text NOT NULL DEFAULT 'none',
  paid_through timestamptz,
  lock_token uuid,
  locked_until timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.billing_events (
  event_id text PRIMARY KEY,
  processed_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.billing_configuration ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.perpetual_licences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.billing_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.billing_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.billing_configuration, public.perpetual_licences, public.billing_accounts, public.billing_events FROM anon,authenticated;
GRANT ALL ON public.billing_configuration, public.perpetual_licences, public.billing_accounts, public.billing_events TO service_role;

CREATE OR REPLACE FUNCTION public.billing_has_paid(owner_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM public.perpetual_licences WHERE owner_user_id=owner_id)
 OR EXISTS(SELECT 1 FROM public.billing_accounts WHERE owner_user_id=owner_id
   AND status IN ('active','past_due') AND paid_through>now())
$$;
CREATE OR REPLACE FUNCTION public.billing_enforced() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT coalesce((SELECT enforced FROM public.billing_configuration WHERE id),false)
$$;
CREATE OR REPLACE FUNCTION public.billing_partner_allowed(owner_id uuid, actor_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT actor_id=owner_id OR ((NOT public.billing_enforced() OR public.billing_has_paid(owner_id))
  AND EXISTS(SELECT 1 FROM public.partnerships p WHERE p.owner_user_id=owner_id AND actor_id IN (p.user1_id,p.user2_id)))
$$;
CREATE OR REPLACE FUNCTION public.billing_card_weight(slot_status text,wants jsonb) RETURNS integer
LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT CASE WHEN slot_status='wishlisted' THEN greatest(1,jsonb_array_length(coalesce(wants,'[]'::jsonb)))
 ELSE 1+jsonb_array_length(coalesce(wants,'[]'::jsonb)) END
$$;
CREATE OR REPLACE FUNCTION public.get_billing_access(owner_id uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT jsonb_build_object('enforced',public.billing_enforced(),
  'perpetual',EXISTS(SELECT 1 FROM public.perpetual_licences WHERE owner_user_id=owner_id),
  'status',(SELECT status FROM public.billing_accounts WHERE owner_user_id=owner_id),
  'paid_through',(SELECT paid_through FROM public.billing_accounts WHERE owner_user_id=owner_id),
  'saved_card_count',(SELECT coalesce(sum(public.billing_card_weight(status,wanted_cards)),0) FROM public.pokemon_collection WHERE user_id=owner_id))
 WHERE (select auth.role())='service_role' OR public.billing_partner_allowed(owner_id,(select auth.uid()))
$$;
REVOKE ALL ON FUNCTION public.billing_has_paid(uuid), public.billing_enforced(), public.billing_partner_allowed(uuid,uuid), public.billing_card_weight(text,jsonb), public.get_billing_access(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.billing_has_paid(uuid), public.billing_enforced(), public.billing_partner_allowed(uuid,uuid), public.billing_card_weight(text,jsonb), public.get_billing_access(uuid) TO authenticated,service_role;

CREATE OR REPLACE FUNCTION public.enforce_collection_billing() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE total bigint; previous integer:=0; current_weight integer;
BEGIN
 IF TG_OP='UPDATE' AND NEW.user_id IS DISTINCT FROM OLD.user_id THEN
  RAISE EXCEPTION 'Collection owner cannot be changed' USING ERRCODE='42501';
 END IF;
 IF NOT public.billing_enforced() OR public.billing_has_paid(NEW.user_id) THEN RETURN NEW; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(NEW.user_id::text,4701));
 IF TG_OP='UPDATE' THEN previous:=public.billing_card_weight(OLD.status,OLD.wanted_cards); END IF;
 current_weight:=public.billing_card_weight(NEW.status,NEW.wanted_cards);
 IF current_weight<=previous THEN RETURN NEW; END IF;
 SELECT coalesce(sum(public.billing_card_weight(status,wanted_cards)),0) INTO total FROM public.pokemon_collection WHERE user_id=NEW.user_id;
 IF total>10 THEN RAISE EXCEPTION 'card_limit_reached' USING ERRCODE='P0001'; END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS enforce_collection_billing ON public.pokemon_collection;
CREATE TRIGGER enforce_collection_billing AFTER INSERT OR UPDATE ON public.pokemon_collection FOR EACH ROW EXECUTE FUNCTION public.enforce_collection_billing();

-- Restrictive policies compose with existing membership policies rather than widening them.
DO $$
DECLARE item record;
BEGIN
 FOR item IN SELECT * FROM (VALUES
  ('pokemon_collection','user_id'),('user_settings','user_id'),('binders','owner_user_id'),
  ('binder_appearances','owner_user_id'),('collection_activity','owner_user_id'),('show_purchases','owner_user_id')
 ) AS tables(table_name,owner_column) LOOP
  EXECUTE format('DROP POLICY IF EXISTS billing_partner_access ON public.%I',item.table_name);
  EXECUTE format('CREATE POLICY billing_partner_access ON public.%I AS RESTRICTIVE FOR ALL TO authenticated USING (public.billing_partner_allowed(%I,(select auth.uid()))) WITH CHECK (public.billing_partner_allowed(%I,(select auth.uid())))',item.table_name,item.owner_column,item.owner_column);
 END LOOP;
END $$;
DROP POLICY IF EXISTS billing_share_insert ON public.binder_shares;
CREATE POLICY billing_share_insert ON public.binder_shares AS RESTRICTIVE FOR INSERT TO authenticated
 WITH CHECK (NOT public.billing_enforced() OR public.billing_has_paid(owner_user_id));
DROP POLICY IF EXISTS billing_share_update ON public.binder_shares;
CREATE POLICY billing_share_update ON public.binder_shares AS RESTRICTIVE FOR UPDATE TO authenticated
 WITH CHECK (NOT is_enabled OR NOT public.billing_enforced() OR public.billing_has_paid(owner_user_id));
DROP POLICY IF EXISTS billing_invite_insert ON public.partner_invites;
CREATE POLICY billing_invite_insert ON public.partner_invites AS RESTRICTIVE FOR INSERT TO authenticated
 WITH CHECK (NOT public.billing_enforced() OR public.billing_has_paid(inviter_id));
DROP POLICY IF EXISTS billing_partnership_insert ON public.partnerships;
CREATE POLICY billing_partnership_insert ON public.partnerships AS RESTRICTIVE FOR INSERT TO authenticated
 WITH CHECK (NOT public.billing_enforced() OR public.billing_has_paid(owner_user_id));
DROP POLICY IF EXISTS billing_partnership_update ON public.partnerships;
CREATE POLICY billing_partnership_update ON public.partnerships AS RESTRICTIVE FOR UPDATE TO authenticated
 WITH CHECK (NOT public.billing_enforced() OR public.billing_has_paid(owner_user_id));

-- SECURITY DEFINER history writes bypass RLS; add the same check to the existing function.
DO $$
DECLARE definition text;
BEGIN
 SELECT pg_get_functiondef('public.sync_binder_history(uuid,uuid,uuid,uuid,jsonb)'::regprocedure) INTO definition;
 IF position('billing_partner_allowed' IN definition)=0 THEN
  definition:=replace(definition, E'BEGIN\n', E'BEGIN\n  IF NOT public.billing_partner_allowed(expected_owner, expected_account) THEN RAISE EXCEPTION ''upgrade_required'' USING ERRCODE=''42501''; END IF;\n');
  EXECUTE definition;
 END IF;
 SELECT pg_get_functiondef('public.save_collection_with_acquisition(uuid,uuid,uuid,integer,jsonb,jsonb,jsonb,text)'::regprocedure) INTO definition;
 IF position('billing_partner_allowed' IN definition)=0 THEN
  definition:=replace(definition, E'BEGIN\n', E'BEGIN\n  IF NOT public.billing_partner_allowed(p_owner, p_actor) THEN RAISE EXCEPTION ''upgrade_required'' USING ERRCODE=''42501''; END IF;\n');
  EXECUTE definition;
 END IF;
END $$;

CREATE OR REPLACE FUNCTION public.claim_billing_lock(owner_id uuid,token uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 INSERT INTO public.billing_accounts(owner_user_id) VALUES(owner_id) ON CONFLICT DO NOTHING;
 UPDATE public.billing_accounts SET lock_token=token,locked_until=now()+interval '90 seconds'
 WHERE owner_user_id=owner_id AND (locked_until IS NULL OR locked_until<now());
 RETURN FOUND;
END $$;
CREATE OR REPLACE FUNCTION public.commit_billing_state(owner_id uuid,token uuid,customer_id text,subscription_id text,subscription_status text,paid_until timestamptz,event text DEFAULT NULL) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 UPDATE public.billing_accounts SET stripe_customer_id=customer_id,stripe_subscription_id=subscription_id,
 status=subscription_status,paid_through=paid_until,updated_at=now(),lock_token=NULL,locked_until=NULL
 WHERE owner_user_id=owner_id AND lock_token=token AND locked_until>now();
 IF NOT FOUND THEN RETURN false; END IF;
 IF event IS NOT NULL THEN INSERT INTO public.billing_events(event_id) VALUES(event) ON CONFLICT DO NOTHING; END IF;
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.claim_billing_lock(uuid,uuid),public.commit_billing_state(uuid,uuid,text,text,text,timestamptz,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_billing_lock(uuid,uuid),public.commit_billing_state(uuid,uuid,text,text,text,timestamptz,text) TO service_role;
NOTIFY pgrst,'reload schema';
