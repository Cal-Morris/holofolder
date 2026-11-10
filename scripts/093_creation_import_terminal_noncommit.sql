-- Staged creation/import terminal outcomes in their original lifetime ledger. No admission/grants.
BEGIN;
SET LOCAL lock_timeout='3s';
DO $predicates$
DECLARE signature text; body text; reason text; predicate_state text; anchor text;
BEGIN
 IF to_regprocedure('collection_audit_private.execute_recovery_v1(text,uuid,uuid,jsonb,jsonb)') IS NULL THEN
   RAISE EXCEPTION 'creation_import_terminal_requires_092';
 END IF;
 FOREACH signature IN ARRAY ARRAY['collection_audit_private.create_collection_v1(uuid,uuid,jsonb,jsonb)',
   'collection_audit_private.import_arrangement_v1(uuid,uuid,jsonb,jsonb)'] LOOP
   SELECT pg_get_functiondef(signature::regprocedure) INTO body;
   IF position('-- terminal_predicates_093' IN body)=0 THEN
     FOR reason,predicate_state IN SELECT * FROM (VALUES
       ('inventory_revision_conflict','HF931'),('creation_identity_conflict','HF932'),
       ('inventory_collection_conflict','HF933'),('arrangement_destination_conflict','HF934'),
       ('import_copy_conflict','HF935')) p(reason,state) LOOP
       IF (signature LIKE '%create_collection%' AND reason IN ('inventory_revision_conflict','creation_identity_conflict'))
         OR (signature LIKE '%import_arrangement%' AND reason<>'creation_identity_conflict') THEN
         anchor:=format('RAISE EXCEPTION %L USING ERRCODE=''40001''',reason);
         IF position(anchor IN body)=0 THEN RAISE EXCEPTION 'creation_import_terminal_predicate_changed'; END IF;
         body:=replace(body,anchor,format('RAISE EXCEPTION %L USING ERRCODE=%L',reason,predicate_state));
       END IF;
     END LOOP;
     -- Missing native state is not revision zero and cannot produce a terminal proof.
     IF signature LIKE '%create_collection%' THEN
       anchor:='revision:=coalesce(revision,0);';
       IF position(anchor IN body)=0 THEN RAISE EXCEPTION 'creation_terminal_state_changed'; END IF;
       body:=replace(body,anchor,'IF revision IS NULL THEN RAISE EXCEPTION ''storage_owner_state_unavailable'' USING ERRCODE=''55000''; END IF;');
     ELSE
       anchor:='IF revision IS NULL OR to_jsonb(revision) IS DISTINCT FROM request->''inventoryRevision'' THEN';
       IF position(anchor IN body)=0 THEN RAISE EXCEPTION 'import_terminal_state_changed'; END IF;
       body:=replace(body,anchor,'IF revision IS NULL THEN RAISE EXCEPTION ''storage_owner_state_unavailable'' USING ERRCODE=''55000''; END IF;'||chr(10)||
         ' IF to_jsonb(revision) IS DISTINCT FROM request->''inventoryRevision'' THEN');
     END IF;
     body:=replace(body,'DECLARE ','DECLARE -- terminal_predicates_093'||chr(10));
     EXECUTE body;
   END IF;
 END LOOP;
