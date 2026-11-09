-- Add safe Activity recovery without enabling staged inventory or slot editing routes.
BEGIN;
SET LOCAL lock_timeout='3s';
GRANT SELECT(recovery_of_event_id) ON public.collection_activity TO authenticated;

CREATE OR REPLACE FUNCTION collection_audit_private.legacy_recovery_preview(actor uuid,owner_id uuid,event_id bigint)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE original public.collection_activity; d jsonb; b jsonb; a jsonb; current_row jsonb; binder public.binders;
 conflicts jsonb:='[]'; unsupported jsonb:='[]'; changes jsonb:='[]'; dependencies jsonb:='[]'; token text; member text;
BEGIN
 IF NOT public.billing_partner_allowed(owner_id,actor) THEN RAISE EXCEPTION 'storage_access_denied' USING ERRCODE='42501'; END IF;
 SELECT * INTO original FROM public.collection_activity WHERE id=event_id AND owner_user_id=owner_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'recovery_event_unavailable' USING ERRCODE='42501'; END IF;
 IF original.format_version<>1 OR jsonb_typeof(original.recovery_state) IS DISTINCT FROM 'array'
   OR jsonb_array_length(original.recovery_state)=0 OR jsonb_array_length(original.recovery_state)>16384
   OR octet_length(original.recovery_state::text)>16777216 THEN
   unsupported:='["missing_complete_history"]';
 ELSE
 FOR d IN SELECT value FROM jsonb_array_elements(original.recovery_state) LOOP
   IF d->>'table'<>'pokemon_collection' THEN unsupported:=unsupported||'"unsupported_change"'::jsonb; CONTINUE; END IF;
   b:=nullif(d->'before','null');a:=nullif(d->'after','null');
   IF coalesce(b->>'user_id',owner_id::text)<>owner_id::text OR coalesce(a->>'user_id',owner_id::text)<>owner_id::text
     OR (b IS NOT NULL AND a IS NOT NULL AND (b->>'binder_id' IS DISTINCT FROM a->>'binder_id' OR b->>'pokemon_id' IS DISTINCT FROM a->>'pokemon_id' OR b->>'id' IS DISTINCT FROM a->>'id')) THEN
     unsupported:=unsupported||'"identity_changed"'::jsonb; CONTINUE;
   END IF;
   SELECT * INTO binder FROM public.binders WHERE id=coalesce(a->>'binder_id',b->>'binder_id')::uuid AND owner_user_id=owner_id;
   IF NOT FOUND THEN conflicts:=conflicts||jsonb_build_array(jsonb_build_object('reason','collection_removed')); CONTINUE; END IF;
   IF EXISTS(SELECT 1 FROM public.storage_collection_state WHERE collection_id=binder.id AND authority='slots') THEN
     unsupported:=unsupported||'"collection_converted"'::jsonb; CONTINUE;
   END IF;
   SELECT collection_audit_private.state('pokemon_collection',to_jsonb(p)) INTO current_row FROM public.pokemon_collection p
   WHERE user_id=owner_id AND binder_id=binder.id AND pokemon_id=coalesce(a->>'pokemon_id',b->>'pokemon_id')::integer;
   IF current_row IS DISTINCT FROM a OR EXISTS(
     SELECT 1 FROM public.collection_activity e WHERE e.owner_user_id=owner_id AND e.id>event_id
     AND e.affected_entities @> jsonb_build_object('collectionIds',jsonb_build_array(binder.id::text))
     AND (e.pokemon_id=coalesce(a->>'pokemon_id',b->>'pokemon_id')::integer OR EXISTS(
       SELECT 1 FROM jsonb_array_elements(e.changes) x WHERE x->>'table'='pokemon_collection'
       AND (x->'before'->>'pokemon_id'=coalesce(a->>'pokemon_id',b->>'pokemon_id') OR x->'after'->>'pokemon_id'=coalesce(a->>'pokemon_id',b->>'pokemon_id'))))) THEN
     conflicts:=conflicts||jsonb_build_array(jsonb_build_object('reason','card_changed'));
   END IF;
   IF b IS NOT NULL THEN
     FOR member IN SELECT jsonb_array_elements_text(coalesce(b->'wanted_by','[]'))
       UNION SELECT jsonb_array_elements_text(coalesce(w->'wanted_by','[]')) FROM jsonb_array_elements(coalesce(b->'wanted_cards','[]')) w LOOP
       IF NOT public.billing_partner_allowed(owner_id,member::uuid) THEN conflicts:=conflicts||jsonb_build_array(jsonb_build_object('reason','person_no_longer_has_access')); END IF;
     END LOOP;
   END IF;
   dependencies:=dependencies||jsonb_build_array(jsonb_build_object('collection',to_jsonb(binder),'current',current_row));
   changes:=changes||jsonb_build_array(jsonb_build_object('table','pokemon_collection','id',d->'id','before',a,'after',b));
 END LOOP;
 END IF;
 IF unsupported='[]' AND conflicts='[]' THEN
   token:=encode(sha256(convert_to(jsonb_build_object('actor',actor,'owner',owner_id,'event',event_id,'changes',changes,'dependencies',dependencies)::text,'UTF8')),'hex');
 END IF;
 RETURN jsonb_build_object('planVersion',1,'eventId',event_id::text,'supported',unsupported='[]','unsupported',unsupported,'conflicts',conflicts,
   'planToken',token,'restoreUnassignedItemIds','[]'::jsonb,'changes',collection_audit_private.redact(changes),'rootRevisionsAdvance',false);
