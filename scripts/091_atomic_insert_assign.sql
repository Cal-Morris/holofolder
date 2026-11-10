-- Staged atomic insertion plus explicit ownership. Apply AFTER 090, twice locally first.
-- Parent owns hosted backup/application. No admission, grants, conversion or new ledger.
BEGIN;
SET LOCAL lock_timeout='3s';

-- Prepare an explicit acquisition only; no writes, implicit copy/grade selection or receipts.
CREATE OR REPLACE FUNCTION collection_audit_private.insert_item_v1(owner_id uuid,selection jsonb)
RETURNS public.inventory_items LANGUAGE plpgsql SET search_path='' AS $$
DECLARE item public.inventory_items; card public.tcg_cards;
BEGIN
 IF NOT public.inventory_object_v1(selection,ARRAY['kind','itemId','identity','grading','acquiredAt'])
   OR selection->>'kind'<>'new' OR NOT public.inventory_id_v1(selection->'itemId')
   OR NOT public.valid_inventory_identity_v1(selection->'identity')
   OR NOT public.valid_grading_record_v1(nullif(selection->'grading','null'))
   OR (selection->'grading'<>'null' AND selection->'identity'->>'kind'<>'card')
   OR (selection->'acquiredAt'<>'null' AND jsonb_typeof(selection->'acquiredAt')<>'string') THEN
   RAISE EXCEPTION 'invalid_inventory_command' USING ERRCODE='22023';
 END IF;
 item.id:=selection->>'itemId'; item.owner_user_id:=owner_id; item.identity:=selection->'identity';
 item.grading:=nullif(selection->'grading','null'); item.acquired_at:=(selection->>'acquiredAt')::timestamptz; item.version:=0;
 IF item.acquired_at IS NOT NULL AND NOT isfinite(item.acquired_at) THEN RAISE EXCEPTION 'invalid_inventory_command' USING ERRCODE='22023'; END IF;
 IF item.identity->>'kind'='card' THEN
   card:=public.slot_catalog_card_v1(item.identity->>'cardId');
   IF card.id IS NULL THEN RAISE EXCEPTION 'inventory_catalog_unavailable' USING ERRCODE='22023'; END IF;
   item.identity:=jsonb_set(item.identity,'{cardId}',to_jsonb(CASE WHEN jsonb_typeof(card.external_ids_json->'catalog'->'canonicalId')='string'
     AND length(card.external_ids_json->'catalog'->>'canonicalId') BETWEEN 1 AND 200 THEN card.external_ids_json->'catalog'->>'canonicalId' ELSE card.id END));
 ELSIF (item.identity->>'pokemonId')::numeric NOT BETWEEN 1 AND 1025 THEN
   RAISE EXCEPTION 'inventory_catalog_unavailable' USING ERRCODE='22023';
 END IF;
 IF EXISTS(SELECT 1 FROM public.inventory_items WHERE id=item.id) THEN RAISE EXCEPTION 'item_conflict' USING ERRCODE='40001'; END IF;
 RETURN item;
END $$;
REVOKE ALL ON FUNCTION collection_audit_private.insert_item_v1(uuid,jsonb) FROM PUBLIC,anon,authenticated,holo_mcp,service_role;

DO $integration$
DECLARE body text; anchor text;
BEGIN
 SELECT pg_get_functiondef('public.inventory_command_v1(uuid,uuid,jsonb,jsonb)'::regprocedure) INTO body;
 IF position('-- private_preserving_intent_090' IN body)=0
   OR position('collection_audit_private.command_result' IN body)=0
   OR to_regprocedure('collection_audit_private.execute_command_v1(text,uuid,uuid,jsonb,jsonb)') IS NULL THEN
   RAISE EXCEPTION 'insert_assign_requires_089_090';
 END IF;
 IF position('-- atomic_insert_assign_091' IN body)=0 THEN
   anchor:=' whole_collection_delete boolean;';
   IF position(anchor IN body)=0 THEN RAISE EXCEPTION 'insert_assign_declaration_changed'; END IF;
   body:=replace(body,anchor,anchor||chr(10)||' insert_order text[]; insert_index integer; insert_work integer:=0;');
   anchor:=$old$   IF kind='add' THEN$old$;
   IF position(anchor IN body)=0 THEN RAISE EXCEPTION 'insert_assign_validation_changed'; END IF;
   body:=replace(body,anchor,$new$   -- atomic_insert_assign_091: original request/digest stay immutable; replay already resolved.
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
   ELSIF kind='add' THEN$new$);
   anchor:=$old$   IF kind='add' OR (kind='assign' AND chosen.id=ANY(acquired_ids)) THEN$old$;
   IF position(anchor IN body)=0 THEN RAISE EXCEPTION 'insert_assign_write_changed'; END IF;
   body:=replace(body,anchor,$new$   IF kind='insertAssign' THEN
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
   IF kind='add' OR (kind='assign' AND chosen.id=ANY(acquired_ids)) THEN$new$);
   EXECUTE body;
 END IF;
END $integration$;
-- Existing 089 outer management6102/root4701 locks, terminal ledger, 090 patch semantics,
-- deferred audit bounds, recovery and gateway ACLs/10s deadline stay installed unchanged.
NOTIFY pgrst,'reload schema';
COMMIT;