END $predicates$;
CREATE OR REPLACE FUNCTION collection_audit_private.execute_creation_import_v1(operation text,actor uuid,owner_id uuid,request jsonb,ctx jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET lock_timeout='3s' SET statement_timeout='10s' AS $$
DECLARE membership public.partnerships; prior public.developer_idempotency; ledger_operation text;
 digest text; result jsonb; predicate_state text; reason text; revision bigint;
BEGIN
 IF operation IS NULL OR operation NOT IN ('collection.create','backup.arrangement') OR actor IS NULL OR owner_id IS NULL
   OR NOT public.inventory_id_v1(request->'operationId') OR request->'version' IS DISTINCT FROM '1'::jsonb THEN
   RAISE EXCEPTION 'invalid_storage_request' USING ERRCODE='22023'; END IF;
 -- Current source/actor/billing checked by gateway; re-resolve after membership waits.
 SELECT * INTO membership FROM public.partnerships WHERE actor IN(user1_id,user2_id) FOR SHARE;
 IF owner_id IS DISTINCT FROM (CASE WHEN membership.owner_user_id IS NOT NULL AND public.billing_partner_allowed(membership.owner_user_id,actor)
   THEN membership.owner_user_id ELSE actor END) OR NOT public.billing_partner_allowed(owner_id,actor) THEN
   RAISE EXCEPTION 'storage_access_denied' USING ERRCODE='42501'; END IF;
 -- Retain live recipient membership, including imported want assignments, through COMMIT.
 PERFORM 1 FROM public.partnerships WHERE owner_user_id=owner_id FOR SHARE;
 PERFORM pg_advisory_xact_lock(hashtextextended(owner_id::text,6102));
 PERFORM pg_advisory_xact_lock(hashtextextended(owner_id::text,4701));
 ledger_operation:=CASE operation WHEN 'collection.create' THEN 'collection_create_v1' ELSE 'backup_arrangement_v1' END;
 -- Byte-for-byte original namespace and digest inputs from 083/088. Never resolve private data here.
 digest:=encode(sha256(convert_to(jsonb_build_object('owner',owner_id,'request',request,'context',ctx)::text,'UTF8')),'hex');
 SELECT * INTO prior FROM public.developer_idempotency l WHERE l.actor_id=actor AND l.operation=ledger_operation
   AND l.request_key=request->>'operationId' FOR UPDATE;
 IF FOUND THEN
   IF prior.input_digest<>digest THEN RAISE EXCEPTION 'idempotency_conflict' USING ERRCODE='40001'; END IF;
   RETURN prior.result;
 END IF;
 BEGIN
   IF operation='collection.create' THEN result:=collection_audit_private.create_collection_v1(actor,owner_id,request,ctx);
   ELSE result:=collection_audit_private.import_arrangement_v1(actor,owner_id,request,ctx); END IF;
 EXCEPTION WHEN SQLSTATE 'HF931' OR SQLSTATE 'HF932' OR SQLSTATE 'HF933' OR SQLSTATE 'HF934' OR SQLSTATE 'HF935' THEN
   GET STACKED DIAGNOSTICS predicate_state=RETURNED_SQLSTATE;
   -- SQLSTATE selects the predicate, never spoofable message text or ordinary 40001/23505.
   IF (operation='collection.create' AND predicate_state NOT IN ('HF931','HF932'))
     OR (operation='backup.arrangement' AND predicate_state='HF932') THEN RAISE; END IF;
   reason:=CASE predicate_state WHEN 'HF931' THEN 'inventory_revision_conflict' WHEN 'HF932' THEN 'creation_identity_conflict'
     WHEN 'HF933' THEN 'inventory_collection_conflict' WHEN 'HF934' THEN 'arrangement_destination_conflict' WHEN 'HF935' THEN 'import_copy_conflict' END;
   -- Inner mutations and recorder capture rolled back. Outer locks survive until terminal COMMIT.
   SELECT inventory_revision INTO STRICT revision FROM public.inventory_owner_state WHERE owner_user_id=owner_id;
   result:=jsonb_build_object('outcome','rejected','operationId',request->>'operationId','code',reason,'inventoryRevision',revision);
   INSERT INTO public.developer_idempotency(actor_id,operation,request_key,input_digest,result,expires_at)
     VALUES(actor,ledger_operation,request->>'operationId',digest,result,'infinity');
 END;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION collection_audit_private.execute_creation_import_v1(text,uuid,uuid,jsonb,jsonb) FROM PUBLIC,anon,authenticated,holo_mcp,service_role;
DO $gateway$
DECLARE body text; anchor text;
BEGIN
 SELECT pg_get_functiondef('public.storage_execute_v1(text,uuid,jsonb)'::regprocedure) INTO body;
 IF position('collection_audit_private.execute_creation_import_v1' IN body)=0 THEN
   FOREACH anchor IN ARRAY ARRAY['collection_audit_private.create_collection_v1(actor,owner_id,request,ctx)',
     'collection_audit_private.import_arrangement_v1(actor,owner_id,request,ctx)'] LOOP
     IF position(anchor IN body)=0 THEN RAISE EXCEPTION 'creation_import_terminal_gateway_changed'; END IF;
     body:=replace(body,anchor,'collection_audit_private.execute_creation_import_v1(operation,actor,owner_id,request,ctx)');
   END LOOP;
   EXECUTE body;
 END IF;
END $gateway$;
NOTIFY pgrst,'reload schema';
COMMIT;
