-- Terminal recovery outcomes in the existing lifetime ledger, after 091. No admission/grants.
BEGIN;
SET LOCAL lock_timeout='3s';
DO $dependencies$
BEGIN
 IF to_regprocedure('collection_audit_private.insert_item_v1(uuid,jsonb)') IS NULL
   OR position('-- atomic_insert_assign_091' IN pg_get_functiondef('public.inventory_command_v1(uuid,uuid,jsonb,jsonb)'::regprocedure))=0
   OR position('collection_audit_private.execute_command_v1' IN pg_get_functiondef('public.storage_execute_v1(text,uuid,jsonb)'::regprocedure))=0 THEN
   RAISE EXCEPTION 'recovery_terminal_requires_089_through_091';
 END IF;
END $dependencies$;
-- Dedicated engine predicate state: arbitrary serialization errors (even with the same
-- message), billing, recorder, deferred constraints and cancellation cannot become proof.
DO $predicates$
DECLARE signature text; body text; reason text; anchor text;
BEGIN
 FOREACH signature IN ARRAY ARRAY['collection_audit_private.recovery_apply_v1(uuid,uuid,jsonb,jsonb)',
   'collection_audit_private.recovery_apply_v2(uuid,uuid,jsonb,jsonb)'] LOOP
   SELECT pg_get_functiondef(signature::regprocedure) INTO body;
   IF position('-- terminal_predicates_092' IN body)=0 THEN
     FOREACH reason IN ARRAY ARRAY['recovery_plan_conflict','recovery_dependency_conflict'] LOOP
       anchor:=format('RAISE EXCEPTION %L USING ERRCODE=''40001''',reason);
       IF position(anchor IN body)=0 THEN RAISE EXCEPTION 'recovery_terminal_predicate_changed'; END IF;
       body:=replace(body,anchor,format('RAISE EXCEPTION %L USING ERRCODE=''HF092''',reason));
     END LOOP;
     body:=replace(body,'DECLARE ', 'DECLARE -- terminal_predicates_092'||chr(10));
     IF position('-- terminal_predicates_092' IN body)=0 THEN RAISE EXCEPTION 'recovery_terminal_declaration_changed'; END IF;
     EXECUTE body;
   END IF;
 END LOOP;
END $predicates$;
CREATE OR REPLACE FUNCTION collection_audit_private.execute_recovery_v1(operation text,actor uuid,owner_id uuid,request jsonb,intent jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET lock_timeout='3s' SET statement_timeout='10s' AS $$
DECLARE membership public.partnerships; prior public.developer_idempotency; digest text; result jsonb; reason text; revision bigint;
BEGIN
 IF operation IS NULL OR operation NOT IN ('recovery.apply','recovery.apply.v2') OR actor IS NULL OR owner_id IS NULL
   OR NOT public.inventory_id_v1(request->'operationId')
   OR request->'planVersion' IS DISTINCT FROM to_jsonb(CASE WHEN operation='recovery.apply' THEN 1 ELSE 2 END) THEN RAISE EXCEPTION 'invalid_recovery_request' USING ERRCODE='22023'; END IF;
 -- The authenticated service gateway has checked current source, actor, session and billing.
 -- Upgrade KEY SHARE and re-resolve after waits, before management6102/root4701.
 SELECT * INTO membership FROM public.partnerships WHERE actor IN(user1_id,user2_id) FOR SHARE;
 IF owner_id IS DISTINCT FROM (CASE WHEN membership.owner_user_id IS NOT NULL AND public.billing_partner_allowed(membership.owner_user_id,actor)
   THEN membership.owner_user_id ELSE actor END) OR NOT public.billing_partner_allowed(owner_id,actor) THEN
   RAISE EXCEPTION 'recovery_access_denied' USING ERRCODE='42501'; END IF;
 -- Also retain current owner membership when restoring a partner's recorded wants.
 PERFORM 1 FROM public.partnerships WHERE owner_user_id=owner_id FOR SHARE;
 PERFORM pg_advisory_xact_lock(hashtextextended(owner_id::text,6102));
 PERFORM pg_advisory_xact_lock(hashtextextended(owner_id::text,4701));
 digest:=encode(sha256(convert_to(jsonb_build_object('owner',owner_id,'request',request,'intent',intent)::text,'UTF8')),'hex');
 -- Preserve the original namespace/digest, including version and all trusted source context.
 -- Receipt lookup MUST precede any reconstruction of mutable private inverse dependencies.
 SELECT * INTO prior FROM public.developer_idempotency l WHERE l.actor_id=actor AND l.operation='recovery_v1'
   AND l.request_key=request->>'operationId' FOR UPDATE;
 IF FOUND THEN
   IF prior.input_digest<>digest THEN RAISE EXCEPTION 'idempotency_conflict' USING ERRCODE='40001'; END IF;
   RETURN prior.result;
 END IF;
 BEGIN
   IF operation='recovery.apply' THEN result:=collection_audit_private.recovery_apply_v1(actor,owner_id,request,intent);
   ELSE result:=collection_audit_private.recovery_apply_v2(actor,owner_id,request,intent); END IF;
 EXCEPTION WHEN SQLSTATE 'HF092' THEN
   GET STACKED DIAGNOSTICS reason=MESSAGE_TEXT;
   IF reason NOT IN ('recovery_plan_conflict','recovery_dependency_conflict') THEN RAISE; END IF;
   -- The entire engine subtransaction, including inverse/audit writes, has rolled back.
   -- Outer serialization locks survive it. No concurrent exact delivery can now commit.
   SELECT inventory_revision INTO STRICT revision FROM public.inventory_owner_state WHERE owner_user_id=owner_id;
   result:=jsonb_build_object('outcome','rejected','operationId',request->>'operationId','code',reason,'inventoryRevision',revision);
   INSERT INTO public.developer_idempotency(actor_id,operation,request_key,input_digest,result,expires_at)
     VALUES(actor,'recovery_v1',request->>'operationId',digest,result,'infinity');
 END;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION collection_audit_private.execute_recovery_v1(text,uuid,uuid,jsonb,jsonb) FROM PUBLIC,anon,authenticated,holo_mcp,service_role;
DO $gateway$
DECLARE body text; anchor text;
BEGIN
 SELECT pg_get_functiondef('public.storage_execute_v1(text,uuid,jsonb)'::regprocedure) INTO body;
 IF position('collection_audit_private.execute_recovery_v1' IN body)=0 THEN
   FOREACH anchor IN ARRAY ARRAY[
     'collection_audit_private.recovery_apply_v1(actor,owner_id,request,intent)',
     'collection_audit_private.recovery_apply_v2(actor,owner_id,request,intent)'] LOOP
     IF position(anchor IN body)=0 THEN RAISE EXCEPTION 'recovery_terminal_gateway_changed'; END IF;
     body:=replace(body,anchor,'collection_audit_private.execute_recovery_v1(operation,actor,owner_id,request,intent)');
   END LOOP;
   EXECUTE body;
 END IF;
END $gateway$;
NOTIFY pgrst,'reload schema';
COMMIT;
