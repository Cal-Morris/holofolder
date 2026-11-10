-- Terminal command outcomes use the existing lifetime ledger. No admission or new history store.
BEGIN;
SET LOCAL lock_timeout='3s';
CREATE OR REPLACE FUNCTION collection_audit_private.execute_command_v1(operation text,actor uuid,owner_id uuid,request jsonb,intent jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET lock_timeout='3s' SET statement_timeout='10s' AS $$
DECLARE ledger_operation text; digest text; prior public.developer_idempotency; result jsonb; reason text; revision bigint; source_value jsonb; membership public.partnerships;
BEGIN
 IF operation NOT IN ('slots','inventory') OR operation IS NULL THEN RAISE EXCEPTION 'invalid_storage_request' USING ERRCODE='22023'; END IF;
 -- The gateway's KEY SHARE excludes unlink but not non-key owner updates. Upgrade and
 -- re-resolve authority BEFORE owner locks, including after waiting for an owner change.
 SELECT * INTO membership FROM public.partnerships WHERE actor IN(user1_id,user2_id) FOR SHARE;
 IF owner_id IS NULL OR actor IS NULL OR owner_id IS DISTINCT FROM
   (CASE WHEN membership.owner_user_id IS NOT NULL AND public.billing_partner_allowed(membership.owner_user_id,actor) THEN membership.owner_user_id ELSE actor END)
   OR NOT public.billing_partner_allowed(owner_id,actor) THEN
   RAISE EXCEPTION 'storage_access_denied' USING ERRCODE='42501';
 END IF;
 -- Called only after the service gateway's current actor/source/owner/membership checks.
 -- Acquire outside the exception subtransaction, so rollback cannot release the serialization fence.
 -- Management first, as required by native collection deletion (084).
 PERFORM pg_advisory_xact_lock(hashtextextended(owner_id::text,6102));
 PERFORM pg_advisory_xact_lock(hashtextextended(owner_id::text,4701));
 IF operation='slots' THEN
   ledger_operation:='binder_slots_v1';
   source_value:=jsonb_build_object('source',intent->'source','clientId',intent->'clientId');
   digest:=encode(sha256(convert_to(jsonb_build_object('owner',owner_id,'request',request,'source',source_value)::text,'UTF8')),'hex');
 ELSE
   ledger_operation:='inventory_v1';
   digest:=encode(sha256(convert_to(jsonb_build_object('owner',owner_id,'request',request,'intent',intent)::text,'UTF8')),'hex');
 END IF;
 -- Replay precedes mutable entity checks, but follows current authority at the gateway.
 SELECT * INTO prior FROM public.developer_idempotency l WHERE l.actor_id=actor AND l.operation=ledger_operation AND l.request_key=request->>'operationId' FOR UPDATE;
 IF FOUND THEN
   IF prior.input_digest<>digest THEN RAISE EXCEPTION 'idempotency_conflict' USING ERRCODE='40001'; END IF;
   result:=prior.result;
 ELSE
   BEGIN
     IF operation='slots' THEN result:=public.slot_command_v1(actor,owner_id,request,source_value);
     ELSE result:=public.inventory_command_v1(actor,owner_id,request,intent); END IF;
   EXCEPTION WHEN serialization_failure THEN
     GET STACKED DIAGNOSTICS reason=MESSAGE_TEXT;
     IF reason NOT IN ('slot_revision_conflict','inventory_revision_conflict','inventory_collection_conflict','slot_conflict','item_conflict',
       'placement_conflict','inventory_want_conflict','inventory_copy_choice_required','inventory_destination_empty','inventory_destination_occupied') THEN RAISE; END IF;
     -- Every partial mutation/audit delta in the executor has rolled back. No competing delivery
     -- can pass the retained owner lock before this terminal result commits to the SAME ledger.
     SELECT inventory_revision INTO STRICT revision FROM public.inventory_owner_state WHERE owner_user_id=owner_id;
     result:=jsonb_build_object('outcome','rejected','operationId',request->>'operationId','code',reason,'inventoryRevision',revision);
     INSERT INTO public.developer_idempotency(actor_id,operation,request_key,input_digest,result,expires_at)
     VALUES(actor,ledger_operation,request->>'operationId',digest,result,'infinity');
   END;
 END IF;
 IF result->>'outcome'='rejected' THEN RETURN result; END IF;
 IF operation='slots' THEN RETURN jsonb_build_object('inventoryRevision',result->'inventoryRevision','changed',result->'changed',
   'collectionVersion',result->'collectionVersion','layoutRevision',result->'layoutRevision','removedSlotIds',result->'removedSlotIds'); END IF;
 RETURN jsonb_build_object('inventoryRevision',result->'inventoryRevision','changed',result->'changed',
   'selectedItemIds',result->'selectedItemIds','acquiredItemIds',result->'acquiredItemIds');
END $$;
REVOKE ALL ON FUNCTION collection_audit_private.execute_command_v1(text,uuid,uuid,jsonb,jsonb) FROM PUBLIC,anon,authenticated,holo_mcp,service_role;
DO $gateway$
DECLARE body text; start_at integer; end_at integer;
BEGIN
 SELECT pg_get_functiondef('public.storage_execute_v1(text,uuid,jsonb)'::regprocedure) INTO body;
 IF position('collection_audit_private.execute_command_v1' IN body)=0 THEN
   start_at:=position($anchor$ WHEN 'inventory' THEN$anchor$ IN body);
   end_at:=position($anchor$ WHEN 'recovery.preview' THEN$anchor$ IN body);
   IF start_at=0 OR end_at<=start_at THEN RAISE EXCEPTION 'command_rejection_gateway_changed'; END IF;
   body:=substring(body FROM 1 FOR start_at-1)||$dispatch$ WHEN 'inventory','slots' THEN result:=collection_audit_private.execute_command_v1(operation,actor,owner_id,request,intent);
$dispatch$||substring(body FROM end_at);
   EXECUTE body;
 END IF;
END $gateway$;
NOTIFY pgrst,'reload schema';
COMMIT;
