-- Staged #396 inverse executor. Apply AFTER 076, as one transaction, locally twice first.
-- SQL owner only. No runtime grants, routes, conversion, legacy writes or queue replay.
BEGIN;
SET LOCAL lock_timeout='3s';
ALTER TABLE public.collection_activity ADD COLUMN IF NOT EXISTS recovery_of_event_id bigint;
ALTER TABLE collection_audit_private.pending ADD COLUMN IF NOT EXISTS recovery_of_event_id bigint;
-- No cascading event FK: the original is immutable and the account owns lifetime/privacy deletion.
-- Existing safe-column grants stay unchanged; a future reader adapter must expose the link.

-- Extend only the INSERT projection in the existing recorder, preserving its immutable guard,
-- consolidation, bounds, acquisition behavior and all accepted legacy write paths.
DO $integration$
DECLARE body text;
BEGIN
 SELECT pg_get_functiondef('collection_audit_private.flush()'::regprocedure) INTO body;
 IF position('pending_row.recovery_of_event_id' IN body)=0 THEN
   IF position('changes,recovery_state,command_evidence)' IN body)=0
     OR position('delta,pending_row.command_evidence);' IN body)=0 THEN
     RAISE EXCEPTION 'recovery_audit_integration_changed';
   END IF;
   body:=replace(body,'changes,recovery_state,command_evidence)', 'changes,recovery_state,command_evidence,recovery_of_event_id)');
   body:=replace(body,'delta,pending_row.command_evidence);','delta,pending_row.command_evidence,pending_row.recovery_of_event_id);');
   EXECUTE body;
 END IF;
END $integration$;

-- Internal raw plan. Never grant or return this function through a client transport.
-- STABLE gives a single read-only statement snapshot. No plan table or preview history.
CREATE OR REPLACE FUNCTION collection_audit_private.recovery_plan_v1(actor uuid,owner_id uuid,event_id bigint,unassigned text[])
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE original public.collection_activity; d jsonb; row_value jsonb; b jsonb; a jsonb; key text; tbl text; col text;
 inverse jsonb:='[]'; conflicts jsonb:='[]'; unsupported jsonb:='[]'; deps jsonb; root jsonb; member text;
 item_ids text[]:='{}'; slot_ids text[]:='{}'; collection_ids uuid[]:='{}'; skipped_slots text[]:='{}'; choice text;
