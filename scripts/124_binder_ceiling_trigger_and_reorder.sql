-- 124: finishes 123. The enforce_binder_billing trigger (052) and developer_reorder_binders still hardcoded
-- the old 20-binder ceiling, so inserts past 20 failed and reordering more than 20 binders was rejected.
-- Both now use 99, matching MAX_BINDERS_PER_OWNER. Patches the live definitions in place. Idempotent.
BEGIN;
SET LOCAL lock_timeout='3s';
DO $binder_ceiling_124$
DECLARE body text; pair text[];
BEGIN
 SELECT pg_get_functiondef('public.enforce_binder_billing()'::regprocedure) INTO body;
 IF position('total>99 THEN' IN body)=0 THEN
  FOREACH pair SLICE 1 IN ARRAY ARRAY[
    ['allowed integer:=20;','allowed integer:=99;'],
    ['IF total>20 THEN','IF total>99 THEN'],
    ['coalesce(allowed,20)','coalesce(allowed,99)']] LOOP
   IF position(pair[1] IN body)=0 THEN RAISE EXCEPTION 'binder_trigger_anchor_changed: %',pair[1]; END IF;
   body:=replace(body,pair[1],pair[2]);
  END LOOP;
  EXECUTE body;
 END IF;

 SELECT pg_get_functiondef('public.developer_reorder_binders(uuid,uuid,uuid[])'::regprocedure) INTO body;
 IF position('cardinality(binder_order)>99 OR' IN body)=0 THEN
  IF position('cardinality(binder_order)>20 OR' IN body)=0 THEN RAISE EXCEPTION 'binder_reorder_anchor_changed'; END IF;
  EXECUTE replace(body,'cardinality(binder_order)>20 OR','cardinality(binder_order)>99 OR');
 END IF;
END $binder_ceiling_124$;
NOTIFY pgrst,'reload schema';
COMMIT;
