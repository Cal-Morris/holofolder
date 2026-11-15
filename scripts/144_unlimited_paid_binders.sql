-- 144: Premium and lifetime owners get unlimited binders. Drops the 99-binder safety ceiling (123) from
-- developer_create_binder, create_collection_v1 and enforce_binder_billing. The free allowance
-- (billing_configuration.free_binder_limit, 4 after 142) is the only binder limit left. Idempotent.
BEGIN;
SET LOCAL lock_timeout='3s';
DO $unlimited_binders$
DECLARE fn regprocedure; body text;
BEGIN
 FOREACH fn IN ARRAY ARRAY[
   'collection_audit_private.create_collection_v1(uuid,uuid,jsonb,jsonb)'::regprocedure,
   'public.developer_create_binder(uuid,uuid,text,text,text)'::regprocedure] LOOP
  SELECT pg_get_functiondef(fn) INTO body;
  CONTINUE WHEN position('binder_safety_limit_reached' IN body)=0;
  body:=regexp_replace(body,'\n\s*IF binder_count>=99 THEN RAISE EXCEPTION ''binder_safety_limit_reached''[^;]*; END IF;','');
  IF position('binder_safety_limit_reached' IN body)>0 THEN RAISE EXCEPTION 'binder_ceiling_anchor_changed: %',fn; END IF;
  EXECUTE body;
 END LOOP;
END $unlimited_binders$;

CREATE OR REPLACE FUNCTION public.enforce_binder_billing()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE total bigint; allowed integer;
BEGIN
 IF TG_OP='UPDATE' THEN
  IF NEW.owner_user_id IS DISTINCT FROM OLD.owner_user_id THEN
   RAISE EXCEPTION 'Binder owner cannot be changed' USING ERRCODE='42501';
  END IF;
  RETURN NEW;
 END IF;
 -- Paid owners have no binder limit; only an enforced free plan counts.
 IF NOT public.billing_enforced() OR public.billing_has_paid(NEW.owner_user_id) THEN RETURN NEW; END IF;
 -- AFTER INSERT also lets an idempotent default-binder ON CONFLICT do nothing.
 PERFORM pg_advisory_xact_lock(hashtextextended(NEW.owner_user_id::text,4701));
 SELECT free_binder_limit INTO allowed FROM public.billing_configuration WHERE id;
 SELECT count(*) INTO total FROM public.binders WHERE owner_user_id=NEW.owner_user_id;
 IF total>allowed THEN RAISE EXCEPTION 'binder_limit_reached' USING ERRCODE='P0001'; END IF;
 RETURN NEW;
END $function$;

ALTER TABLE public.billing_configuration DROP CONSTRAINT IF EXISTS billing_free_binder_limit_check;
ALTER TABLE public.billing_configuration ADD CONSTRAINT billing_free_binder_limit_check CHECK (free_binder_limit>=1);
NOTIFY pgrst,'reload schema';
COMMIT;
