-- 123: raises the per-owner binder ceiling from 20 to 99 (MAX_BINDERS_PER_OWNER in lib/binders/model.ts).
-- It's an anti-runaway guard, not a plan allowance: Premium and lifetime owners get it as their limit.
-- Patches the 108 definitions of create_collection_v1 and developer_create_binder, and lets the free
-- allowance (052) go up to the same ceiling. Idempotent.
BEGIN;
SET LOCAL lock_timeout='3s';
DO $binder_ceiling$
DECLARE fn regprocedure; body text;
BEGIN
 FOREACH fn IN ARRAY ARRAY[
   'collection_audit_private.create_collection_v1(uuid,uuid,jsonb,jsonb)'::regprocedure,
   'public.developer_create_binder(uuid,uuid,text,text,text)'::regprocedure] LOOP
  SELECT pg_get_functiondef(fn) INTO body;
  CONTINUE WHEN position('IF binder_count>=99 THEN' IN body)>0;
  IF position('IF binder_count>=20 THEN' IN body)=0 THEN RAISE EXCEPTION 'binder_ceiling_anchor_changed: %',fn; END IF;
  EXECUTE replace(body,'IF binder_count>=20 THEN','IF binder_count>=99 THEN');
 END LOOP;
END $binder_ceiling$;
ALTER TABLE public.billing_configuration DROP CONSTRAINT IF EXISTS billing_free_binder_limit_check;
ALTER TABLE public.billing_configuration ADD CONSTRAINT billing_free_binder_limit_check CHECK (free_binder_limit BETWEEN 1 AND 99);
NOTIFY pgrst,'reload schema';
COMMIT;