BEGIN
 IF actor IS NULL OR owner_id IS NULL OR NOT EXISTS(SELECT 1 FROM auth.users WHERE id=actor)
   OR NOT public.billing_partner_allowed(owner_id,actor) THEN RAISE EXCEPTION 'recovery_access_denied' USING ERRCODE='42501'; END IF;
 SELECT * INTO original FROM public.collection_activity WHERE id=event_id AND owner_user_id=owner_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'recovery_event_unavailable' USING ERRCODE='42501'; END IF;
 IF unassigned IS NULL OR cardinality(unassigned)>16384 OR array_position(unassigned,NULL) IS NOT NULL
   OR cardinality(unassigned)<>(SELECT count(DISTINCT v) FROM unnest(unassigned) v) THEN
   RAISE EXCEPTION 'invalid_recovery_request' USING ERRCODE='22023'; END IF;
 IF original.format_version<>1 OR jsonb_typeof(original.recovery_state) IS DISTINCT FROM 'array'
   OR jsonb_array_length(original.recovery_state)=0 THEN
   RETURN jsonb_build_object('supported',false,'unsupported',jsonb_build_array('missing_versioned_inverse'),'conflicts','[]'::jsonb);
 END IF;
 IF jsonb_array_length(original.recovery_state)>16384 OR octet_length(original.recovery_state::text)>16777216 THEN
   RETURN jsonb_build_object('supported',false,'unsupported',jsonb_build_array('evidence_bounds'),'conflicts','[]'::jsonb);
 END IF;
 -- Unassigned is a deliberate alternative ONLY for a removed copy's isolated placement/status
 -- clearing. It cannot drop a target, wants, layout change, or another inverse from a bulk event.
 FOREACH choice IN ARRAY unassigned LOOP
   IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(original.recovery_state) e WHERE e->>'table'='inventory_items'
     AND e->>'id'=choice AND e->'before'<>'null' AND e->'after'='null') THEN
     RAISE EXCEPTION 'invalid_unassigned_recovery' USING ERRCODE='22023'; END IF;
   FOR d IN SELECT e FROM jsonb_array_elements(original.recovery_state) e WHERE e->>'table'='inventory_placements' AND e->>'id'=choice LOOP
     IF d->'before'='null' OR d->'after'<>'null' THEN RAISE EXCEPTION 'invalid_unassigned_recovery' USING ERRCODE='22023'; END IF;
     key:=d->'before'->>'slot_id';
     SELECT e INTO row_value FROM jsonb_array_elements(original.recovery_state) e WHERE e->>'table'='binder_slots' AND e->>'id'=key;
     IF row_value IS NULL OR row_value->'before'='null' OR row_value->'after'='null'
       OR row_value->'after'->'status'<>'null'
       OR (row_value->'before')-ARRAY['status','version'] IS DISTINCT FROM (row_value->'after')-ARRAY['status','version'] THEN
       RAISE EXCEPTION 'invalid_unassigned_recovery' USING ERRCODE='22023'; END IF;
     skipped_slots:=array_append(skipped_slots,key);
   END LOOP;
 END LOOP;
 FOR d IN SELECT e FROM jsonb_array_elements(original.recovery_state) e LOOP
   tbl:=d->>'table'; key:=d->>'id'; b:=nullif(d->'before','null'); a:=nullif(d->'after','null');
   IF tbl NOT IN ('inventory_owner_state','storage_collection_state','inventory_items','binder_slots','inventory_placements','binders') THEN
     unsupported:=unsupported||jsonb_build_array('unsupported_table:'||tbl); CONTINUE;
   END IF;
   IF tbl IN ('binders','storage_collection_state') AND b IS NULL THEN
     unsupported:=unsupported||jsonb_build_array('collection_creation_inverse');
   END IF;
   IF tbl='inventory_owner_state' THEN
     IF a IS NULL OR b IS NULL THEN unsupported:=unsupported||jsonb_build_array('owner_authority_transition'); END IF;
     CONTINUE;
   END IF;
   IF coalesce(b->>'owner_user_id',owner_id::text)<>owner_id::text OR coalesce(a->>'owner_user_id',owner_id::text)<>owner_id::text THEN
     unsupported:=unsupported||jsonb_build_array('owner_transfer'); CONTINUE;
   END IF;
   IF tbl='storage_collection_state' THEN
     IF coalesce(b->>'authority',a->>'authority')<>'slots' OR (b IS NOT NULL AND a IS NOT NULL
       AND b-ARRAY['version','layout_revision'] IS DISTINCT FROM a-ARRAY['version','layout_revision'])
       OR coalesce(b->'conversion_receipt',a->'conversion_receipt','null')<>'null' THEN
       unsupported:=unsupported||jsonb_build_array('authority_or_config_transition');
     END IF;
     collection_ids:=array_append(collection_ids,key::uuid);
   ELSIF tbl='binders' THEN collection_ids:=array_append(collection_ids,key::uuid);
   ELSIF tbl='inventory_items' THEN
     item_ids:=array_append(item_ids,key);
     IF b->'grading'->'label'->'assetIds' IS NOT NULL AND b->'grading'->'label'->'assetIds'<>'[]' THEN
       unsupported:=unsupported||jsonb_build_array('private_assets_unverifiable');
     END IF;
   ELSIF tbl='inventory_placements' THEN
     IF key=ANY(unassigned) THEN CONTINUE; END IF;
     item_ids:=array_append(item_ids,key);
     IF b IS NOT NULL THEN slot_ids:=array_append(slot_ids,b->>'slot_id'); collection_ids:=array_append(collection_ids,(b->>'collection_id')::uuid); END IF;
     IF a IS NOT NULL THEN slot_ids:=array_append(slot_ids,a->>'slot_id'); collection_ids:=array_append(collection_ids,(a->>'collection_id')::uuid); END IF;
   ELSIF tbl='binder_slots' THEN
     IF key=ANY(skipped_slots) THEN CONTINUE; END IF;
     slot_ids:=array_append(slot_ids,key); collection_ids:=array_append(collection_ids,(coalesce(a,b)->>'collection_id')::uuid);
   END IF;
   inverse:=inverse||jsonb_build_array(d);
 END LOOP;
 -- An explicit Unassigned restore may outlive its former collection. Drop only a pure
 -- content-counter delta with no remaining inverse in that collection, never layout/config work.
 IF cardinality(unassigned)>0 THEN
   SELECT coalesce(jsonb_agg(e ORDER BY n),'[]') INTO inverse FROM jsonb_array_elements(inverse) WITH ORDINALITY entries(e,n)
   WHERE NOT (e->>'table'='storage_collection_state' AND e->'before'<>'null' AND e->'after'<>'null'
     AND (e->'before')-'version'=(e->'after')-'version' AND NOT EXISTS(
       SELECT 1 FROM jsonb_array_elements(inverse) x WHERE x->>'table' NOT IN ('inventory_owner_state','storage_collection_state')
       AND coalesce(x->'before'->>'collection_id',x->'after'->>'collection_id',CASE WHEN x->>'table'='binders' THEN x->>'id' END)=e->>'id'));
   SELECT coalesce(array_agg(DISTINCT id::uuid),'{}') INTO collection_ids FROM (
     SELECT coalesce(e->'before'->>'collection_id',e->'after'->>'collection_id',CASE WHEN e->>'table' IN ('binders','storage_collection_state') THEN e->>'id' END) id
     FROM jsonb_array_elements(inverse) e) ids WHERE id IS NOT NULL;
 END IF;
 -- Include current item/placement dependencies of changed slots, and both historical ends of moves.
 SELECT coalesce(array_agg(DISTINCT v),'{}') INTO item_ids FROM (
   SELECT unnest(item_ids) v UNION SELECT inventory_item_id FROM public.inventory_placements WHERE owner_user_id=owner_id AND slot_id=ANY(slot_ids)) ids;
 SELECT coalesce(array_agg(DISTINCT v),'{}') INTO slot_ids FROM (
   SELECT unnest(slot_ids) v UNION SELECT slot_id FROM public.inventory_placements WHERE owner_user_id=owner_id AND inventory_item_id=ANY(item_ids)) ids;
 SELECT coalesce(array_agg(DISTINCT v),'{}') INTO collection_ids FROM (
   SELECT unnest(collection_ids) v UNION SELECT collection_id FROM public.binder_slots WHERE owner_user_id=owner_id AND id=ANY(slot_ids)) ids;
 -- Current values/absence must match the recorded final state. Root counters are advanced from
 -- NOW, never restored backwards; unrelated subsequent content changes may coexist.
 FOR d IN SELECT e FROM jsonb_array_elements(inverse) e LOOP
   tbl:=d->>'table'; key:=d->>'id'; b:=nullif(d->'before','null'); a:=nullif(d->'after','null');
   col:=CASE tbl WHEN 'inventory_placements' THEN 'inventory_item_id' WHEN 'storage_collection_state' THEN 'collection_id' ELSE 'id' END;
   EXECUTE format('SELECT collection_audit_private.state(%L,to_jsonb(t)) FROM public.%I t WHERE %I=$1%s',tbl,tbl,col,CASE WHEN tbl IN ('binders','storage_collection_state') THEN '::uuid' ELSE '' END) INTO row_value USING key;
   IF tbl='storage_collection_state' AND a IS NOT NULL THEN
     IF row_value-ARRAY['version','layout_revision'] IS DISTINCT FROM a-ARRAY['version','layout_revision']
       OR (b IS NOT NULL AND b->'layout_revision' IS DISTINCT FROM a->'layout_revision' AND row_value->'layout_revision' IS DISTINCT FROM a->'layout_revision') THEN
       conflicts:=conflicts||jsonb_build_array(jsonb_build_object('entity',tbl||'/'||key,'reason','layout_or_authority_changed'));
     END IF;
   ELSIF row_value IS DISTINCT FROM a THEN
     conflicts:=conflicts||jsonb_build_array(jsonb_build_object('entity',tbl||'/'||key,'reason','entity_changed_or_identity_occupied'));
   END IF;
   IF tbl='inventory_placements' AND b IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.inventory_items WHERE id=key AND owner_user_id=owner_id)
     AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(inverse) e WHERE e->>'table'='inventory_items' AND e->>'id'=key AND e->'before'<>'null') THEN
     conflicts:=conflicts||jsonb_build_array(jsonb_build_object('entity','inventory_items/'||key,'reason','original_copy_missing'));
   END IF;
   IF tbl='binders' AND b IS NOT NULL AND b->'is_default'='true' AND EXISTS(
     SELECT 1 FROM public.binders t WHERE t.owner_user_id=owner_id AND t.is_default AND t.id::text<>key AND NOT EXISTS(
       SELECT 1 FROM jsonb_array_elements(inverse) e WHERE e->>'table'='binders' AND e->>'id'=t.id::text AND e->'before'->'is_default'='false')) THEN
     conflicts:=conflicts||jsonb_build_array(jsonb_build_object('entity',tbl||'/'||key,'reason','current_default_conflict'));
   END IF;
   IF tbl='inventory_placements' AND b IS NOT NULL AND EXISTS(SELECT 1 FROM public.inventory_placements WHERE slot_id=b->>'slot_id' AND inventory_item_id<>key) THEN
     -- A swap's two current occupants are intentionally removed together by the same inverse.
     IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(inverse) e WHERE e->>'table'='inventory_placements' AND e->'after'->>'slot_id'=b->>'slot_id') THEN
       conflicts:=conflicts||jsonb_build_array(jsonb_build_object('entity','binder_slots/'||(b->>'slot_id'),'reason','previous_slot_occupied'));
     END IF;
   END IF;
   IF tbl='binder_slots' AND b IS NOT NULL THEN
     FOR member IN SELECT DISTINCT v #>> '{}' FROM jsonb_array_elements(b->'wanted_cards') w CROSS JOIN LATERAL jsonb_array_elements(coalesce(w->'wanted_by','[]')) v LOOP
       IF NOT public.billing_partner_allowed(owner_id,member::uuid) THEN
         conflicts:=conflicts||jsonb_build_array(jsonb_build_object('entity',tbl||'/'||key,'reason','wanted_member_revoked'));
       END IF;
     END LOOP;
   END IF;
   -- Structural inverse requires retained root/layout evidence. Never guess an anchor/order.
   IF tbl='binder_slots' AND (a IS NULL OR b IS NULL OR a->'position' IS DISTINCT FROM b->'position') AND NOT EXISTS(
     SELECT 1 FROM jsonb_array_elements(inverse) e WHERE e->>'table'='storage_collection_state' AND e->>'id'=coalesce(a,b)->>'collection_id'
       AND (e->'after'='null' OR e->'before'->'layout_revision' IS DISTINCT FROM e->'after'->'layout_revision')) THEN
     unsupported:=unsupported||jsonb_build_array('missing_layout_evidence');
   END IF;
 END LOOP;
 -- Catch ABA and edits to dependencies not themselves mutated in the original event, such as
 -- a later grade on a moved copy. Ignore unrelated owner/collection counter increments.
 SELECT conflicts||coalesce(jsonb_agg(DISTINCT jsonb_build_object('entity',(e->>'table')||'/'||(e->>'id'),'reason','later_entity_change')),'[]') INTO conflicts
 FROM public.collection_activity h CROSS JOIN LATERAL jsonb_array_elements(h.recovery_state) e
 WHERE h.owner_user_id=owner_id AND h.id>event_id AND h.format_version=1 AND (
   (e->>'table'='inventory_items' AND e->>'id'=ANY(item_ids))
   OR (e->>'table'='binder_slots' AND e->>'id'=ANY(slot_ids))
   OR (e->>'table'='binders' AND EXISTS(SELECT 1 FROM jsonb_array_elements(inverse) r WHERE r->>'table'='binders' AND r->>'id'=e->>'id'))
   OR (e->>'table'='inventory_placements' AND (e->>'id'=ANY(item_ids) OR e->'before'->>'slot_id'=ANY(slot_ids) OR e->'after'->>'slot_id'=ANY(slot_ids))));
 -- Layout/collection metadata is included in the reviewed token even for a content-only inverse.
 -- All dependency material stays private. The public wrapper emits only a hash and redaction.
 deps:=public.inventory_evidence_v1(owner_id,item_ids,slot_ids,collection_ids);
 SELECT collection_audit_private.state('inventory_owner_state',to_jsonb(s)) INTO root FROM public.inventory_owner_state s WHERE owner_user_id=owner_id;
 IF root IS NULL THEN unsupported:=unsupported||jsonb_build_array('inventory_storage_unavailable'); END IF;
 FOR choice IN SELECT c FROM unnest(collection_ids) c WHERE NOT EXISTS(SELECT 1 FROM public.storage_collection_state WHERE collection_id=c AND owner_user_id=owner_id AND authority='slots') LOOP
   IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(inverse) e WHERE e->>'table'='storage_collection_state' AND e->>'id'=choice AND e->'after'='null' AND e->'before'->>'authority'='slots') THEN
     conflicts:=conflicts||jsonb_build_array(jsonb_build_object('entity','storage_collection_state/'||choice,'reason','collection_unavailable'));
   END IF;
 END LOOP;
 RETURN jsonb_build_object('supported',jsonb_array_length(unsupported)=0,'unsupported',unsupported,'conflicts',conflicts,
   'inverse',inverse,'dependencies',deps,'root',root,'collectionIds',collection_ids);
