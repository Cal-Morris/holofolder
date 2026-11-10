-- 104: faster native writes, audit flush and Undo, with identical results.
-- Every function changed here is written out in full (from pg_get_functiondef of the live
-- definition), never patched through replace() on its source. Rerunnable: CREATE OR REPLACE
-- for functions, and the trigger split drops and recreates both triggers in one transaction.
--
-- 1. redact(): return objects/arrays unchanged when their jsonb text names none of the
--    redacted keys. jsonb text always writes an object key as "key": , and the listed keys
--    are plain ASCII, so a value without any match is exactly what the walk would rebuild.
--    flush() and the recovery previews call redact(), so they all get faster.
-- 2. capture(): build the audit context only for the transaction's first captured row.
-- 3. slot_placement_consistency: the UPDATE variant only fires when status, id or
--    collection_id change. The check reads only those slot columns plus placements (which
--    have their own trigger) and the collection authority (which can't leave 'slots').
-- 4. inventory_command_v1: catalog eligibility runs the catalog functions only on unplaced,
--    unused copies (id prefilter, full predicates and FOR UPDATE unchanged); evidence is
--    built as jsonb[] once; the free-card count is only taken when billing limits apply.
-- 5. slot_command_v1: the same free-card count gating.
-- 6. recovery_plan_v1: read current native rows once per table instead of one dynamic query
--    per inverse entry, replace two per-entry scans of the inverse with precomputed sets, and
--    test the table before running a per-entry subquery that only applies to that table.
BEGIN;
SET LOCAL lock_timeout = '3s';

CREATE OR REPLACE FUNCTION collection_audit_private.redact(value jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
DECLARE result jsonb; key text; child jsonb;
BEGIN
 -- jsonb text always writes an object key as "key": , so a value whose text names none of the keys
 -- below (or artwork) comes back unchanged from the walk. A false positive only takes the walk.
 IF jsonb_typeof(value) IN ('object','array') AND value::text !~ '"(c(ertificate|redentials)|a(ssetIds|ccess_token|rtwork(Ref)?)|legacy_source|s(ource_row|ecret)|token|refresh_token|jwt|label)": ' THEN RETURN value; END IF;
 IF jsonb_typeof(value)='object' THEN
   result:='{}';
   FOR key,child IN SELECT * FROM jsonb_each(value) LOOP
     IF key NOT IN ('certificate','assetIds','legacy_source','source_row','token','access_token','refresh_token','jwt','secret','credentials','artworkRef','label') THEN
       IF NOT (key='artwork' AND jsonb_typeof(child)='string' AND child #>> '{}' LIKE 'upload:%') THEN
         result:=result||jsonb_build_object(key,collection_audit_private.redact(child));
       END IF;
     END IF;
   END LOOP;
   RETURN result;
 ELSIF jsonb_typeof(value)='array' THEN
   RETURN (SELECT coalesce(jsonb_agg(collection_audit_private.redact(v) ORDER BY n),'[]') FROM jsonb_array_elements(value) WITH ORDINALITY a(v,n));
 END IF;
 RETURN value;
END $function$;

CREATE OR REPLACE FUNCTION collection_audit_private.capture()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
<<capture>>
DECLARE b jsonb; a jsonb; row_data jsonb; owner_id uuid; entity text; tx bigint:=txid_current();
BEGIN
 IF TG_OP<>'INSERT' THEN b:=collection_audit_private.state(TG_TABLE_NAME,to_jsonb(OLD)); END IF;
 IF TG_OP<>'DELETE' THEN a:=collection_audit_private.state(TG_TABLE_NAME,to_jsonb(NEW)); END IF;
 IF a IS NOT DISTINCT FROM b THEN RETURN NULL; END IF;
 row_data:=coalesce(a,b); owner_id:=coalesce(row_data->>'owner_user_id',row_data->>'user_id')::uuid;
 IF NOT EXISTS(SELECT 1 FROM auth.users WHERE id=owner_id) THEN RETURN NULL; END IF;
 IF b IS NOT NULL AND coalesce(b->>'owner_user_id',b->>'user_id')::uuid IS DISTINCT FROM owner_id THEN
   RAISE EXCEPTION 'audit_owner_transfer_unsupported' USING ERRCODE='42501';
 END IF;
 -- mapping_entity_identity: distinct frozen rows are distinct audited entities.
 entity:=TG_TABLE_NAME||'/'||CASE WHEN TG_TABLE_NAME='binder_legacy_rows' THEN row_data->>'legacy_row_id'
   ELSE coalesce(row_data->>'id',row_data->>'inventory_item_id',row_data->>'collection_id',owner_id::text) END;
 -- Build the context only for the transaction's first row; later rows hit the existing pending row.
 INSERT INTO collection_audit_private.pending(transaction_id,owner_id,context)
 SELECT tx,capture.owner_id,collection_audit_private.context(capture.owner_id)
 WHERE NOT EXISTS(SELECT 1 FROM collection_audit_private.pending p WHERE p.transaction_id=tx AND p.owner_id=capture.owner_id)
 ON CONFLICT DO NOTHING;
 INSERT INTO collection_audit_private.deltas(transaction_id,owner_id,entity,table_name,entity_id,before_state,after_state)
 VALUES(tx,owner_id,entity,TG_TABLE_NAME,substr(entity,position('/' IN entity)+1),b,a)
 ON CONFLICT ON CONSTRAINT deltas_pkey DO UPDATE SET after_state=excluded.after_state;
 IF TG_TABLE_NAME='storage_collection_state' AND a->>'authority'='slots' AND a->'conversion_receipt' IS NOT NULL AND a->'conversion_receipt'<>'null'
   AND b->>'authority' IS DISTINCT FROM 'slots' THEN
   UPDATE collection_audit_private.pending SET context=context||jsonb_build_object('action','legacy_conversion'),command_evidence=a->'conversion_receipt'
   WHERE transaction_id=tx AND pending.owner_id=capture.owner_id;
 END IF;
 RETURN NULL;
END $function$;

DROP TRIGGER IF EXISTS slot_placement_consistency ON public.binder_slots;
DROP TRIGGER IF EXISTS slot_placement_consistency_update ON public.binder_slots;
CREATE CONSTRAINT TRIGGER slot_placement_consistency AFTER INSERT OR DELETE ON public.binder_slots
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.check_slot_placement_v1();
-- Position-only renumbers can't change the outcome of check_slot_placement_v1.
CREATE CONSTRAINT TRIGGER slot_placement_consistency_update AFTER UPDATE ON public.binder_slots
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
 WHEN (OLD.status IS DISTINCT FROM NEW.status OR OLD.id IS DISTINCT FROM NEW.id OR OLD.collection_id IS DISTINCT FROM NEW.collection_id)
 EXECUTE FUNCTION public.check_slot_placement_v1();

CREATE OR REPLACE FUNCTION public.inventory_command_v1(actor uuid, owner_id uuid, request jsonb, trusted_intent jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
 SET lock_timeout TO '3s'
 SET statement_timeout TO '10s'
AS $function$
DECLARE revision bigint; prior public.developer_idempotency; digest text; state public.storage_collection_state; token jsonb;
 command jsonb; kind text; ref jsonb; dest jsonb; selection jsonb; chosen public.inventory_items; displaced public.inventory_items;
 placement public.inventory_placements; dest_placement public.inventory_placements; card public.tcg_cards; identity_value jsonb;
 slots text[]; items text[]; collections uuid[]; all_slots text[]:='{}'; all_items text[]:='{}'; all_collections uuid[]:='{}';
 declared_collections uuid[]:='{}'; selected_ids text[]:='{}'; acquired_ids text[]:='{}'; changed_collections uuid[]:='{}'; structural_collections uuid[]:='{}';
 key text; collection uuid; before_value jsonb; evidence jsonb[]:='{}'; result jsonb; context jsonb; want jsonb; wants jsonb; idx integer;
 saved_before bigint; allowed integer; groups integer; affected integer:=0; changed boolean:=false; effective boolean;
 whole_collection_delete boolean;
 insert_order text[]; insert_index integer; insert_work integer:=0;
BEGIN
 whole_collection_delete:=CASE WHEN jsonb_typeof(request->'commands')='array' THEN jsonb_array_length(request->'commands')=1 AND request->'commands'->0->>'kind'='deleteCollection' ELSE false END;
 IF actor IS NULL OR owner_id IS NULL THEN RAISE EXCEPTION 'inventory_access_denied' USING ERRCODE='42501'; END IF;
 IF NOT public.inventory_object_v1(request,ARRAY['operationId','inventoryRevision','collections','commands'])
   OR octet_length(request::text)>(CASE WHEN whole_collection_delete THEN 8388608 ELSE 262144 END) OR NOT public.inventory_id_v1(request->'operationId') OR length(request->>'operationId') NOT BETWEEN 8 AND 100
   OR NOT public.inventory_revision_v1(request->'inventoryRevision') OR jsonb_typeof(request->'commands') IS DISTINCT FROM 'array'
   OR jsonb_typeof(request->'collections') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'invalid_inventory_command' USING ERRCODE='22023'; END IF;
 IF jsonb_array_length(request->'commands') NOT BETWEEN 1 AND 100 OR jsonb_array_length(request->'collections')>(CASE WHEN whole_collection_delete THEN 2 ELSE 32 END) THEN RAISE EXCEPTION 'invalid_inventory_command' USING ERRCODE='22023'; END IF;
 IF NOT public.inventory_object_v1(trusted_intent,ARRAY['source','clientId','batchId','clientOccurredAt'])
   OR NOT coalesce(trusted_intent->>'source' IN ('app','rest','mcp','import','system','migration'),false)
   OR (trusted_intent->'clientId'<>'null' AND NOT public.inventory_id_v1(trusted_intent->'clientId'))
   OR (trusted_intent->'batchId'<>'null' AND NOT public.inventory_id_v1(trusted_intent->'batchId'))
   OR (trusted_intent->'clientOccurredAt'<>'null' AND jsonb_typeof(trusted_intent->'clientOccurredAt')<>'string') THEN RAISE EXCEPTION 'invalid_trusted_context' USING ERRCODE='22023'; END IF;
 IF trusted_intent->'clientOccurredAt'<>'null' THEN
   IF NOT isfinite((trusted_intent->>'clientOccurredAt')::timestamptz) THEN RAISE EXCEPTION 'invalid_trusted_context' USING ERRCODE='22023'; END IF;
 END IF;
 IF actor<>owner_id THEN
   PERFORM 1 FROM public.partnerships WHERE owner_user_id=owner_id AND actor IN(user1_id,user2_id) FOR KEY SHARE;
   IF NOT FOUND THEN RAISE EXCEPTION 'inventory_access_denied' USING ERRCODE='42501'; END IF;
 END IF;
 IF NOT public.billing_partner_allowed(owner_id,actor) THEN RAISE EXCEPTION 'inventory_access_denied' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(owner_id::text,4701));
 SELECT inventory_revision INTO revision FROM public.inventory_owner_state WHERE owner_user_id=owner_id FOR UPDATE;
 IF revision IS NULL THEN RAISE EXCEPTION 'inventory_storage_unavailable' USING ERRCODE='55000'; END IF;
 -- Replay after current authorization, before stale/removed entity checks, including collection deletion.
 digest:=encode(sha256(convert_to(jsonb_build_object('owner',owner_id,'request',request,'intent',trusted_intent)::text,'UTF8')),'hex');
 SELECT * INTO prior FROM public.developer_idempotency WHERE actor_id=actor AND operation='inventory_v1' AND request_key=request->>'operationId' FOR UPDATE;
 IF FOUND THEN
   IF prior.input_digest<>digest THEN RAISE EXCEPTION 'idempotency_conflict' USING ERRCODE='40001'; END IF;
   RETURN prior.result;
 END IF;
 IF to_jsonb(revision) IS DISTINCT FROM request->'inventoryRevision' THEN RAISE EXCEPTION 'inventory_revision_conflict' USING ERRCODE='40001'; END IF;
 FOR token IN SELECT v FROM jsonb_array_elements(request->'collections') v ORDER BY v->>'collectionId' LOOP
   IF NOT public.inventory_object_v1(token,ARRAY['collectionId','version','layoutRevision']) OR NOT public.inventory_revision_v1(token->'version')
     OR NOT public.inventory_revision_v1(token->'layoutRevision') THEN RAISE EXCEPTION 'invalid_inventory_command' USING ERRCODE='22023'; END IF;
   collection:=(token->>'collectionId')::uuid;
   IF collection=ANY(declared_collections) THEN RAISE EXCEPTION 'invalid_inventory_command' USING ERRCODE='22023'; END IF;
   declared_collections:=array_append(declared_collections,collection);
   PERFORM 1 FROM public.binders WHERE id=collection AND owner_user_id=owner_id FOR UPDATE;
   IF NOT FOUND THEN RAISE EXCEPTION 'inventory_access_denied' USING ERRCODE='42501'; END IF;
   SELECT * INTO state FROM public.storage_collection_state WHERE collection_id=collection AND owner_user_id=owner_id FOR UPDATE;
   IF NOT FOUND OR state.authority<>'slots' THEN RAISE EXCEPTION 'inventory_storage_unavailable' USING ERRCODE='55000'; END IF;
   IF to_jsonb(state.version) IS DISTINCT FROM token->'version' OR to_jsonb(state.layout_revision) IS DISTINCT FROM token->'layoutRevision' THEN
     RAISE EXCEPTION 'inventory_collection_conflict' USING ERRCODE='40001'; END IF;
 END LOOP;
 -- The free-card count only matters when the limit applies.
 IF public.billing_enforced() AND NOT public.billing_has_paid(owner_id) THEN saved_before:=public.slot_saved_count_v1(owner_id); END IF;
 FOR command IN SELECT jsonb_array_elements(request->'commands') LOOP
   kind:=command->>'kind'; slots:='{}'; items:='{}'; collections:='{}'; chosen:=NULL; displaced:=NULL; placement:=NULL; dest_placement:=NULL; effective:=true;
   -- atomic_insert_assign_091: original request/digest stay immutable; replay already resolved.
   IF kind='insertAssign' THEN
     IF NOT public.inventory_object_v1(command,ARRAY['kind','collectionId','slotId','before','target','selection'])
       OR NOT public.inventory_id_v1(command->'slotId') THEN RAISE EXCEPTION 'invalid_inventory_command' USING ERRCODE='22023'; END IF;
     collection:=(command->>'collectionId')::uuid;
     IF NOT collection=ANY(declared_collections) THEN RAISE EXCEPTION 'inventory_access_denied' USING ERRCODE='42501'; END IF;
     IF EXISTS(SELECT 1 FROM public.binder_slots WHERE id=command->>'slotId') THEN RAISE EXCEPTION 'slot_conflict' USING ERRCODE='40001'; END IF;
     SELECT coalesce(array_agg(id ORDER BY position,id),'{}') INTO insert_order FROM public.binder_slots WHERE collection_id=collection AND owner_user_id=owner_id;
     IF cardinality(insert_order)>=4096 THEN RAISE EXCEPTION 'slot_capacity_exceeded' USING ERRCODE='22023'; END IF;
     IF command->'before'='null' THEN insert_index:=cardinality(insert_order)+1;
     ELSE
       -- Anchors must already exist, not be another inserted slot from this request.
       IF command->'before'->>'id'=ANY(all_slots) THEN RAISE EXCEPTION 'invalid_inventory_repeated_entity' USING ERRCODE='22023'; END IF;
       PERFORM public.slot_check_ref_v1(owner_id,collection,command->'before');
       insert_index:=array_position(insert_order,command->'before'->>'id');
       IF insert_index IS NULL THEN RAISE EXCEPTION 'slot_conflict' USING ERRCODE='40001'; END IF;
     END IF;
     -- Bound actual order work, including repagination of a sparse saved arrangement.
     insert_work:=insert_work+cardinality(insert_order)+1;
     IF insert_work>8192 THEN RAISE EXCEPTION 'inventory_batch_too_large' USING ERRCODE='22023'; END IF;
     PERFORM public.slot_check_target_v1(owner_id,command->>'slotId',command->'target');
     selection:=command->'selection';
     IF selection<>'null' THEN
       IF selection->>'kind'='existing' THEN
         IF NOT public.inventory_object_v1(selection,ARRAY['kind','inventoryItemId','itemVersion']) THEN RAISE EXCEPTION 'invalid_inventory_command' USING ERRCODE='22023'; END IF;
         chosen:=public.inventory_item_ref_v1(owner_id,jsonb_build_object('itemId',selection->'inventoryItemId','itemVersion',selection->'itemVersion','placement',NULL));
       ELSIF selection->>'kind'='new' THEN
         chosen:=collection_audit_private.insert_item_v1(owner_id,selection);
         acquired_ids:=array_append(acquired_ids,chosen.id);
       ELSE RAISE EXCEPTION 'invalid_inventory_selection' USING ERRCODE='22023'; END IF;
       PERFORM public.inventory_match_v1(chosen.identity,command->'target');
       items:=ARRAY[chosen.id]; selected_ids:=array_append(selected_ids,chosen.id);
     END IF;
     slots:=ARRAY[command->>'slotId']; collections:=ARRAY[collection];
   ELSIF kind='add' THEN
     IF NOT public.inventory_object_v1(command,ARRAY['kind','itemId','identity','grading','acquiredAt']) OR NOT public.inventory_id_v1(command->'itemId')
       OR NOT public.valid_inventory_identity_v1(command->'identity') OR NOT public.valid_grading_record_v1(nullif(command->'grading','null'))
       OR (command->'grading'<>'null' AND command->'identity'->>'kind'<>'card')
       OR (command->'acquiredAt'<>'null' AND jsonb_typeof(command->'acquiredAt')<>'string') THEN RAISE EXCEPTION 'invalid_inventory_command' USING ERRCODE='22023'; END IF;
     identity_value:=command->'identity';
     IF identity_value->>'kind'='card' THEN
       card:=public.slot_catalog_card_v1(identity_value->>'cardId');
       IF card.id IS NULL THEN RAISE EXCEPTION 'inventory_catalog_unavailable' USING ERRCODE='22023'; END IF;
       identity_value:=jsonb_set(identity_value,'{cardId}',to_jsonb(CASE WHEN jsonb_typeof(card.external_ids_json->'catalog'->'canonicalId')='string' AND length(card.external_ids_json->'catalog'->>'canonicalId') BETWEEN 1 AND 200 THEN card.external_ids_json->'catalog'->>'canonicalId' ELSE card.id END));
     ELSIF (identity_value->>'pokemonId')::numeric NOT BETWEEN 1 AND 1025 THEN RAISE EXCEPTION 'inventory_catalog_unavailable' USING ERRCODE='22023'; END IF;
     IF command->'acquiredAt'<>'null' AND NOT isfinite((command->>'acquiredAt')::timestamptz) THEN RAISE EXCEPTION 'invalid_inventory_command' USING ERRCODE='22023'; END IF;
     chosen.id:=command->>'itemId'; chosen.identity:=identity_value; chosen.grading:=nullif(command->'grading','null'); chosen.acquired_at:=(command->>'acquiredAt')::timestamptz; chosen.version:=0;
     IF EXISTS(SELECT 1 FROM public.inventory_items WHERE id=chosen.id) THEN RAISE EXCEPTION 'item_conflict' USING ERRCODE='40001'; END IF;
     items:=ARRAY[chosen.id]; acquired_ids:=array_append(acquired_ids,chosen.id);
   ELSIF kind IN ('edit','patchGrading','removeOwned','unassign','move') THEN
     IF NOT public.inventory_object_v1(command,CASE kind WHEN 'patchGrading' THEN ARRAY['kind','item','patch'] WHEN 'edit' THEN ARRAY['kind','item','grading'] WHEN 'move' THEN ARRAY['kind','item','destination','occupied','fulfillWant'] ELSE ARRAY['kind','item'] END) THEN RAISE EXCEPTION 'invalid_inventory_command' USING ERRCODE='22023'; END IF;
     chosen:=public.inventory_item_ref_v1(owner_id,command->'item'); items:=ARRAY[chosen.id];
     SELECT * INTO placement FROM public.inventory_placements WHERE inventory_item_id=chosen.id AND owner_user_id=owner_id;
     IF placement.slot_id IS NOT NULL THEN slots:=ARRAY[placement.slot_id]; collections:=ARRAY[placement.collection_id]; END IF;
     IF kind='move' AND placement.slot_id IS NULL THEN RAISE EXCEPTION 'placement_conflict' USING ERRCODE='40001'; END IF;
     -- private_preserving_intent_090: original request remains immutable. This
     -- local command is resolved only after lifetime replay and item/placement locks.
     IF kind='patchGrading' THEN
       IF chosen.grading IS NULL OR chosen.identity->>'kind'<>'card'
         OR jsonb_typeof(command->'patch') IS DISTINCT FROM 'object'
         OR command->'patch'='{}'::jsonb
         OR (command->'patch')-ARRAY['provider','grade','scale','designation','subgrades','holder','labelVariant']<>'{}'::jsonb THEN
         RAISE EXCEPTION 'invalid_inventory_grading_patch' USING ERRCODE='22023';
       END IF;
       identity_value:=chosen.grading||((command->'patch')-'labelVariant');
       IF command->'patch' ? 'labelVariant' THEN
         identity_value:=jsonb_set(identity_value,'{label,variant}',command->'patch'->'labelVariant');
       END IF;
       IF NOT public.valid_grading_record_v1(identity_value) THEN
         RAISE EXCEPTION 'invalid_inventory_grading_patch' USING ERRCODE='22023';
       END IF;
       command:=jsonb_build_object('kind','edit','item',command->'item','grading',identity_value);
       kind:='edit';
     END IF;
     IF kind='edit' THEN
       IF NOT public.valid_grading_record_v1(nullif(command->'grading','null')) OR (command->'grading'<>'null' AND chosen.identity->>'kind'<>'card') THEN RAISE EXCEPTION 'invalid_inventory_grading' USING ERRCODE='22023'; END IF;
       effective:=chosen.grading IS DISTINCT FROM nullif(command->'grading','null');
     ELSIF kind='unassign' THEN effective:=placement.slot_id IS NOT NULL;
     END IF;
   ELSIF kind='assign' THEN
     IF NOT public.inventory_object_v1(command,ARRAY['kind','selection','destination','occupied','fulfillWant']) THEN RAISE EXCEPTION 'invalid_inventory_command' USING ERRCODE='22023'; END IF;
     selection:=command->'selection';
     IF selection->>'kind'='existing' THEN
       IF NOT public.inventory_object_v1(selection,ARRAY['kind','inventoryItemId','itemVersion']) THEN RAISE EXCEPTION 'invalid_inventory_command' USING ERRCODE='22023'; END IF;
       chosen:=public.inventory_item_ref_v1(owner_id,jsonb_build_object('itemId',selection->'inventoryItemId','itemVersion',selection->'itemVersion','placement',NULL));
     ELSIF selection->>'kind'='catalog' THEN
       IF NOT public.inventory_object_v1(selection,ARRAY['kind','identity','newItemId']) OR NOT public.inventory_id_v1(selection->'newItemId')
         OR NOT public.valid_inventory_identity_v1(selection->'identity') OR selection->'identity'->>'kind'<>'card' THEN RAISE EXCEPTION 'invalid_inventory_command' USING ERRCODE='22023'; END IF;
       identity_value:=selection->'identity'; card:=public.slot_catalog_card_v1(identity_value->>'cardId');
       IF card.id IS NULL THEN RAISE EXCEPTION 'inventory_catalog_unavailable' USING ERRCODE='22023'; END IF;
       -- Same #382 eligibility: canonical printing, exact optional variant values, Unassigned only.
       -- The id prefilter keeps the catalog functions off placed/used copies; full predicates still apply.
       SELECT count(DISTINCT coalesce(i.grading,'null')) INTO groups FROM public.inventory_items i
       WHERE i.id=ANY(ARRAY(SELECT u.id FROM public.inventory_items u WHERE u.owner_user_id=owner_id AND u.identity->>'kind'='card'
           AND u.identity->'language' IS NOT DISTINCT FROM identity_value->'language' AND u.identity->'finish' IS NOT DISTINCT FROM identity_value->'finish'
           AND NOT u.id=ANY(all_items) AND NOT EXISTS(SELECT 1 FROM public.inventory_placements p WHERE p.inventory_item_id=u.id))) AND i.owner_user_id=owner_id AND i.identity->>'kind'='card' AND i.identity->'language' IS NOT DISTINCT FROM identity_value->'language'
         AND i.identity->'finish' IS NOT DISTINCT FROM identity_value->'finish' AND NOT i.id=ANY(all_items)
         AND NOT EXISTS(SELECT 1 FROM public.inventory_placements p WHERE p.inventory_item_id=i.id)
         AND (CASE WHEN jsonb_typeof(card.external_ids_json->'catalog'->'canonicalId')='string'
           AND length(card.external_ids_json->'catalog'->>'canonicalId') BETWEEN 1 AND 200
           THEN card.external_ids_json->'catalog'->>'canonicalId' ELSE card.id END)
           =ANY(public.slot_catalog_ids_v1(public.slot_catalog_card_v1(i.identity->>'cardId')));
       IF groups>1 THEN RAISE EXCEPTION 'inventory_copy_choice_required' USING ERRCODE='40001'; END IF;
       SELECT i.* INTO chosen FROM public.inventory_items i WHERE i.id=ANY(ARRAY(SELECT u.id FROM public.inventory_items u WHERE u.owner_user_id=owner_id AND u.identity->>'kind'='card'
           AND u.identity->'language' IS NOT DISTINCT FROM identity_value->'language' AND u.identity->'finish' IS NOT DISTINCT FROM identity_value->'finish'
           AND NOT u.id=ANY(all_items) AND NOT EXISTS(SELECT 1 FROM public.inventory_placements p WHERE p.inventory_item_id=u.id))) AND i.owner_user_id=owner_id AND i.identity->>'kind'='card'
         AND i.identity->'language' IS NOT DISTINCT FROM identity_value->'language' AND i.identity->'finish' IS NOT DISTINCT FROM identity_value->'finish'
         AND NOT i.id=ANY(all_items) AND NOT EXISTS(SELECT 1 FROM public.inventory_placements p WHERE p.inventory_item_id=i.id)
         AND (CASE WHEN jsonb_typeof(card.external_ids_json->'catalog'->'canonicalId')='string'
           AND length(card.external_ids_json->'catalog'->>'canonicalId') BETWEEN 1 AND 200
           THEN card.external_ids_json->'catalog'->>'canonicalId' ELSE card.id END)
           =ANY(public.slot_catalog_ids_v1(public.slot_catalog_card_v1(i.identity->>'cardId'))) ORDER BY i.id COLLATE "C" LIMIT 1 FOR UPDATE;
       IF chosen.id IS NULL THEN
         chosen.id:=selection->>'newItemId'; chosen.identity:=jsonb_set(identity_value,'{cardId}',to_jsonb(CASE WHEN jsonb_typeof(card.external_ids_json->'catalog'->'canonicalId')='string' AND length(card.external_ids_json->'catalog'->>'canonicalId') BETWEEN 1 AND 200 THEN card.external_ids_json->'catalog'->>'canonicalId' ELSE card.id END));
         chosen.grading:=NULL; chosen.acquired_at:=NULL; chosen.version:=0;
         IF EXISTS(SELECT 1 FROM public.inventory_items WHERE id=chosen.id) THEN RAISE EXCEPTION 'item_conflict' USING ERRCODE='40001'; END IF;
         acquired_ids:=array_append(acquired_ids,chosen.id);
       END IF;
     ELSE RAISE EXCEPTION 'invalid_inventory_selection' USING ERRCODE='22023'; END IF;
     items:=ARRAY[chosen.id];
   ELSIF kind='removeSlots' THEN
     IF NOT public.inventory_object_v1(command,ARRAY['kind','slots']) OR jsonb_typeof(command->'slots') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'invalid_inventory_command' USING ERRCODE='22023'; END IF;
     IF jsonb_array_length(command->'slots') NOT BETWEEN 1 AND 256 THEN RAISE EXCEPTION 'invalid_inventory_command' USING ERRCODE='22023'; END IF;
     FOR ref IN SELECT jsonb_array_elements(command->'slots') LOOP
       IF NOT public.inventory_object_v1(ref,ARRAY['collectionId','slot']) THEN RAISE EXCEPTION 'invalid_inventory_command' USING ERRCODE='22023'; END IF;
       collection:=(ref->>'collectionId')::uuid;
       IF NOT collection=ANY(declared_collections) THEN RAISE EXCEPTION 'inventory_access_denied' USING ERRCODE='42501'; END IF;
       PERFORM public.slot_check_ref_v1(owner_id,collection,ref->'slot'); slots:=array_append(slots,ref->'slot'->>'id'); collections:=array_append(collections,collection);
     END LOOP;
     SELECT coalesce(array_agg(inventory_item_id),'{}') INTO items FROM public.inventory_placements WHERE slot_id=ANY(slots) AND owner_user_id=owner_id;
   ELSIF kind='deleteCollection' THEN
     IF jsonb_typeof(command->'slots')='array' AND jsonb_array_length(command->'slots')>4096 THEN RAISE EXCEPTION 'inventory_collection_capacity_exceeded' USING ERRCODE='22023'; END IF;
     IF NOT public.inventory_object_v1(command,ARRAY['kind','collectionId','slots','replacementDefaultCollectionId']) OR jsonb_typeof(command->'slots') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'invalid_inventory_command' USING ERRCODE='22023'; END IF;
     collection:=(command->>'collectionId')::uuid;
     IF NOT collection=ANY(declared_collections) THEN RAISE EXCEPTION 'inventory_access_denied' USING ERRCODE='42501'; END IF;
     IF NOT EXISTS(SELECT 1 FROM public.binders WHERE id=collection AND owner_user_id=owner_id) THEN RAISE EXCEPTION 'inventory_access_denied' USING ERRCODE='42501'; END IF;
     collections:=ARRAY[collection];
     IF EXISTS(SELECT 1 FROM public.binders WHERE id=collection AND owner_user_id=owner_id AND is_default) THEN
       IF command->'replacementDefaultCollectionId'='null' OR NOT (command->>'replacementDefaultCollectionId')::uuid=ANY(declared_collections)
         OR command->>'replacementDefaultCollectionId'=collection::text
         OR NOT EXISTS(SELECT 1 FROM public.binders WHERE id=(command->>'replacementDefaultCollectionId')::uuid AND owner_user_id=owner_id) THEN RAISE EXCEPTION 'inventory_default_replacement_required' USING ERRCODE='22023'; END IF;
       collections:=array_append(collections,(command->>'replacementDefaultCollectionId')::uuid);
     ELSIF command->'replacementDefaultCollectionId'<>'null' THEN RAISE EXCEPTION 'invalid_inventory_command' USING ERRCODE='22023'; END IF;
     FOR ref IN SELECT jsonb_array_elements(command->'slots') LOOP
       PERFORM public.slot_check_ref_v1(owner_id,collection,ref); slots:=array_append(slots,ref->>'id');
     END LOOP;
     IF cardinality(slots)<>(SELECT count(*) FROM public.binder_slots WHERE collection_id=collection AND owner_user_id=owner_id) THEN RAISE EXCEPTION 'slot_conflict' USING ERRCODE='40001'; END IF;
     SELECT coalesce(array_agg(inventory_item_id),'{}') INTO items FROM public.inventory_placements WHERE slot_id=ANY(slots) AND owner_user_id=owner_id;
   ELSE RAISE EXCEPTION 'invalid_inventory_command' USING ERRCODE='22023'; END IF;

   IF kind IN ('assign','move') THEN
     dest:=command->'destination';
     IF NOT public.inventory_object_v1(dest,ARRAY['collectionId','slot']) OR NOT coalesce(command->>'occupied' IN ('cancel','unassign','swap'),false)
       OR (kind='assign' AND command->>'occupied'='swap') THEN RAISE EXCEPTION 'invalid_inventory_command' USING ERRCODE='22023'; END IF;
     collection:=(dest->>'collectionId')::uuid;
     IF NOT collection=ANY(declared_collections) THEN RAISE EXCEPTION 'inventory_access_denied' USING ERRCODE='42501'; END IF;
     PERFORM public.slot_check_ref_v1(owner_id,collection,dest->'slot');
     IF dest->'slot'->>'id'=ANY(slots) THEN RAISE EXCEPTION 'invalid_inventory_same_slot' USING ERRCODE='22023'; END IF;
     slots:=array_append(slots,dest->'slot'->>'id'); collections:=array_append(collections,collection);
     SELECT * INTO dest_placement FROM public.inventory_placements WHERE slot_id=dest->'slot'->>'id' AND owner_user_id=owner_id;
     IF dest_placement.inventory_item_id IS NOT NULL THEN
       IF command->>'occupied'='cancel' THEN RAISE EXCEPTION 'inventory_destination_occupied' USING ERRCODE='40001'; END IF;
       SELECT * INTO displaced FROM public.inventory_items WHERE id=dest_placement.inventory_item_id AND owner_user_id=owner_id FOR UPDATE;
       items:=array_append(items,displaced.id);
     ELSIF command->>'occupied'='swap' THEN RAISE EXCEPTION 'inventory_destination_empty' USING ERRCODE='40001'; END IF;
     PERFORM public.inventory_match_v1(chosen.identity,(SELECT target FROM public.binder_slots WHERE id=dest->'slot'->>'id' AND owner_user_id=owner_id));
     IF command->>'occupied'='swap' THEN
       PERFORM public.inventory_match_v1(displaced.identity,(SELECT target FROM public.binder_slots WHERE id=placement.slot_id AND owner_user_id=owner_id));
     END IF;
     want:=command->'fulfillWant';
     IF want<>'null' THEN
       -- The exact locked destination slot/version and bounded index identify
       -- one entry even among duplicates. Compare the complete declared public
       -- projection; never search for another match or demand hidden JSON.
       IF want ? 'expectedPublic' THEN
         IF NOT public.inventory_object_v1(want,ARRAY['index','expectedPublic'])
           OR NOT public.inventory_revision_v1(want->'index') OR (want->>'index')::numeric>=100
           OR jsonb_typeof(want->'expectedPublic') IS DISTINCT FROM 'object'
           OR want->'expectedPublic' ?| ARRAY['wanted_by','card_image'] THEN
           RAISE EXCEPTION 'invalid_inventory_want' USING ERRCODE='22023';
         END IF;
         idx:=(want->>'index')::integer;
         SELECT wanted_cards INTO wants FROM public.binder_slots
           WHERE id=dest->'slot'->>'id' AND owner_user_id=owner_id;
         IF wants->idx IS NULL OR (wants->idx)-ARRAY['wanted_by','card_image'] IS DISTINCT FROM want->'expectedPublic' THEN
           RAISE EXCEPTION 'inventory_want_conflict' USING ERRCODE='40001';
         END IF;
         want:=jsonb_build_object('index',idx,'expected',wants->idx);
       END IF;
       IF NOT public.inventory_object_v1(want,ARRAY['index','expected']) OR NOT public.inventory_revision_v1(want->'index')
         OR (want->>'index')::numeric>=100 OR NOT public.valid_slot_wants_v1(jsonb_build_array(want->'expected')) THEN RAISE EXCEPTION 'invalid_inventory_want' USING ERRCODE='22023'; END IF;
       idx:=(want->>'index')::integer;
       SELECT wanted_cards INTO wants FROM public.binder_slots WHERE id=dest->'slot'->>'id' AND owner_user_id=owner_id;
       IF wants->idx IS DISTINCT FROM want->'expected' THEN RAISE EXCEPTION 'inventory_want_conflict' USING ERRCODE='40001'; END IF;
       identity_value:=jsonb_build_object('kind','card','cardId',want->'expected'->'card_id');
       IF want->'expected' ? 'card_language' THEN identity_value:=identity_value||jsonb_build_object('language',want->'expected'->'card_language'); END IF;
       IF want->'expected' ? 'card_finish' THEN identity_value:=identity_value||jsonb_build_object('finish',want->'expected'->'card_finish'); END IF;
       PERFORM public.inventory_match_v1(chosen.identity,identity_value);
     END IF;
     selected_ids:=array_append(selected_ids,chosen.id);
   END IF;
   -- Every source/placed edit/removal requires an explicit current collection token.
   IF EXISTS(SELECT 1 FROM unnest(collections) c WHERE NOT c=ANY(declared_collections)) THEN RAISE EXCEPTION 'inventory_access_denied' USING ERRCODE='42501'; END IF;
   IF cardinality(slots)<>(SELECT count(DISTINCT s) FROM unnest(slots) s) OR slots&&all_slots OR items&&all_items
     OR cardinality(items)<>(SELECT count(DISTINCT i) FROM unnest(items) i) THEN RAISE EXCEPTION 'invalid_inventory_repeated_entity' USING ERRCODE='22023'; END IF;
   affected:=affected+greatest(1,cardinality(slots))+cardinality(items);
   IF affected>(CASE WHEN whole_collection_delete THEN 8192 ELSE 256 END) THEN RAISE EXCEPTION 'inventory_batch_too_large' USING ERRCODE='22023'; END IF;
   all_slots:=all_slots||slots; all_items:=all_items||items; all_collections:=all_collections||collections;
   before_value:=public.inventory_evidence_v1(owner_id,items,slots,collections);
   IF kind='deleteCollection' THEN before_value:=before_value||jsonb_build_object('deletionDependencies',
     collection_audit_private.deletion_dependencies_v1((command->>'collectionId')::uuid)); END IF;

   IF kind='insertAssign' THEN
     -- All validation/evidence precedes writes. Existing row capture supplies exact inverse order.
     insert_order:=coalesce(insert_order[1:insert_index-1],'{}')||ARRAY[command->>'slotId']||coalesce(insert_order[insert_index:cardinality(insert_order)],'{}');
     UPDATE public.binder_slots s SET position=o.ordinality-1 FROM unnest(insert_order) WITH ORDINALITY o(id,ordinality)
       WHERE s.id=o.id AND s.collection_id=collection AND s.owner_user_id=owner_id AND s.position<>o.ordinality-1;
     INSERT INTO public.binder_slots(id,owner_user_id,collection_id,position,target,status,version)
       VALUES(command->>'slotId',owner_id,collection,insert_index-1,nullif(command->'target','null'),CASE WHEN chosen.id IS NULL THEN NULL ELSE 'collected' END,CASE WHEN chosen.id IS NULL THEN 0 ELSE 1 END);
     IF chosen.id IS NOT NULL THEN
       IF chosen.id=ANY(acquired_ids) THEN
         INSERT INTO public.inventory_items(id,owner_user_id,identity,grading,acquired_at) VALUES(chosen.id,owner_id,chosen.identity,chosen.grading,chosen.acquired_at);
       END IF;
       INSERT INTO public.inventory_placements(inventory_item_id,owner_user_id,collection_id,slot_id,version)
         VALUES(chosen.id,owner_id,collection,command->>'slotId',0);
     END IF;
     structural_collections:=structural_collections||collections;
   END IF;
   IF kind='add' OR (kind='assign' AND chosen.id=ANY(acquired_ids)) THEN
     INSERT INTO public.inventory_items(id,owner_user_id,identity,grading,acquired_at) VALUES(chosen.id,owner_id,chosen.identity,chosen.grading,chosen.acquired_at);
   END IF;
   IF kind='edit' AND effective THEN
     UPDATE public.inventory_items SET grading=nullif(command->'grading','null'),version=version+1,updated_at=now() WHERE id=chosen.id AND owner_user_id=owner_id;
   ELSIF kind IN ('unassign','removeOwned','move','assign') THEN
     DELETE FROM public.inventory_placements WHERE owner_user_id=owner_id AND inventory_item_id=ANY(items);
     UPDATE public.binder_slots SET status=NULL,version=version+1,updated_at=now() WHERE owner_user_id=owner_id AND id=ANY(slots);
     IF kind IN ('move','assign') THEN
       INSERT INTO public.inventory_placements(inventory_item_id,owner_user_id,collection_id,slot_id,version)
       VALUES(chosen.id,owner_id,(dest->>'collectionId')::uuid,dest->'slot'->>'id',CASE WHEN kind='move' THEN placement.version+1 ELSE 0 END);
       UPDATE public.binder_slots SET status='collected',wanted_cards=CASE WHEN command->'fulfillWant'='null' THEN wanted_cards ELSE wanted_cards-(command->'fulfillWant'->>'index')::integer END
       WHERE id=dest->'slot'->>'id' AND owner_user_id=owner_id;
       IF command->>'occupied'='swap' THEN
         INSERT INTO public.inventory_placements(inventory_item_id,owner_user_id,collection_id,slot_id,version)
         VALUES(displaced.id,owner_id,placement.collection_id,placement.slot_id,dest_placement.version+1);
         UPDATE public.binder_slots SET status='collected' WHERE id=placement.slot_id AND owner_user_id=owner_id;
       END IF;
     ELSIF kind='removeOwned' THEN
       -- Future persisted non-owning references must compose their clearing here (#377/#394).
       DELETE FROM public.inventory_items WHERE id=chosen.id AND owner_user_id=owner_id;
     END IF;
   ELSIF kind='removeSlots' THEN
     DELETE FROM public.binder_slots WHERE owner_user_id=owner_id AND id=ANY(slots);
     structural_collections:=structural_collections||collections;
   ELSIF kind='deleteCollection' THEN
     -- Parent deletion releases slots/placements, never inventory. Frozen legacy rows cascade too.
     DELETE FROM public.binders WHERE id=(command->>'collectionId')::uuid AND owner_user_id=owner_id;
     IF command->'replacementDefaultCollectionId'<>'null' THEN
       UPDATE public.binders SET is_default=true WHERE id=(command->>'replacementDefaultCollectionId')::uuid AND owner_user_id=owner_id;
     END IF;
   END IF;
   IF effective THEN changed:=true; changed_collections:=changed_collections||collections; END IF;
   evidence:=array_append(evidence,jsonb_build_object('kind',kind,'before',before_value,'after',public.inventory_evidence_v1(owner_id,items,slots,collections)));
 END LOOP;
 IF saved_before IS NOT NULL AND public.billing_enforced() AND NOT public.billing_has_paid(owner_id) AND public.slot_saved_count_v1(owner_id)>saved_before THEN
   SELECT free_card_limit INTO allowed FROM public.billing_configuration WHERE id;
   IF public.slot_saved_count_v1(owner_id)>coalesce(allowed,10) THEN RAISE EXCEPTION 'card_limit_reached'; END IF;
 END IF;
 IF changed THEN
   UPDATE public.inventory_owner_state SET inventory_revision=inventory_revision+1 WHERE owner_user_id=owner_id RETURNING inventory_revision INTO revision;
   UPDATE public.storage_collection_state SET version=version+1,layout_revision=layout_revision+CASE WHEN collection_id=ANY(structural_collections) THEN 1 ELSE 0 END
   WHERE owner_user_id=owner_id AND collection_id=ANY(changed_collections);
 END IF;
 context:=jsonb_build_object('actor',jsonb_build_object('kind','user','userId',actor),'source',trusted_intent->'source','clientId',trusted_intent->'clientId',
   'operationId',request->'operationId','batchId',trusted_intent->'batchId','clientOccurredAt',trusted_intent->'clientOccurredAt',
   'affectedEntities',jsonb_build_object('inventoryItemIds',(SELECT coalesce(jsonb_agg(DISTINCT i ORDER BY i),'[]') FROM unnest(all_items) i),
     'slotIds',(SELECT coalesce(jsonb_agg(DISTINCT s ORDER BY s),'[]') FROM unnest(all_slots) s),
     'collectionIds',(SELECT coalesce(jsonb_agg(DISTINCT c ORDER BY c),'[]') FROM unnest(all_collections) c)));
 -- #394 inserts its actual recorder here before returning/ledger commit. It must abort on failure.
 -- #396 checks after-state plus owner revision before applying any inverse. No recovery grant here.
 result:=jsonb_build_object('inventoryRevision',revision,'changed',changed,'selectedItemIds',selected_ids,'acquiredItemIds',acquired_ids,
   'context',context,'evidence',to_jsonb(evidence),'after',public.inventory_evidence_v1(owner_id,all_items,all_slots,all_collections));
 IF octet_length(result::text)>(CASE WHEN whole_collection_delete THEN 16777216 ELSE 1048576 END) THEN RAISE EXCEPTION 'inventory_result_too_large_reduce_batch' USING ERRCODE='22023'; END IF;
 PERFORM collection_audit_private.command_result(owner_id,result,'inventory'||'.'||CASE WHEN jsonb_array_length(request->'commands')=1 THEN request->'commands'->0->>'kind' ELSE 'bulk' END);
 INSERT INTO public.developer_idempotency(actor_id,operation,request_key,input_digest,result,expires_at)
 VALUES(actor,'inventory_v1',request->>'operationId',digest,result,'infinity');
 RETURN result;
EXCEPTION WHEN invalid_text_representation OR invalid_datetime_format OR datetime_field_overflow OR numeric_value_out_of_range THEN
 RAISE EXCEPTION 'invalid_inventory_command' USING ERRCODE='22023';
END $function$;

CREATE OR REPLACE FUNCTION public.slot_command_v1(actor uuid, owner_id uuid, request jsonb, trusted_source jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
 SET lock_timeout TO '3s'
 SET statement_timeout TO '10s'
AS $function$
DECLARE collection uuid; state public.storage_collection_state; revision bigint; prior public.developer_idempotency;
 command jsonb; ref jsonb; key text; kind text; keys text[]; ordered text[]; previous_order text[]; moving text[]; anchor text; idx integer;
 touched text[]:='{}'; removed text[]:='{}'; changed boolean:=false; structural boolean:=false; count_work integer:=0; inserted integer:=0;
 retained_copy_versions jsonb:='[]'; saved_before bigint; allowed integer; result jsonb; digest text; context jsonb; wants jsonb; member text;
BEGIN
 -- Defense in depth for owner-only local proof. No role grant until audit/recovery integration.
 IF actor IS NULL OR owner_id IS NULL THEN RAISE EXCEPTION 'slot_access_denied' USING ERRCODE='42501'; END IF;
 IF jsonb_typeof(request) IS DISTINCT FROM 'object' OR octet_length(request::text)>262144
   OR request-ARRAY['collectionId','operationId','inventoryRevision','collectionVersion','layoutRevision','commands']<>'{}'
   OR NOT request ?& ARRAY['collectionId','operationId','inventoryRevision','collectionVersion','layoutRevision','commands']
   OR jsonb_typeof(request->'commands') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'invalid_slot_command' USING ERRCODE='22023'; END IF;
 IF jsonb_array_length(request->'commands') NOT BETWEEN 1 AND 100 OR jsonb_typeof(request->'operationId') IS DISTINCT FROM 'string' OR length(request->>'operationId') NOT BETWEEN 8 AND 100 THEN RAISE EXCEPTION 'invalid_slot_command' USING ERRCODE='22023'; END IF;
 IF jsonb_typeof(trusted_source) IS DISTINCT FROM 'object' OR trusted_source-ARRAY['source','clientId']<>'{}'
   OR NOT trusted_source ?& ARRAY['source','clientId'] OR NOT coalesce(trusted_source->>'source' IN ('app','rest','mcp','import','system','migration'),false)
   OR (trusted_source->'clientId'<>'null' AND (jsonb_typeof(trusted_source->'clientId')<>'string' OR length(trusted_source->>'clientId') NOT BETWEEN 1 AND 200)) THEN
   RAISE EXCEPTION 'invalid_trusted_context' USING ERRCODE='22023'; END IF;
 collection:=(request->>'collectionId')::uuid;
 -- Lock partnership through commit, so an unlink cannot race an accepted partner write.
 IF actor<>owner_id THEN
   PERFORM 1 FROM public.partnerships WHERE owner_user_id=owner_id AND actor IN(user1_id,user2_id) FOR KEY SHARE;
   IF NOT FOUND THEN RAISE EXCEPTION 'slot_access_denied' USING ERRCODE='42501'; END IF;
 END IF;
 IF NOT public.billing_partner_allowed(owner_id,actor) THEN RAISE EXCEPTION 'slot_access_denied' USING ERRCODE='42501'; END IF;
 -- Same owner-wide lock as legacy allowance growth. No command scans/locks other owners.
 PERFORM pg_advisory_xact_lock(hashtextextended(owner_id::text,4701));
 SELECT inventory_revision INTO revision FROM public.inventory_owner_state WHERE owner_user_id=owner_id FOR UPDATE;
 IF revision IS NULL THEN RAISE EXCEPTION 'slot_storage_unavailable' USING ERRCODE='55000'; END IF;
 PERFORM 1 FROM public.binders WHERE id=collection AND owner_user_id=owner_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'slot_access_denied' USING ERRCODE='42501'; END IF;
 SELECT * INTO state FROM public.storage_collection_state WHERE collection_id=collection AND owner_user_id=owner_id FOR UPDATE;
 IF NOT FOUND OR state.authority<>'slots' THEN RAISE EXCEPTION 'slot_storage_unavailable' USING ERRCODE='55000'; END IF;
 -- Digest is calculated by SQL, not accepted from callers. Result retained using the existing ledger.
 digest:=encode(sha256(convert_to(jsonb_build_object('owner',owner_id,'request',request,'source',trusted_source)::text,'UTF8')),'hex');
 SELECT * INTO prior FROM public.developer_idempotency WHERE actor_id=actor AND operation='binder_slots_v1' AND request_key=request->>'operationId' FOR UPDATE;
 IF FOUND THEN
   IF prior.input_digest<>digest THEN RAISE EXCEPTION 'idempotency_conflict' USING ERRCODE='40001'; END IF;
   RETURN prior.result;
 END IF;
 IF to_jsonb(revision) IS DISTINCT FROM request->'inventoryRevision' OR to_jsonb(state.version) IS DISTINCT FROM request->'collectionVersion'
   OR to_jsonb(state.layout_revision) IS DISTINCT FROM request->'layoutRevision' THEN
   RAISE EXCEPTION 'slot_revision_conflict' USING ERRCODE='40001',DETAIL=jsonb_build_object('inventoryRevision',revision,'collectionVersion',state.version,'layoutRevision',state.layout_revision)::text;
 END IF;
 -- Validate all work bounds and same-binder preconditions BEFORE mutation. Duplicate touching is
 -- rejected to avoid implicit version sequencing inside a batch; #383 composes ownership separately.
 FOR command IN SELECT jsonb_array_elements(request->'commands') LOOP
   kind:=command->>'kind';
   IF jsonb_typeof(command)<>'object' OR NOT coalesce(kind IN ('create','update','clear','remove','move'),false) THEN RAISE EXCEPTION 'invalid_slot_command' USING ERRCODE='22023'; END IF;
   IF kind='create' THEN
     IF command-ARRAY['kind','ids','beforeSlotId']<>'{}' OR NOT command ?& ARRAY['ids','beforeSlotId'] OR jsonb_typeof(command->'ids') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'invalid_slot_command' USING ERRCODE='22023'; END IF;
     keys:=ARRAY(SELECT jsonb_array_elements_text(command->'ids')); inserted:=inserted+cardinality(keys);
     IF EXISTS(SELECT 1 FROM jsonb_array_elements(command->'ids') v WHERE jsonb_typeof(v)<>'string') THEN RAISE EXCEPTION 'invalid_slot_command' USING ERRCODE='22023'; END IF;
   ELSIF kind='update' THEN
     IF command-ARRAY['kind','slot','target','wantedCards']<>'{}' OR NOT (command ? 'target' OR command ? 'wantedCards') THEN RAISE EXCEPTION 'invalid_slot_command' USING ERRCODE='22023'; END IF;
     PERFORM public.slot_check_ref_v1(owner_id,collection,command->'slot'); keys:=ARRAY[command->'slot'->>'id'];
   ELSE
     IF command-(CASE WHEN kind='move' THEN ARRAY['kind','slots','beforeSlotId'] ELSE ARRAY['kind','slots'] END)<>'{}'
       OR jsonb_typeof(command->'slots') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'invalid_slot_command' USING ERRCODE='22023'; END IF;
     IF jsonb_array_length(command->'slots') NOT BETWEEN 1 AND 256 THEN RAISE EXCEPTION 'invalid_slot_command' USING ERRCODE='22023'; END IF;
     keys:='{}';
     FOR ref IN SELECT jsonb_array_elements(command->'slots') LOOP
       PERFORM public.slot_check_ref_v1(owner_id,collection,ref); keys:=array_append(keys,ref->>'id');
     END LOOP;
   END IF;
   count_work:=count_work+cardinality(keys);
   IF cardinality(keys)=0 OR count_work>256 OR inserted>256 THEN RAISE EXCEPTION 'invalid_slot_command' USING ERRCODE='22023'; END IF;
   FOREACH key IN ARRAY keys LOOP
     IF key IS NULL OR length(key) NOT BETWEEN 1 AND 200 OR key<>btrim(key) OR key=ANY(touched) THEN RAISE EXCEPTION 'invalid_slot_command' USING ERRCODE='22023'; END IF;
     touched:=array_append(touched,key);
   END LOOP;
 END LOOP;
 IF (SELECT count(*) FROM public.binder_slots WHERE collection_id=collection)+inserted>4096 THEN RAISE EXCEPTION 'slot_capacity_exceeded' USING ERRCODE='22023'; END IF;
 -- The free-card count only matters when the limit applies.
 IF public.billing_enforced() AND NOT public.billing_has_paid(owner_id) THEN saved_before:=public.slot_saved_count_v1(owner_id); END IF;
 SELECT coalesce(array_agg(id ORDER BY position,id),'{}') INTO ordered FROM public.binder_slots WHERE collection_id=collection AND owner_user_id=owner_id;
 FOR command IN SELECT jsonb_array_elements(request->'commands') LOOP
   kind:=command->>'kind';
   IF kind IN ('create','move') THEN
     IF NOT command ? 'beforeSlotId' OR (command->'beforeSlotId'<>'null' AND jsonb_typeof(command->'beforeSlotId')<>'string') THEN RAISE EXCEPTION 'invalid_slot_command' USING ERRCODE='22023'; END IF;
     anchor:=command->>'beforeSlotId'; previous_order:=ordered;
     IF kind='create' THEN
       moving:=ARRAY(SELECT jsonb_array_elements_text(command->'ids'));
       FOREACH key IN ARRAY moving LOOP
         INSERT INTO public.binder_slots(id,owner_user_id,collection_id,position) VALUES(key,owner_id,collection,cardinality(ordered));
       END LOOP;
     ELSE
       keys:=ARRAY(SELECT v->>'id' FROM jsonb_array_elements(command->'slots') v);
       moving:=ARRAY(SELECT k FROM unnest(ordered) k WHERE k=ANY(keys));
       ordered:=ARRAY(SELECT k FROM unnest(ordered) k WHERE NOT k=ANY(keys));
     END IF;
     idx:=CASE WHEN anchor IS NULL THEN cardinality(ordered)+1 ELSE array_position(ordered,anchor) END;
     IF idx IS NULL THEN RAISE EXCEPTION 'invalid_slot_anchor' USING ERRCODE='22023'; END IF;
     ordered:=coalesce(ordered[1:idx-1],'{}')||moving||coalesce(ordered[idx:cardinality(ordered)],'{}');
     IF ordered IS DISTINCT FROM previous_order THEN structural:=true; changed:=true; END IF;
   ELSIF kind='update' THEN
     key:=command->'slot'->>'id';
     IF command ? 'target' THEN
       PERFORM public.slot_check_target_v1(owner_id,key,command->'target');
     END IF;
     IF command ? 'wantedCards' THEN
       wants:=command->'wantedCards';
       IF NOT public.valid_slot_wants_v1(wants) OR jsonb_array_length(wants)>100 THEN RAISE EXCEPTION 'invalid_slot_wants' USING ERRCODE='22023'; END IF;
       FOR member IN SELECT DISTINCT v #>> '{}' FROM jsonb_array_elements(wants) w CROSS JOIN LATERAL jsonb_array_elements(coalesce(w->'wanted_by','[]')) v LOOP
         IF NOT public.billing_partner_allowed(owner_id,member::uuid) THEN RAISE EXCEPTION 'invalid_wanted_assignment' USING ERRCODE='22023'; END IF;
       END LOOP;
     END IF;
     UPDATE public.binder_slots SET target=CASE WHEN command ? 'target' THEN nullif(command->'target','null') ELSE target END,
       wanted_cards=CASE WHEN command ? 'wantedCards' THEN wants ELSE wanted_cards END,version=version+1,updated_at=clock_timestamp()
       WHERE id=key AND owner_user_id=owner_id AND collection_id=collection
       AND ((command ? 'target' AND target IS DISTINCT FROM nullif(command->'target','null'))
         OR (command ? 'wantedCards' AND wanted_cards IS DISTINCT FROM wants));
     changed:=changed OR FOUND;
   ELSE
     FOR ref IN SELECT jsonb_array_elements(command->'slots') LOOP
       key:=ref->>'id';
       IF kind='clear' THEN
         DELETE FROM public.inventory_placements WHERE slot_id=key AND owner_user_id=owner_id;
         IF FOUND THEN
           UPDATE public.binder_slots SET status=NULL,version=version+1,updated_at=clock_timestamp() WHERE id=key AND owner_user_id=owner_id;
           changed:=true;
         END IF;
       ELSE
         IF ref->'inventoryItemId'<>'null' THEN
           retained_copy_versions:=retained_copy_versions||jsonb_build_array(jsonb_build_object('id',ref->'inventoryItemId','version',ref->'itemVersion'));
         END IF;
         -- Placement FK cascade unassigns; inventory item is never deleted.
         DELETE FROM public.binder_slots WHERE id=key AND owner_user_id=owner_id AND collection_id=collection;
         ordered:=array_remove(ordered,key); removed:=array_append(removed,key); structural:=true; changed:=true;
       END IF;
     END LOOP;
   END IF;
 END LOOP;
 IF structural THEN
   UPDATE public.binder_slots s SET position=o.position-1 FROM unnest(ordered) WITH ORDINALITY o(id,position)
   WHERE s.id=o.id AND s.collection_id=collection AND s.owner_user_id=owner_id AND s.position<>o.position-1;
 END IF;
 IF saved_before IS NOT NULL AND public.billing_enforced() AND NOT public.billing_has_paid(owner_id) AND public.slot_saved_count_v1(owner_id)>saved_before THEN
   SELECT free_card_limit INTO allowed FROM public.billing_configuration WHERE id;
   IF public.slot_saved_count_v1(owner_id)>coalesce(allowed,10) THEN RAISE EXCEPTION 'card_limit_reached'; END IF;
 END IF;
 IF changed THEN
   UPDATE public.inventory_owner_state SET inventory_revision=inventory_revision+1 WHERE owner_user_id=owner_id RETURNING inventory_revision INTO revision;
   UPDATE public.storage_collection_state SET version=version+1,layout_revision=layout_revision+CASE WHEN structural THEN 1 ELSE 0 END
   WHERE collection_id=collection AND owner_user_id=owner_id RETURNING * INTO state;
 END IF;
 -- Deliberately no history insert or push/acquisition call. #394 must record these compact
 -- affected IDs and before/after deltas IN THIS transaction before any executor grant.
 context:=jsonb_build_object('actor',jsonb_build_object('kind','user','userId',actor),'source',trusted_source->'source','clientId',trusted_source->'clientId',
   'operationId',request->'operationId','batchId',CASE WHEN jsonb_array_length(request->'commands')>1 THEN request->'operationId' ELSE 'null'::jsonb END,
   'clientOccurredAt',NULL,'affectedEntities',jsonb_build_object('slotIds',touched,'collectionIds',jsonb_build_array(collection),
     'inventoryItemIds',(SELECT coalesce(jsonb_agg(DISTINCT v->>'inventoryItemId'),'[]') FROM (
       SELECT c->'slot' v FROM jsonb_array_elements(request->'commands') c WHERE c->>'kind'='update'
       UNION ALL SELECT r FROM jsonb_array_elements(request->'commands') c CROSS JOIN LATERAL jsonb_array_elements(coalesce(c->'slots','[]')) r) refs
       WHERE v->>'inventoryItemId' IS NOT NULL)));
 result:=jsonb_build_object('inventoryRevision',revision,'collectionVersion',state.version,'layoutRevision',state.layout_revision,'removedSlotIds',removed,
   'evidence',jsonb_build_array(jsonb_build_object('before',jsonb_build_object('items',retained_copy_versions))),
   'acquisition',false,'changed',changed,'context',context,'slots',(SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY position,id),'[]') FROM public.binder_slots s WHERE s.collection_id=collection AND s.owner_user_id=owner_id AND s.id=ANY(touched)));
 IF octet_length(result::text)>1048576 THEN RAISE EXCEPTION 'slot_result_too_large_reduce_batch' USING ERRCODE='22023'; END IF;
 PERFORM collection_audit_private.command_result(owner_id,result,'slots'||'.'||CASE WHEN jsonb_array_length(request->'commands')=1 THEN request->'commands'->0->>'kind' ELSE 'bulk' END);
 INSERT INTO public.developer_idempotency(actor_id,operation,request_key,input_digest,result,expires_at)
 VALUES(actor,'binder_slots_v1',request->>'operationId',digest,result,'infinity');
 RETURN result;
END $function$;

CREATE OR REPLACE FUNCTION collection_audit_private.recovery_plan_v1(actor uuid, owner_id uuid, event_id bigint, unassigned text[])
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
 SET "TimeZone" TO 'UTC'
AS $function$
DECLARE native_creation_proof jsonb; original public.collection_activity; d jsonb; row_value jsonb; b jsonb; a jsonb; key text; tbl text; col text;
 layout_collections text[]; inverse_rows jsonb[]:='{}'; inverse jsonb:='[]'; conflicts jsonb:='[]'; unsupported jsonb:='[]'; canonical_rows jsonb[]:='{}'; frozen jsonb; frozen_rows jsonb; source_evidence jsonb; copied_wants bigint; inverse_positions jsonb; inverse_slot_ids text[]; cascade_proof jsonb; provenance public.storage_collection_state; deps jsonb; root jsonb; member text;
 current_rows jsonb; restored_item_ids text[]; vacated_slot_ids text[];
 item_keys text[]; slot_keys text[]; placement_keys text[]; state_keys text[]; binder_keys text[];
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
 -- canonical_recovery_timestamps: preserve every original persisted event.
 FOR d IN SELECT jsonb_array_elements(original.recovery_state) LOOP
   col:=CASE d->>'table' WHEN 'inventory_items' THEN 'acquired_at' WHEN 'storage_collection_state' THEN 'converted_at' END;
   IF col IS NOT NULL THEN
     FOREACH key IN ARRAY ARRAY['before','after'] LOOP
       IF d->key->>col IS NOT NULL THEN
         d:=jsonb_set(d,ARRAY[key,col],to_jsonb((d->key->>col)::timestamptz));
       END IF;
     END LOOP;
   END IF;
   canonical_rows:=array_append(canonical_rows,d);
 END LOOP;
 original.recovery_state:=to_jsonb(canonical_rows);
 -- native_creation_proof admits only complete genuine creation events.
 native_creation_proof:=jsonb_build_object('eligible',false);
 IF original.action='collection.create' THEN
   native_creation_proof:=collection_audit_private.creation_recovery_proof_v1(owner_id,event_id);
 END IF;
 IF original.action='collection.create' AND NOT (native_creation_proof->>'eligible')::boolean THEN
   unsupported:=unsupported||jsonb_build_array('missing_native_creation_evidence');
 END IF;
 IF (native_creation_proof->>'eligible')::boolean THEN conflicts:=conflicts||(native_creation_proof->'conflicts'); END IF;
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
   IF tbl NOT IN ('inventory_owner_state','storage_collection_state','inventory_items','binder_slots','inventory_placements','binders','pokemon_collection','binder_legacy_rows') THEN
     unsupported:=unsupported||jsonb_build_array('unsupported_table:'||tbl); CONTINUE;
   END IF;
   IF tbl IN ('binders','storage_collection_state') AND b IS NULL AND NOT (native_creation_proof->>'eligible')::boolean THEN
     unsupported:=unsupported||jsonb_build_array('collection_creation_inverse');
   END IF;
   IF tbl='inventory_owner_state' THEN
     IF (a IS NULL OR b IS NULL) AND NOT (native_creation_proof->>'eligible')::boolean THEN unsupported:=unsupported||jsonb_build_array('owner_authority_transition'); END IF;
     CONTINUE;
   END IF;
   IF coalesce(b->>'owner_user_id',owner_id::text)<>owner_id::text OR coalesce(a->>'owner_user_id',owner_id::text)<>owner_id::text THEN
     unsupported:=unsupported||jsonb_build_array('owner_transfer'); CONTINUE;
   END IF;
   IF tbl='storage_collection_state' THEN
     IF coalesce(b->>'authority',a->>'authority')<>'slots' OR (b IS NOT NULL AND a IS NOT NULL
       AND b-ARRAY['version','layout_revision'] IS DISTINCT FROM a-ARRAY['version','layout_revision'])
       THEN
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
   inverse_rows:=array_append(inverse_rows,d);
 END LOOP;
 inverse:=to_jsonb(inverse_rows);
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
 SELECT coalesce(array_agg(DISTINCT id),'{}') INTO collection_ids FROM (
   SELECT unnest(collection_ids) id UNION
   SELECT m.collection_id FROM public.binder_legacy_rows m WHERE m.owner_user_id=owner_id AND m.legacy_row_id::text=ANY(item_ids)
   UNION SELECT c.binder_id FROM public.pokemon_collection c JOIN public.storage_collection_state s ON s.collection_id=c.binder_id
     WHERE c.user_id=owner_id AND c.id::text=ANY(item_ids) AND s.conversion_receipt IS NOT NULL
 ) origins;
 -- Include current item/placement dependencies of changed slots, and both historical ends of moves.
 SELECT coalesce(array_agg(DISTINCT v),'{}') INTO item_ids FROM (
   SELECT unnest(item_ids) v UNION SELECT inventory_item_id FROM public.inventory_placements WHERE owner_user_id=owner_id AND slot_id=ANY(slot_ids)) ids;
 SELECT coalesce(array_agg(DISTINCT v),'{}') INTO slot_ids FROM (
   SELECT unnest(slot_ids) v UNION SELECT slot_id FROM public.inventory_placements WHERE owner_user_id=owner_id AND inventory_item_id=ANY(item_ids)) ids;
 SELECT coalesce(array_agg(DISTINCT v),'{}') INTO collection_ids FROM (
   SELECT unnest(collection_ids) v UNION SELECT collection_id FROM public.binder_slots WHERE owner_user_id=owner_id AND id=ANY(slot_ids)) ids;
 SELECT coalesce(array_agg(e->>'id'),'{}') INTO layout_collections
 FROM jsonb_array_elements(inverse) e WHERE e->>'table'='storage_collection_state'
   AND (e->'after'='null' OR e->'before'->'layout_revision' IS DISTINCT FROM e->'after'->'layout_revision');
 -- Check every occupied old position once, without a per-slot full inverse scan.
 SELECT coalesce(array_agg(e->>'id'),'{}') INTO inverse_slot_ids FROM jsonb_array_elements(inverse) e WHERE e->>'table'='binder_slots';
 SELECT coalesce(jsonb_object_agg((e->'before'->>'collection_id')||'/'||(e->'before'->>'position'),e->'id'),'{}') INTO inverse_positions
 FROM jsonb_array_elements(inverse) e WHERE e->>'table'='binder_slots' AND e->'before'<>'null';
 SELECT conflicts||coalesce(jsonb_agg(jsonb_build_object('entity','binder_slots/'||(inverse_positions->>(s.collection_id::text||'/'||s.position::text)),
   'reason','previous_position_occupied')),'[]') INTO conflicts
 FROM public.binder_slots s WHERE s.owner_user_id=owner_id AND s.collection_id=ANY(collection_ids)
   AND inverse_positions ? (s.collection_id::text||'/'||s.position::text)
   AND s.id IS DISTINCT FROM inverse_positions->>(s.collection_id::text||'/'||s.position::text) AND NOT s.id=ANY(inverse_slot_ids);
 -- Current values/absence must match the recorded final state. Root counters are advanced from
 -- NOW, never restored backwards; unrelated subsequent content changes may coexist.
 -- Native rows are read once per table (same STABLE snapshot as a per-entry read), keyed like the loop.
 SELECT coalesce(array_agg(e->>'id') FILTER(WHERE e->>'table'='inventory_items'),'{}'),
   coalesce(array_agg(e->>'id') FILTER(WHERE e->>'table'='binder_slots'),'{}'),
   coalesce(array_agg(e->>'id') FILTER(WHERE e->>'table'='inventory_placements'),'{}'),
   coalesce(array_agg(e->>'id') FILTER(WHERE e->>'table'='storage_collection_state'),'{}'),
   coalesce(array_agg(e->>'id') FILTER(WHERE e->>'table'='binders'),'{}'),
   coalesce(array_agg(e->>'id') FILTER(WHERE e->>'table'='inventory_items' AND e->'before'<>'null' AND e->>'id' IS NOT NULL),'{}'),
   coalesce(array_agg(e->'after'->>'slot_id') FILTER(WHERE e->>'table'='inventory_placements' AND e->'after'->>'slot_id' IS NOT NULL),'{}')
 INTO item_keys,slot_keys,placement_keys,state_keys,binder_keys,restored_item_ids,vacated_slot_ids FROM jsonb_array_elements(inverse) e;
 SELECT coalesce(jsonb_object_agg(x.entity,x.state),'{}') INTO current_rows FROM (
   SELECT 'inventory_items/'||k entity,collection_audit_private.state('inventory_items',to_jsonb(t)) state FROM unnest(item_keys) k JOIN public.inventory_items t ON t.id=k
   UNION ALL SELECT 'binder_slots/'||k,collection_audit_private.state('binder_slots',to_jsonb(t)) FROM unnest(slot_keys) k JOIN public.binder_slots t ON t.id=k
   UNION ALL SELECT 'inventory_placements/'||k,collection_audit_private.state('inventory_placements',to_jsonb(t)) FROM unnest(placement_keys) k JOIN public.inventory_placements t ON t.inventory_item_id=k
   UNION ALL SELECT 'storage_collection_state/'||k,collection_audit_private.state('storage_collection_state',to_jsonb(t)) FROM unnest(state_keys) k JOIN public.storage_collection_state t ON t.collection_id=k::uuid
   UNION ALL SELECT 'binders/'||k,collection_audit_private.state('binders',to_jsonb(t)) FROM unnest(binder_keys) k JOIN public.binders t ON t.id=k::uuid) x;
 FOR d IN SELECT e FROM jsonb_array_elements(inverse) e LOOP
   tbl:=d->>'table'; key:=d->>'id'; b:=nullif(d->'before','null'); a:=nullif(d->'after','null');
   col:=CASE tbl WHEN 'inventory_placements' THEN 'inventory_item_id' WHEN 'storage_collection_state' THEN 'collection_id' WHEN 'binder_legacy_rows' THEN 'legacy_row_id' ELSE 'id' END;
   IF tbl IN ('pokemon_collection','binder_legacy_rows') THEN
     EXECUTE format('SELECT collection_audit_private.state(%L,to_jsonb(t)) FROM public.%I t WHERE %I=$1%s',tbl,tbl,col,CASE WHEN tbl IN ('binders','storage_collection_state','pokemon_collection','binder_legacy_rows') THEN '::uuid' ELSE '' END) INTO row_value USING key;
   ELSE row_value:=current_rows->(tbl||'/'||key); END IF;
   IF tbl='storage_collection_state' AND a IS NOT NULL THEN
     IF row_value-ARRAY['version','layout_revision'] IS DISTINCT FROM a-ARRAY['version','layout_revision']
       OR (b IS NOT NULL AND b->'layout_revision' IS DISTINCT FROM a->'layout_revision' AND row_value->'layout_revision' IS DISTINCT FROM a->'layout_revision') THEN
       conflicts:=conflicts||jsonb_build_array(jsonb_build_object('entity',tbl||'/'||key,'reason','layout_or_authority_changed'));
     END IF;
   ELSIF row_value IS DISTINCT FROM a THEN
     conflicts:=conflicts||jsonb_build_array(jsonb_build_object('entity',tbl||'/'||key,'reason','entity_changed_or_identity_occupied'));
   END IF;
   -- Cheap guards first: PL/pgSQL runs a condition with a subquery as a query on every entry.
   IF tbl='inventory_placements' AND b IS NOT NULL THEN
     IF NOT EXISTS(SELECT 1 FROM public.inventory_items WHERE id=key AND owner_user_id=owner_id)
       AND NOT coalesce(key=ANY(restored_item_ids),false) THEN
       conflicts:=conflicts||jsonb_build_array(jsonb_build_object('entity','inventory_items/'||key,'reason','original_copy_missing'));
     END IF;
   END IF;
   IF tbl='binders' THEN
     IF tbl='binders' AND b IS NOT NULL AND a IS NULL AND EXISTS(SELECT 1 FROM public.binders t
       WHERE t.owner_user_id=owner_id AND t.id::text<>key AND lower(btrim(t.name))=lower(btrim(b->>'name'))) THEN
       conflicts:=conflicts||jsonb_build_array(jsonb_build_object('entity',tbl||'/'||key,'reason','collection_name_occupied'));
     END IF;
     IF tbl='binders' AND b IS NOT NULL AND b->'is_default'='true' AND EXISTS(
       SELECT 1 FROM public.binders t WHERE t.owner_user_id=owner_id AND t.is_default AND t.id::text<>key AND NOT EXISTS(
         SELECT 1 FROM jsonb_array_elements(inverse) e WHERE e->>'table'='binders' AND e->>'id'=t.id::text AND e->'before'->'is_default'='false')) THEN
       conflicts:=conflicts||jsonb_build_array(jsonb_build_object('entity',tbl||'/'||key,'reason','current_default_conflict'));
     END IF;
   END IF;
   IF tbl='inventory_placements' AND b IS NOT NULL THEN
     IF EXISTS(SELECT 1 FROM public.inventory_placements WHERE slot_id=b->>'slot_id' AND inventory_item_id<>key) THEN
       -- A swap's two current occupants are intentionally removed together by the same inverse.
       IF NOT coalesce(b->>'slot_id'=ANY(vacated_slot_ids),false) THEN
         conflicts:=conflicts||jsonb_build_array(jsonb_build_object('entity','binder_slots/'||(b->>'slot_id'),'reason','previous_slot_occupied'));
       END IF;
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
   IF tbl='binder_slots' AND (a IS NULL OR b IS NULL OR a->'position' IS DISTINCT FROM b->'position') AND NOT coalesce((coalesce(a,b)->>'collection_id')=ANY(layout_collections),false) THEN
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
 -- converted_cascade_dependencies: full receipt and authoritative frozen source, whole event only.
 cascade_proof:=collection_audit_private.converted_dependencies_v1(owner_id,event_id,inverse,collection_ids);
 frozen:=cascade_proof->'frozen'; conflicts:=conflicts||(cascade_proof->'conflicts'); unsupported:=unsupported||(cascade_proof->'unsupported');
 FOR d IN SELECT e FROM jsonb_array_elements(inverse) e WHERE e->>'table'='inventory_items' LOOP
   b:=nullif(d->'before','null'); a:=nullif(d->'after','null');
   IF b IS NOT NULL AND a IS NOT NULL AND b->'legacy_source' IS DISTINCT FROM a->'legacy_source' THEN
     unsupported:=unsupported||jsonb_build_array('item_provenance_transition');
   END IF;
   IF coalesce(b->'legacy_source',a->'legacy_source','null')<>'null' AND NOT EXISTS(
     SELECT 1 FROM public.pokemon_collection c JOIN public.storage_collection_state s ON s.collection_id=c.binder_id
     WHERE c.user_id=owner_id AND c.id::text=d->>'id' AND s.authority='slots' AND s.conversion_receipt IS NOT NULL
       AND to_jsonb(c)=coalesce(nullif(b->'legacy_source','null'),a->'legacy_source')) THEN
     conflicts:=conflicts||jsonb_build_array(jsonb_build_object('entity','inventory_items/'||(d->>'id'),'reason','conversion_source_changed'));
   END IF;
 END LOOP;
 -- Root config/source ABA must conflict even if the current value matches again.
 SELECT conflicts||coalesce(jsonb_agg(DISTINCT jsonb_build_object('entity',(e->>'table')||'/'||(e->>'id'),'reason','later_conversion_dependency_change')),'[]') INTO conflicts
 FROM public.collection_activity h CROSS JOIN LATERAL jsonb_array_elements(h.recovery_state) e
 WHERE h.owner_user_id=owner_id AND h.id>event_id AND h.format_version=1 AND frozen<>'[]' AND (
   (e->>'table'='storage_collection_state' AND EXISTS(SELECT 1 FROM jsonb_array_elements(frozen) f WHERE f->>'collectionId'=e->>'id')
     AND nullif(e->'before','null')-ARRAY['version','layout_revision'] IS DISTINCT FROM nullif(e->'after','null')-ARRAY['version','layout_revision'])
   OR (e->>'table' IN ('binder_legacy_rows','pokemon_collection')
     AND coalesce(e->'before'->>'collection_id',e->'after'->>'collection_id',e->'before'->>'binder_id',e->'after'->>'binder_id')=ANY(collection_ids::text[])));
 -- Layout/collection metadata is included in the reviewed token even for a content-only inverse.
 -- All dependency material stays private. The public wrapper emits only a hash and redaction.
 deps:=public.inventory_evidence_v1(owner_id,item_ids,slot_ids,collection_ids); IF frozen<>'[]' THEN deps:=deps||jsonb_build_object('convertedSources',frozen); END IF;
 IF cascade_proof->'restoreRows'<>'{}' THEN deps:=deps||jsonb_build_object('frozenRestoreRows',cascade_proof->'restoreRows'); END IF;
 IF (native_creation_proof->>'eligible')::boolean THEN deps:=deps||jsonb_build_object('nativeCreation',native_creation_proof->'dependencies'); END IF;
 SELECT collection_audit_private.state('inventory_owner_state',to_jsonb(s)) INTO root FROM public.inventory_owner_state s WHERE owner_user_id=owner_id;
 IF root IS NULL THEN unsupported:=unsupported||jsonb_build_array('inventory_storage_unavailable'); END IF;
 FOR choice IN SELECT c FROM unnest(collection_ids) c WHERE NOT EXISTS(SELECT 1 FROM public.storage_collection_state WHERE collection_id=c AND owner_user_id=owner_id AND authority='slots') LOOP
   IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(inverse) e WHERE e->>'table'='storage_collection_state' AND e->>'id'=choice AND e->'after'='null' AND e->'before'->>'authority'='slots') THEN
     conflicts:=conflicts||jsonb_build_array(jsonb_build_object('entity','storage_collection_state/'||choice,'reason','collection_unavailable'));
   END IF;
 END LOOP;
 RETURN jsonb_build_object('supported',jsonb_array_length(unsupported)=0,'unsupported',unsupported,'conflicts',conflicts,
   'inverse',inverse,'dependencies',deps,'root',root,'collectionIds',collection_ids);
END $function$;

COMMIT;
