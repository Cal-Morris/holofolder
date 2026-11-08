-- Additive: older clients keep their ten-entry guard until their next app update.
SET lock_timeout = '3s';
ALTER TABLE public.billing_configuration
  ADD COLUMN IF NOT EXISTS free_card_limit integer NOT NULL DEFAULT 100,
  ADD COLUMN IF NOT EXISTS free_binder_limit integer NOT NULL DEFAULT 1;
ALTER TABLE public.billing_configuration DROP CONSTRAINT IF EXISTS billing_free_card_limit_check;
ALTER TABLE public.billing_configuration ADD CONSTRAINT billing_free_card_limit_check CHECK (free_card_limit > 0);
ALTER TABLE public.billing_configuration DROP CONSTRAINT IF EXISTS billing_free_binder_limit_check;
ALTER TABLE public.billing_configuration ADD CONSTRAINT billing_free_binder_limit_check CHECK (free_binder_limit BETWEEN 1 AND 20);

CREATE OR REPLACE FUNCTION public.get_billing_access(owner_id uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT jsonb_build_object('enforced',c.enforced,
  'perpetual',EXISTS(SELECT 1 FROM public.perpetual_licences WHERE owner_user_id=owner_id),
  'status',(SELECT status FROM public.billing_accounts WHERE owner_user_id=owner_id),
  'paid_through',(SELECT paid_through FROM public.billing_accounts WHERE owner_user_id=owner_id),
  'saved_card_count',(SELECT coalesce(sum(public.billing_card_weight(status,wanted_cards)),0) FROM public.pokemon_collection WHERE user_id=owner_id),
  'free_card_limit',c.free_card_limit,'free_binder_limit',c.free_binder_limit)
 FROM public.billing_configuration c WHERE c.id
 AND ((select auth.role())='service_role' OR public.billing_partner_allowed(owner_id,(select auth.uid())))
$$;

CREATE OR REPLACE FUNCTION public.enforce_collection_billing() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE total bigint; previous integer:=0; current_weight integer; allowed integer;
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
 SELECT free_card_limit INTO allowed FROM public.billing_configuration WHERE id;
 IF total>coalesce(allowed,10) THEN RAISE EXCEPTION 'card_limit_reached' USING ERRCODE='P0001'; END IF;
 RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.enforce_binder_billing() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE total bigint; allowed integer:=20;
BEGIN
 IF TG_OP='UPDATE' THEN
  IF NEW.owner_user_id IS DISTINCT FROM OLD.owner_user_id THEN
   RAISE EXCEPTION 'Binder owner cannot be changed' USING ERRCODE='42501';
  END IF;
  RETURN NEW;
 END IF;
 -- AFTER INSERT also lets an idempotent default-binder ON CONFLICT do nothing.
 PERFORM pg_advisory_xact_lock(hashtextextended(NEW.owner_user_id::text,4701));
 IF public.billing_enforced() AND NOT public.billing_has_paid(NEW.owner_user_id) THEN
  SELECT free_binder_limit INTO allowed FROM public.billing_configuration WHERE id;
 END IF;
 SELECT count(*) INTO total FROM public.binders WHERE owner_user_id=NEW.owner_user_id;
 IF total>20 THEN RAISE EXCEPTION 'binder_safety_limit_reached' USING ERRCODE='P0001'; END IF;
 IF total>coalesce(allowed,20) THEN RAISE EXCEPTION 'binder_limit_reached' USING ERRCODE='P0001'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.enforce_binder_billing() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS enforce_binder_billing ON public.binders;
CREATE TRIGGER enforce_binder_billing AFTER INSERT OR UPDATE ON public.binders
 FOR EACH ROW EXECUTE FUNCTION public.enforce_binder_billing();

NOTIFY pgrst,'reload schema';