END $$;

CREATE OR REPLACE FUNCTION collection_audit_private.recovery_preview_v1(actor uuid,owner_id uuid,event_id bigint,unassigned text[] DEFAULT '{}')
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE plan jsonb; token text;
BEGIN
 plan:=collection_audit_private.recovery_plan_v1(actor,owner_id,event_id,unassigned);
 IF (plan->>'supported')::boolean AND plan->'conflicts'='[]' THEN
   token:=encode(sha256(convert_to(jsonb_build_object('planVersion',1,'actor',actor,'owner',owner_id,'event',event_id,'unassigned',unassigned,'plan',plan)::text,'UTF8')),'hex');
 END IF;
 RETURN jsonb_build_object('planVersion',1,'eventId',event_id::text,'supported',plan->'supported','unsupported',plan->'unsupported',
   'conflicts',plan->'conflicts','planToken',token,'restoreUnassignedItemIds',unassigned,
   'changes',collection_audit_private.redact((SELECT coalesce(jsonb_agg(jsonb_build_object('table',e->'table','id',e->'id',
     'before',nullif(e->'after','null')-ARRAY['version','inventory_revision','layout_revision'],
     'after',nullif(e->'before','null')-ARRAY['version','inventory_revision','layout_revision'])),'[]') FROM jsonb_array_elements(coalesce(plan->'inverse','[]')) e)),
   'rootRevisionsAdvance',true);
