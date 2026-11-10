-- Restore first/default creation only for an owner proven empty under the existing locks.
-- No conversion, gateway changes, new grants or absent-state terminal proof.
BEGIN;
SET LOCAL lock_timeout='3s';
DO $creation$
DECLARE body text; anchor text;
BEGIN
 SELECT pg_get_functiondef('collection_audit_private.create_collection_v1(uuid,uuid,jsonb,jsonb)'::regprocedure) INTO body;
 IF position('-- empty_owner_first_creation_098' IN body)=0 THEN
   anchor:='IF revision IS NULL THEN RAISE EXCEPTION ''storage_owner_state_unavailable'' USING ERRCODE=''55000''; END IF;';
   IF position('-- terminal_predicates_093' IN body)=0 OR position(anchor IN body)=0
     OR position('INSERT INTO public.inventory_owner_state(owner_user_id) VALUES(owner_id) ON CONFLICT DO NOTHING;' IN body)=0 THEN
     RAISE EXCEPTION 'empty_owner_first_creation_requires_093';
   END IF;
   body:=replace(body,anchor,$replacement$-- empty_owner_first_creation_098: already holding membership SHARE, management 6102 and root 4701.
 IF revision IS NULL THEN
   IF EXISTS(SELECT 1 FROM public.binders WHERE owner_user_id=owner_id)
     OR EXISTS(SELECT 1 FROM public.pokemon_collection WHERE user_id=owner_id)
     OR EXISTS(SELECT 1 FROM public.storage_collection_state WHERE owner_user_id=owner_id)
     OR EXISTS(SELECT 1 FROM public.binder_slots WHERE owner_user_id=owner_id)
     OR EXISTS(SELECT 1 FROM public.inventory_items WHERE owner_user_id=owner_id)
     OR EXISTS(SELECT 1 FROM public.inventory_placements WHERE owner_user_id=owner_id)
     OR EXISTS(SELECT 1 FROM public.binder_legacy_rows WHERE owner_user_id=owner_id)
     OR EXISTS(SELECT 1 FROM public.collection_activity WHERE owner_user_id=owner_id) THEN
     RAISE EXCEPTION 'storage_owner_state_unavailable' USING ERRCODE='55000';
   END IF;
   -- Only a prospective revision. Original validation/caps/recorder must all succeed
   -- before the original atomic INSERT persists a root, default, targets and receipt.
   revision:=0;
 END IF;$replacement$);
   EXECUTE body;
 END IF;
END $creation$;
DO $terminal$
DECLARE body text; anchor text;
BEGIN
 SELECT pg_get_functiondef('collection_audit_private.execute_creation_import_v1(text,uuid,uuid,jsonb,jsonb)'::regprocedure) INTO body;
 IF position('-- absent_root_no_proof_098' IN body)=0 THEN
   anchor:='SELECT inventory_revision INTO STRICT revision FROM public.inventory_owner_state WHERE owner_user_id=owner_id;';
   IF position(anchor IN body)=0 THEN RAISE EXCEPTION 'empty_owner_terminal_wrapper_changed'; END IF;
   body:=replace(body,anchor,$replacement$-- absent_root_no_proof_098: inner work rolled back; no authoritative revision means no discard proof.
   SELECT inventory_revision INTO revision FROM public.inventory_owner_state WHERE owner_user_id=owner_id;
   IF revision IS NULL THEN RAISE EXCEPTION 'storage_owner_state_unavailable' USING ERRCODE='55000'; END IF;$replacement$);
   EXECUTE body;
 END IF;
END $terminal$;
-- CREATE OR REPLACE preserves existing ownership, runtime denials and 10-second budgets.
NOTIFY pgrst,'reload schema';
COMMIT;