END $$;

-- Service-only facade. Context is bound by authenticated app/REST/MCP server adapters.
CREATE OR REPLACE FUNCTION public.collection_recovery_v1(operation text,owner_id uuid,request jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET lock_timeout='3s' AS $$
DECLARE ctx jsonb; actor uuid; membership public.partnerships; original public.collection_activity; preview jsonb; prior public.developer_idempotency;
 digest text; result jsonb; d jsonb; b jsonb; a jsonb; cols text; updates text; new_event bigint; lock_row record;
BEGIN
 IF current_setting('role',true) IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'storage_access_denied' USING ERRCODE='42501'; END IF;
 ctx:=collection_audit_private.context(owner_id);actor:=(ctx->'actor'->>'userId')::uuid;
 IF ctx->'actor'->>'kind' IS DISTINCT FROM 'user' OR NOT coalesce(ctx->>'source' IN ('app','rest','mcp'),false) OR actor IS NULL THEN
   RAISE EXCEPTION 'storage_access_denied' USING ERRCODE='42501'; END IF;
 SELECT * INTO membership FROM public.partnerships WHERE actor IN(user1_id,user2_id) FOR KEY SHARE;
 IF owner_id IS NULL OR owner_id IS DISTINCT FROM (CASE WHEN membership.owner_user_id IS NOT NULL AND public.billing_partner_allowed(membership.owner_user_id,actor) THEN membership.owner_user_id ELSE actor END)
   OR NOT public.billing_partner_allowed(owner_id,actor) THEN RAISE EXCEPTION 'storage_access_denied' USING ERRCODE='42501'; END IF;
 IF ctx->>'source' IN ('rest','mcp') AND NOT (EXISTS(SELECT 1 FROM public.perpetual_licences WHERE owner_user_id=owner_id)
   OR EXISTS(SELECT 1 FROM public.billing_accounts WHERE owner_user_id=owner_id AND status IN ('active','past_due') AND paid_through>now())) THEN
   RAISE EXCEPTION 'premium_required' USING ERRCODE='HF402'; END IF;
 IF operation IS NULL OR operation NOT IN ('preview','apply') OR request IS NULL OR jsonb_typeof(request)<>'object' OR octet_length(request::text)>1048576
   OR jsonb_typeof(request->'eventId') IS DISTINCT FROM 'string' OR (request->>'eventId')!~'^[1-9][0-9]{0,18}$'
   OR (request->>'eventId')::numeric>9223372036854775807 OR jsonb_typeof(request->'restoreUnassignedItemIds') IS DISTINCT FROM 'array' THEN
   RAISE EXCEPTION 'invalid_recovery_request' USING ERRCODE='22023'; END IF;
 IF operation='preview' THEN
   IF NOT public.inventory_object_v1(request,ARRAY['eventId','restoreUnassignedItemIds']) OR (SELECT count(*) FROM jsonb_object_keys(request))<>2 THEN
     RAISE EXCEPTION 'invalid_recovery_request' USING ERRCODE='22023'; END IF;
 ELSE
   IF NOT public.inventory_object_v1(request,ARRAY['eventId','restoreUnassignedItemIds','planVersion','planToken','operationId','confirmed'])
     OR (SELECT count(*) FROM jsonb_object_keys(request))<>6 OR request->'planVersion' IS DISTINCT FROM '1'::jsonb OR request->'confirmed' IS DISTINCT FROM 'true'::jsonb
     OR NOT public.inventory_id_v1(request->'operationId') OR length(request->>'operationId') NOT BETWEEN 8 AND 100
     OR jsonb_typeof(request->'planToken') IS DISTINCT FROM 'string' OR (request->>'planToken')!~'^[a-f0-9]{64}$' THEN
     RAISE EXCEPTION 'invalid_recovery_request' USING ERRCODE='22023'; END IF;
   IF ctx->>'operationId' IS DISTINCT FROM request->>'operationId' THEN RAISE EXCEPTION 'storage_operation_mismatch' USING ERRCODE='42501'; END IF;
 END IF;
 SELECT * INTO original FROM public.collection_activity WHERE id=(request->>'eventId')::bigint AND owner_user_id=owner_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'recovery_event_unavailable' USING ERRCODE='42501'; END IF;
 -- Native storage recovery still has separate #396/#379 rollout and latency gates.
 -- Do not expose it merely because this app's ordinary row recovery is ready.
 IF original.format_version=1 AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(coalesce(original.recovery_state,'[]')) v WHERE v->>'table'='pokemon_collection') THEN
   IF operation='apply' THEN RAISE EXCEPTION 'recovery_unsupported' USING ERRCODE='0A000'; END IF;
   RETURN jsonb_build_object('planVersion',1,'eventId',original.id::text,'supported',false,'unsupported',jsonb_build_array('storage_recovery_not_enabled'),
     'conflicts','[]'::jsonb,'planToken',NULL,'restoreUnassignedItemIds','[]'::jsonb,'changes','[]'::jsonb,'rootRevisionsAdvance',false);
 END IF;
 IF request->'restoreUnassignedItemIds'<>'[]' THEN RAISE EXCEPTION 'invalid_recovery_request' USING ERRCODE='22023'; END IF;
 IF operation='preview' THEN RETURN collection_audit_private.legacy_recovery_preview(actor,owner_id,original.id); END IF;
 -- Match ordinary legacy saves/deletes: current rows, binder guard, then billing lock.
 PERFORM 1 FROM public.partnerships WHERE owner_user_id=owner_id FOR KEY SHARE;
 digest:=encode(sha256(convert_to(jsonb_build_object('owner',owner_id,'request',request,'source',ctx->'source','clientId',ctx->'clientId')::text,'UTF8')),'hex');
 FOR lock_row IN SELECT id FROM public.pokemon_collection WHERE user_id=owner_id AND id::text IN (
   SELECT v->>'id' FROM jsonb_array_elements(original.recovery_state) v) ORDER BY id FOR UPDATE LOOP END LOOP;
 FOR lock_row IN SELECT id FROM public.binders WHERE owner_user_id=owner_id AND id::text IN (
   SELECT coalesce(v->'before'->>'binder_id',v->'after'->>'binder_id') FROM jsonb_array_elements(original.recovery_state) v) ORDER BY id FOR UPDATE LOOP END LOOP;
 PERFORM pg_advisory_xact_lock(hashtextextended(owner_id::text,4701));
 SELECT * INTO prior FROM public.developer_idempotency ledger WHERE actor_id=actor AND ledger.operation='activity_recovery_v1' AND request_key=request->>'operationId' FOR UPDATE;
 IF FOUND THEN
   IF prior.input_digest<>digest THEN RAISE EXCEPTION 'idempotency_conflict' USING ERRCODE='40001'; END IF;
   RETURN prior.result;
 END IF;
 preview:=collection_audit_private.legacy_recovery_preview(actor,owner_id,original.id);
 IF preview->'supported'<>'true' THEN RAISE EXCEPTION 'recovery_unsupported' USING ERRCODE='0A000'; END IF;
 IF preview->>'planToken' IS NULL OR preview->>'planToken' IS DISTINCT FROM request->>'planToken' THEN RAISE EXCEPTION 'recovery_plan_conflict' USING ERRCODE='40001'; END IF;
 IF EXISTS(SELECT 1 FROM collection_audit_private.pending WHERE transaction_id=txid_current() AND pending.owner_id=collection_recovery_v1.owner_id) THEN
   RAISE EXCEPTION 'recovery_requires_separate_transaction' USING ERRCODE='25001'; END IF;
 SELECT string_agg(format('%I',attname),',' ORDER BY attnum),string_agg(format('%1$I=r.%1$I',attname),',' ORDER BY attnum)
 INTO cols,updates FROM pg_attribute WHERE attrelid='public.pokemon_collection'::regclass AND attnum>0 AND NOT attisdropped AND attname NOT IN ('created_at','updated_at');
 -- Free weight before restoring it elsewhere, so a final-state-neutral inverse fits at the cap.
 FOR d IN SELECT value FROM jsonb_array_elements(original.recovery_state) ORDER BY
   CASE WHEN value->'before'='null' THEN 0 ELSE public.billing_card_weight(value->'before'->>'status',value->'before'->'wanted_cards') END
   - CASE WHEN value->'after'='null' THEN 0 ELSE public.billing_card_weight(value->'after'->>'status',value->'after'->'wanted_cards') END,
   value->>'id' LOOP
   b:=nullif(d->'before','null');a:=nullif(d->'after','null');
   IF b IS NULL THEN DELETE FROM public.pokemon_collection WHERE id=(a->>'id')::uuid AND user_id=owner_id;
   ELSIF a IS NULL THEN
     EXECUTE format('INSERT INTO public.pokemon_collection(%s) SELECT %s FROM jsonb_populate_record(NULL::public.pokemon_collection,$1) r',cols,cols) USING b;
   ELSE
     EXECUTE format('UPDATE public.pokemon_collection p SET %s FROM jsonb_populate_record(NULL::public.pokemon_collection,$1) r WHERE p.id=r.id AND p.user_id=$2',updates) USING b,owner_id;
   END IF;
 END LOOP;
 UPDATE collection_audit_private.pending SET context=ctx||jsonb_build_object('action','recovery.apply'),recovery_of_event_id=original.id
 WHERE transaction_id=txid_current() AND pending.owner_id=collection_recovery_v1.owner_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'recovery_recorder_missing'; END IF;
 SET CONSTRAINTS ALL IMMEDIATE; SET CONSTRAINTS ALL DEFERRED;
 SELECT id INTO new_event FROM public.collection_activity WHERE owner_user_id=owner_id AND operation_id=request->>'operationId' AND recovery_of_event_id=original.id;
 IF new_event IS NULL THEN RAISE EXCEPTION 'recovery_recorder_missing'; END IF;
 result:=jsonb_build_object('eventId',new_event::text,'recoveredEventId',original.id::text);
 INSERT INTO public.developer_idempotency(actor_id,operation,request_key,input_digest,result,expires_at) VALUES(actor,'activity_recovery_v1',request->>'operationId',digest,result,'infinity');
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION collection_audit_private.legacy_recovery_preview(uuid,uuid,bigint) FROM PUBLIC,anon,authenticated,holo_mcp,service_role;
REVOKE ALL ON FUNCTION public.collection_recovery_v1(text,uuid,jsonb) FROM PUBLIC,anon,authenticated,holo_mcp,service_role;
GRANT EXECUTE ON FUNCTION public.collection_recovery_v1(text,uuid,jsonb) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