END $$;

CREATE OR REPLACE FUNCTION collection_audit_private.recovery_apply_v1(actor uuid,owner_id uuid,request jsonb,trusted_intent jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET lock_timeout='3s' AS $$
DECLARE plan jsonb; reviewed jsonb; prior public.developer_idempotency; digest text; result jsonb; d jsonb; b jsonb; a jsonb;
 tbl text; col text; columns text; updates text; choices text[]; revision bigint; saved_before bigint; allowed integer;
 event_id bigint; original_id bigint; affected uuid[]; ctx jsonb; lock_row record;
BEGIN
 IF NOT public.inventory_object_v1(request,ARRAY['eventId','planVersion','planToken','operationId','restoreUnassignedItemIds','confirmed'])
   OR request->'planVersion'<>'1' OR request->'confirmed'<>'true' OR jsonb_typeof(request->'eventId')<>'string'
   OR (request->>'eventId')!~'^[1-9][0-9]*$' OR NOT public.inventory_id_v1(request->'operationId')
   OR length(request->>'operationId') NOT BETWEEN 8 AND 100 OR jsonb_typeof(request->'planToken')<>'string'
   OR (request->>'planToken')!~'^[a-f0-9]{64}$' OR jsonb_typeof(request->'restoreUnassignedItemIds')<>'array'
   OR octet_length(request::text)>1048576 THEN RAISE EXCEPTION 'invalid_recovery_request' USING ERRCODE='22023'; END IF;
 IF NOT public.inventory_object_v1(trusted_intent,ARRAY['source','clientId','batchId','clientOccurredAt'])
   OR NOT coalesce(trusted_intent->>'source' IN ('app','rest','mcp','import'),false)
   OR (trusted_intent->'clientId'<>'null' AND NOT public.inventory_id_v1(trusted_intent->'clientId'))
   OR (trusted_intent->'batchId'<>'null' AND NOT public.inventory_id_v1(trusted_intent->'batchId'))
   OR (trusted_intent->'clientOccurredAt'<>'null' AND (jsonb_typeof(trusted_intent->'clientOccurredAt')<>'string'
     OR NOT isfinite((trusted_intent->>'clientOccurredAt')::timestamptz))) THEN RAISE EXCEPTION 'invalid_trusted_context' USING ERRCODE='22023'; END IF;
 IF actor IS NULL OR owner_id IS NULL OR NOT EXISTS(SELECT 1 FROM auth.users WHERE id=actor) THEN RAISE EXCEPTION 'recovery_access_denied' USING ERRCODE='42501'; END IF;
 -- Owner recovery may restore a partner's wanted_by too. Hold current membership through
 -- commit for either caller, before the owner lock to preserve command lock ordering.
 PERFORM 1 FROM public.partnerships WHERE owner_user_id=owner_id FOR KEY SHARE;
 IF actor<>owner_id AND NOT FOUND THEN
   RAISE EXCEPTION 'recovery_access_denied' USING ERRCODE='42501';
 END IF;
 IF NOT public.billing_partner_allowed(owner_id,actor) THEN RAISE EXCEPTION 'recovery_access_denied' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(owner_id::text,4701));
 PERFORM 1 FROM public.inventory_owner_state WHERE owner_user_id=owner_id FOR UPDATE;
 -- Runtime has no access to this executor or trusted_intent. A future reviewed wrapper must bind
 -- actor/source from actual auth/transport, as 074/075 do, never deserialize client claims.
 digest:=encode(sha256(convert_to(jsonb_build_object('owner',owner_id,'request',request,'intent',trusted_intent)::text,'UTF8')),'hex');
 SELECT * INTO prior FROM public.developer_idempotency WHERE actor_id=actor AND operation='recovery_v1' AND request_key=request->>'operationId' FOR UPDATE;
 IF FOUND THEN
   IF prior.input_digest<>digest THEN RAISE EXCEPTION 'idempotency_conflict' USING ERRCODE='40001'; END IF;
   RETURN prior.result;
 END IF;
 SELECT coalesce(array_agg(v ORDER BY n),'{}') INTO choices FROM jsonb_array_elements_text(request->'restoreUnassignedItemIds') WITH ORDINALITY a(v,n);
 original_id:=(request->>'eventId')::bigint;
 plan:=collection_audit_private.recovery_plan_v1(actor,owner_id,original_id,choices);
 IF NOT (plan->>'supported')::boolean THEN RAISE EXCEPTION 'recovery_unsupported' USING ERRCODE='0A000',DETAIL=(plan->'unsupported')::text; END IF;
 -- Lock existing dependencies in a fixed order before re-reading/review-token validation.
 -- Absent identity and destination races fail PK/UNIQUE/FK constraints, never UPSERT/displace.
 FOR lock_row IN SELECT id FROM public.binders WHERE owner_user_id=owner_id AND id IN (SELECT v::uuid FROM jsonb_array_elements_text(plan->'collectionIds') v) ORDER BY id FOR UPDATE LOOP END LOOP;
 FOR lock_row IN SELECT collection_id FROM public.storage_collection_state WHERE owner_user_id=owner_id AND collection_id IN (SELECT v::uuid FROM jsonb_array_elements_text(plan->'collectionIds') v) ORDER BY collection_id FOR UPDATE LOOP END LOOP;
 FOR lock_row IN SELECT id FROM public.inventory_items WHERE owner_user_id=owner_id AND id IN (SELECT v->>'id' FROM jsonb_array_elements(plan->'dependencies'->'items') v) ORDER BY id FOR UPDATE LOOP END LOOP;
 FOR lock_row IN SELECT id FROM public.binder_slots WHERE owner_user_id=owner_id AND id IN (SELECT v->>'id' FROM jsonb_array_elements(plan->'dependencies'->'slots') v) ORDER BY id FOR UPDATE LOOP END LOOP;
 FOR lock_row IN SELECT inventory_item_id FROM public.inventory_placements WHERE owner_user_id=owner_id AND inventory_item_id IN (SELECT v->>'inventory_item_id' FROM jsonb_array_elements(plan->'dependencies'->'placements') v) ORDER BY inventory_item_id FOR UPDATE LOOP END LOOP;
 reviewed:=collection_audit_private.recovery_preview_v1(actor,owner_id,original_id,choices);
 IF reviewed->'planToken'='null' OR reviewed->>'planToken' IS DISTINCT FROM request->>'planToken' THEN
   RAISE EXCEPTION 'recovery_plan_conflict' USING ERRCODE='40001',DETAIL=(CASE WHEN reviewed->'conflicts'='[]' THEN jsonb_build_array(jsonb_build_object('entity','owner/'||owner_id::text,'reason','reviewed_dependencies_changed')) ELSE reviewed->'conflicts' END)::text;
 END IF;
 plan:=collection_audit_private.recovery_plan_v1(actor,owner_id,original_id,choices);
 IF EXISTS(SELECT 1 FROM collection_audit_private.pending WHERE transaction_id=txid_current() AND pending.owner_id=recovery_apply_v1.owner_id) THEN
   RAISE EXCEPTION 'recovery_requires_separate_transaction' USING ERRCODE='25001'; END IF;
 saved_before:=public.slot_saved_count_v1(owner_id);
 SELECT coalesce(array_agg(v::uuid),'{}') INTO affected FROM jsonb_array_elements_text(plan->'collectionIds') v;
 -- All placements in the inverse are removed together, permitting a checked swap.
 DELETE FROM public.inventory_placements p USING jsonb_array_elements(plan->'inverse') e
 WHERE e->>'table'='inventory_placements' AND p.inventory_item_id=e->>'id' AND p.owner_user_id=owner_id;
 -- Deletes run child-first. Non-delta children would be silently cascaded, so block them.
 FOR d IN SELECT e FROM jsonb_array_elements(plan->'inverse') e WHERE e->'before'='null'
   ORDER BY CASE e->>'table' WHEN 'binder_slots' THEN 1 WHEN 'inventory_items' THEN 2 WHEN 'storage_collection_state' THEN 3 ELSE 4 END LOOP
   tbl:=d->>'table';
   IF tbl IN ('storage_collection_state','binders') THEN RAISE EXCEPTION 'recovery_unsupported_creation' USING ERRCODE='0A000'; END IF;
   IF tbl='inventory_placements' THEN CONTINUE; END IF;
   IF tbl='inventory_items' AND EXISTS(SELECT 1 FROM public.inventory_placements WHERE inventory_item_id=d->>'id')
     OR tbl='binder_slots' AND (EXISTS(SELECT 1 FROM public.inventory_placements WHERE slot_id=d->>'id')
       OR EXISTS(SELECT 1 FROM public.binder_legacy_rows WHERE slot_id=d->>'id')) THEN
     RAISE EXCEPTION 'recovery_dependency_conflict' USING ERRCODE='40001'; END IF;
   EXECUTE format('DELETE FROM public.%I WHERE id=$1 AND owner_user_id=$2',tbl) USING d->>'id',owner_id;
 END LOOP;
 -- Restore checked existing rows or absent stable IDs, parent-first. No ON CONFLICT UPDATE.
 FOR d IN SELECT e FROM jsonb_array_elements(plan->'inverse') e WHERE e->'before'<>'null'
   ORDER BY CASE e->>'table' WHEN 'binders' THEN 1 WHEN 'storage_collection_state' THEN 2 WHEN 'inventory_items' THEN 3 WHEN 'binder_slots' THEN 4 ELSE 5 END,
     CASE WHEN e->>'table'='binders' THEN e->'before'->>'is_default' END,e->>'id' LOOP
   tbl:=d->>'table'; b:=d->'before'; a:=nullif(d->'after','null');
   IF tbl='storage_collection_state' AND a IS NOT NULL THEN CONTINUE; END IF;
   IF tbl='inventory_items' THEN
     -- Preserve all recorded acquisition/grading/cert values. Missing asset authorization is unsupported.
     b:=jsonb_set(b,'{version}',to_jsonb(greatest((b->>'version')::bigint,coalesce((a->>'version')::bigint,0))+1));
   ELSIF tbl IN ('binder_slots','inventory_placements') THEN
     b:=jsonb_set(b,'{version}',to_jsonb(greatest((b->>'version')::bigint,coalesce((a->>'version')::bigint,0))+1));
   ELSIF tbl='storage_collection_state' THEN
     b:=jsonb_set(jsonb_set(b,'{version}',to_jsonb((b->>'version')::bigint+1)),'{layout_revision}',to_jsonb((b->>'layout_revision')::bigint+1));
   END IF;
   col:=CASE tbl WHEN 'inventory_placements' THEN 'inventory_item_id' WHEN 'storage_collection_state' THEN 'collection_id' ELSE 'id' END;
   -- Only columns retained by 076; schema evolution cannot inject defaults/null columns into UPDATE.
   SELECT string_agg(format('%I',k),',' ORDER BY k),string_agg(format('%1$I=r.%1$I',k),',' ORDER BY k)
     INTO columns,updates FROM jsonb_object_keys(b) k;
   IF a IS NULL OR tbl='inventory_placements' THEN
     EXECUTE format('INSERT INTO public.%1$I(%2$s) SELECT %2$s FROM jsonb_populate_record(NULL::public.%1$I,$1)',tbl,columns) USING b;
   ELSE
     EXECUTE format('UPDATE public.%1$I t SET %2$s FROM jsonb_populate_record(NULL::public.%1$I,$1) r WHERE t.%3$I=r.%3$I AND t.owner_user_id=$2',tbl,updates,col) USING b,owner_id;
   END IF;
 END LOOP;
 -- Revalidate targets against the authoritative catalog, after all restored item/slot rows exist.
 FOR lock_row IN SELECT i.identity,s.target FROM public.inventory_placements p JOIN public.inventory_items i ON i.id=p.inventory_item_id
   JOIN public.binder_slots s ON s.id=p.slot_id WHERE p.owner_user_id=owner_id AND (p.slot_id IN (SELECT e->>'id' FROM jsonb_array_elements(plan->'inverse') e WHERE e->>'table'='binder_slots')
     OR p.inventory_item_id IN (SELECT e->>'id' FROM jsonb_array_elements(plan->'inverse') e WHERE e->>'table' IN ('inventory_items','inventory_placements'))) LOOP
   PERFORM public.inventory_match_v1(lock_row.identity,lock_row.target);
 END LOOP;
 FOR d IN SELECT e FROM jsonb_array_elements(plan->'inverse') e WHERE e->>'table'='binder_slots' AND e->'before'<>'null' LOOP
   PERFORM public.slot_check_target_v1(owner_id,d->>'id',d->'before'->'target');
 END LOOP;
 IF EXISTS(SELECT 1 FROM public.binder_slots WHERE owner_user_id=owner_id AND collection_id=ANY(affected) GROUP BY collection_id HAVING count(*)>4096) THEN
   RAISE EXCEPTION 'slot_capacity_exceeded' USING ERRCODE='22023'; END IF;
 IF public.billing_enforced() AND NOT public.billing_has_paid(owner_id) AND public.slot_saved_count_v1(owner_id)>saved_before THEN
   SELECT free_card_limit INTO allowed FROM public.billing_configuration WHERE id;
   IF public.slot_saved_count_v1(owner_id)>coalesce(allowed,10) THEN RAISE EXCEPTION 'card_limit_reached'; END IF;
 END IF;
 UPDATE public.inventory_owner_state SET inventory_revision=inventory_revision+1 WHERE owner_user_id=owner_id RETURNING inventory_revision INTO revision;
 UPDATE public.storage_collection_state s SET version=version+1,layout_revision=layout_revision+CASE WHEN EXISTS(
   SELECT 1 FROM jsonb_array_elements(plan->'inverse') e WHERE e->>'table'='storage_collection_state' AND e->>'id'=s.collection_id::text
     AND e->'before'->'layout_revision' IS DISTINCT FROM e->'after'->'layout_revision' AND e->'after'<>'null') THEN 1 ELSE 0 END
 WHERE s.owner_user_id=owner_id AND collection_id=ANY(affected) AND NOT EXISTS(
   SELECT 1 FROM jsonb_array_elements(plan->'inverse') e WHERE e->>'table'='storage_collection_state' AND e->>'id'=s.collection_id::text AND e->'after'='null');
 ctx:=jsonb_build_object('actor',jsonb_build_object('kind','user','userId',actor),'source',trusted_intent->'source','clientId',trusted_intent->'clientId',
   'operationId',request->'operationId','batchId',trusted_intent->'batchId','clientOccurredAt',trusted_intent->'clientOccurredAt','action','recovery.apply');
 UPDATE collection_audit_private.pending SET context=ctx,recovery_of_event_id=original_id
 WHERE transaction_id=txid_current() AND pending.owner_id=recovery_apply_v1.owner_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'recovery_recorder_missing'; END IF;
 -- Force the existing recorder now, inside this transaction. Failure rolls state, ledger and event back.
 SET CONSTRAINTS ALL IMMEDIATE;
 SET CONSTRAINTS ALL DEFERRED;
 SELECT id INTO event_id FROM public.collection_activity WHERE owner_user_id=owner_id AND operation_id=request->>'operationId' AND recovery_of_event_id=original_id;
 IF event_id IS NULL THEN RAISE EXCEPTION 'recovery_recorder_missing'; END IF;
 result:=jsonb_build_object('recoveredEventId',original_id::text,'eventId',event_id::text,'inventoryRevision',revision,
   'collections',(SELECT coalesce(jsonb_agg(jsonb_build_object('collectionId',collection_id,'version',version,'layoutRevision',layout_revision) ORDER BY collection_id),'[]')
     FROM public.storage_collection_state WHERE owner_user_id=owner_id AND collection_id=ANY(affected)));
 INSERT INTO public.developer_idempotency(actor_id,operation,request_key,input_digest,result,expires_at)
 VALUES(actor,'recovery_v1',request->>'operationId',digest,result,'infinity');
 RETURN result;
END $$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA collection_audit_private FROM PUBLIC,anon,authenticated,holo_mcp,service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
