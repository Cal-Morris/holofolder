-- Staged #383 ownership commands. Apply after 074 as one transaction, locally twice first.
-- OWNER ONLY, no grants, conversion, history feed or production data changes.
BEGIN;
SET LOCAL lock_timeout='3s';

CREATE OR REPLACE FUNCTION public.inventory_object_v1(value jsonb,keys text[]) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT coalesce(jsonb_typeof(value)='object' AND value-keys='{}'::jsonb AND value ?& keys,false)
$$;
CREATE OR REPLACE FUNCTION public.inventory_id_v1(value jsonb) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT coalesce(jsonb_typeof(value)='string' AND length(value #>> '{}') BETWEEN 1 AND 200 AND btrim(value #>> '{}')=value #>> '{}',false)
$$;
CREATE OR REPLACE FUNCTION public.inventory_revision_v1(value jsonb) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT coalesce(jsonb_typeof(value)='number' AND (value #>> '{}')~'^[0-9]+$' AND (value #>> '{}')::numeric<=9007199254740991,false)
$$;

-- Shared matcher: trusted persisted catalog only. Free existing copies need no catalog.
CREATE OR REPLACE FUNCTION public.inventory_match_v1(identity_value jsonb,target_value jsonb) RETURNS void
LANGUAGE plpgsql STABLE SET search_path='' AS $$
DECLARE card public.tcg_cards; target_card public.tcg_cards;
BEGIN
 IF target_value IS NULL OR target_value='null' THEN RETURN; END IF;
 IF NOT public.valid_inventory_identity_v1(target_value) THEN RAISE EXCEPTION 'invalid_inventory_target' USING ERRCODE='22023'; END IF;
 IF target_value->>'kind'='card' THEN
   target_card:=public.slot_catalog_card_v1(target_value->>'cardId');
   IF target_card.id IS NULL THEN RAISE EXCEPTION 'inventory_catalog_unavailable' USING ERRCODE='22023'; END IF;
 END IF;
 IF identity_value->>'kind'='card' THEN
   card:=public.slot_catalog_card_v1(identity_value->>'cardId');
   IF card.id IS NULL THEN RAISE EXCEPTION 'inventory_catalog_unavailable' USING ERRCODE='22023'; END IF;
 END IF;
 IF target_value->>'kind'='pokemon' THEN
   IF (target_value->>'pokemonId')::numeric NOT BETWEEN 1 AND 1025 THEN RAISE EXCEPTION 'inventory_catalog_unavailable' USING ERRCODE='22023'; END IF;
   IF identity_value->>'kind'='pokemon' AND identity_value->'pokemonId'=target_value->'pokemonId' THEN RETURN; END IF;
   IF card.id IS NOT NULL AND EXISTS(SELECT 1 FROM public.tcg_card_dex_ids WHERE card_id=card.id AND dex_id=(target_value->>'pokemonId')::bigint) THEN RETURN; END IF;
 ELSIF card.id IS NOT NULL AND target_value->>'cardId'=ANY(public.slot_catalog_ids_v1(card))
   AND (NOT target_value ? 'language' OR target_value->'language'=identity_value->'language')
   AND (NOT target_value ? 'finish' OR target_value->'finish'=identity_value->'finish') THEN RETURN;
 END IF;
 RAISE EXCEPTION 'inventory_target_mismatch' USING ERRCODE='22023';
END $$;

CREATE OR REPLACE FUNCTION public.inventory_item_ref_v1(owner_id uuid,ref jsonb) RETURNS public.inventory_items
LANGUAGE plpgsql SET search_path='' AS $$
DECLARE item public.inventory_items; placed public.inventory_placements;
BEGIN
 IF NOT public.inventory_object_v1(ref,ARRAY['itemId','itemVersion','placement']) OR NOT public.inventory_id_v1(ref->'itemId')
   OR NOT public.inventory_revision_v1(ref->'itemVersion') THEN RAISE EXCEPTION 'invalid_inventory_command' USING ERRCODE='22023'; END IF;
 SELECT * INTO item FROM public.inventory_items WHERE id=ref->>'itemId' AND owner_user_id=owner_id FOR UPDATE;
 IF NOT FOUND OR to_jsonb(item.version) IS DISTINCT FROM ref->'itemVersion' THEN RAISE EXCEPTION 'item_conflict' USING ERRCODE='40001'; END IF;
 SELECT * INTO placed FROM public.inventory_placements WHERE inventory_item_id=item.id AND owner_user_id=owner_id FOR UPDATE;
 IF ref->'placement'='null' THEN
   IF placed.inventory_item_id IS NOT NULL THEN RAISE EXCEPTION 'placement_conflict' USING ERRCODE='40001'; END IF;
 ELSE
   IF NOT public.inventory_object_v1(ref->'placement',ARRAY['collectionId','slot']) THEN RAISE EXCEPTION 'invalid_inventory_command' USING ERRCODE='22023'; END IF;
   IF placed.slot_id IS DISTINCT FROM ref->'placement'->'slot'->>'id' OR placed.collection_id::text IS DISTINCT FROM ref->'placement'->>'collectionId'
     OR ref->'placement'->'slot'->>'inventoryItemId' IS DISTINCT FROM item.id THEN RAISE EXCEPTION 'placement_conflict' USING ERRCODE='40001'; END IF;
   PERFORM public.slot_check_ref_v1(owner_id,placed.collection_id,ref->'placement'->'slot');
 END IF;
 RETURN item;
END $$;

-- Compact touched-state envelope for #394/#396, not a history recorder or a usable undo endpoint.
CREATE OR REPLACE FUNCTION public.inventory_evidence_v1(owner_id uuid,item_ids text[],slot_ids text[],collection_ids uuid[]) RETURNS jsonb
LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT jsonb_build_object(
 'items',(SELECT coalesce(jsonb_agg(to_jsonb(i) ORDER BY id),'[]') FROM public.inventory_items i WHERE owner_user_id=owner_id AND id=ANY(item_ids)),
 'placements',(SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY inventory_item_id),'[]') FROM public.inventory_placements p WHERE owner_user_id=owner_id AND inventory_item_id=ANY(item_ids)),
 'slots',(SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY id),'[]') FROM public.binder_slots s WHERE owner_user_id=owner_id AND id=ANY(slot_ids)),
 'collections',(SELECT coalesce(jsonb_agg(to_jsonb(c) ORDER BY collection_id),'[]') FROM public.storage_collection_state c WHERE owner_user_id=owner_id AND collection_id=ANY(collection_ids)),
 'binders',(SELECT coalesce(jsonb_agg(to_jsonb(b) ORDER BY id),'[]') FROM public.binders b WHERE owner_user_id=owner_id AND id=ANY(collection_ids)))
$$;

CREATE OR REPLACE FUNCTION public.inventory_command_v1(actor uuid,owner_id uuid,request jsonb,trusted_intent jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET lock_timeout='3s' SET statement_timeout='10s' AS $$
DECLARE revision bigint; prior public.developer_idempotency; digest text; state public.storage_collection_state; token jsonb;
 command jsonb; kind text; ref jsonb; dest jsonb; selection jsonb; chosen public.inventory_items; displaced public.inventory_items;
 placement public.inventory_placements; dest_placement public.inventory_placements; card public.tcg_cards; identity_value jsonb;
 slots text[]; items text[]; collections uuid[]; all_slots text[]:='{}'; all_items text[]:='{}'; all_collections uuid[]:='{}';
 declared_collections uuid[]:='{}'; selected_ids text[]:='{}'; acquired_ids text[]:='{}'; changed_collections uuid[]:='{}'; structural_collections uuid[]:='{}';
 key text; collection uuid; before_value jsonb; evidence jsonb:='[]'; result jsonb; context jsonb; want jsonb; wants jsonb; idx integer;
 saved_before bigint; allowed integer; groups integer; affected integer:=0; changed boolean:=false; effective boolean;
BEGIN
 IF actor IS NULL OR owner_id IS NULL THEN RAISE EXCEPTION 'inventory_access_denied' USING ERRCODE='42501'; END IF;
 IF NOT public.inventory_object_v1(request,ARRAY['operationId','inventoryRevision','collections','commands'])
   OR octet_length(request::text)>262144 OR NOT public.inventory_id_v1(request->'operationId') OR length(request->>'operationId') NOT BETWEEN 8 AND 100
   OR NOT public.inventory_revision_v1(request->'inventoryRevision') OR jsonb_typeof(request->'commands') IS DISTINCT FROM 'array'
   OR jsonb_typeof(request->'collections') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'invalid_inventory_command' USING ERRCODE='22023'; END IF;
 IF jsonb_array_length(request->'commands') NOT BETWEEN 1 AND 100 OR jsonb_array_length(request->'collections')>32 THEN RAISE EXCEPTION 'invalid_inventory_command' USING ERRCODE='22023'; END IF;
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
 saved_before:=public.slot_saved_count_v1(owner_id);
 FOR command IN SELECT jsonb_array_elements(request->'commands') LOOP
   kind:=command->>'kind'; slots:='{}'; items:='{}'; collections:='{}'; chosen:=NULL; displaced:=NULL; placement:=NULL; dest_placement:=NULL; effective:=true;
   IF kind='add' THEN
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
   ELSIF kind IN ('edit','removeOwned','unassign','move') THEN
     IF NOT public.inventory_object_v1(command,CASE kind WHEN 'edit' THEN ARRAY['kind','item','grading'] WHEN 'move' THEN ARRAY['kind','item','destination','occupied','fulfillWant'] ELSE ARRAY['kind','item'] END) THEN RAISE EXCEPTION 'invalid_inventory_command' USING ERRCODE='22023'; END IF;
     chosen:=public.inventory_item_ref_v1(owner_id,command->'item'); items:=ARRAY[chosen.id];
     SELECT * INTO placement FROM public.inventory_placements WHERE inventory_item_id=chosen.id AND owner_user_id=owner_id;
     IF placement.slot_id IS NOT NULL THEN slots:=ARRAY[placement.slot_id]; collections:=ARRAY[placement.collection_id]; END IF;
     IF kind='move' AND placement.slot_id IS NULL THEN RAISE EXCEPTION 'placement_conflict' USING ERRCODE='40001'; END IF;
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
       SELECT count(DISTINCT coalesce(i.grading,'null')) INTO groups FROM public.inventory_items i
       WHERE i.owner_user_id=owner_id AND i.identity->>'kind'='card' AND i.identity->'language' IS NOT DISTINCT FROM identity_value->'language'
         AND i.identity->'finish' IS NOT DISTINCT FROM identity_value->'finish' AND NOT i.id=ANY(all_items)
         AND NOT EXISTS(SELECT 1 FROM public.inventory_placements p WHERE p.inventory_item_id=i.id)
         AND (public.slot_catalog_card_v1(i.identity->>'cardId')).id=card.id;
       IF groups>1 THEN RAISE EXCEPTION 'inventory_copy_choice_required' USING ERRCODE='40001'; END IF;
       SELECT i.* INTO chosen FROM public.inventory_items i WHERE i.owner_user_id=owner_id AND i.identity->>'kind'='card'
         AND i.identity->'language' IS NOT DISTINCT FROM identity_value->'language' AND i.identity->'finish' IS NOT DISTINCT FROM identity_value->'finish'
         AND NOT i.id=ANY(all_items) AND NOT EXISTS(SELECT 1 FROM public.inventory_placements p WHERE p.inventory_item_id=i.id)
         AND (public.slot_catalog_card_v1(i.identity->>'cardId')).id=card.id ORDER BY i.id COLLATE "C" LIMIT 1 FOR UPDATE;
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
   IF affected>256 THEN RAISE EXCEPTION 'inventory_batch_too_large' USING ERRCODE='22023'; END IF;
   all_slots:=all_slots||slots; all_items:=all_items||items; all_collections:=all_collections||collections;
   before_value:=public.inventory_evidence_v1(owner_id,items,slots,collections);

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
   evidence:=evidence||jsonb_build_array(jsonb_build_object('kind',kind,'before',before_value,'after',public.inventory_evidence_v1(owner_id,items,slots,collections)));
 END LOOP;
 IF public.billing_enforced() AND NOT public.billing_has_paid(owner_id) AND public.slot_saved_count_v1(owner_id)>saved_before THEN
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
   'context',context,'evidence',evidence,'after',public.inventory_evidence_v1(owner_id,all_items,all_slots,all_collections));
 IF octet_length(result::text)>1048576 THEN RAISE EXCEPTION 'inventory_result_too_large_reduce_batch' USING ERRCODE='22023'; END IF;
 INSERT INTO public.developer_idempotency(actor_id,operation,request_key,input_digest,result,expires_at)
 VALUES(actor,'inventory_v1',request->>'operationId',digest,result,'infinity');
 RETURN result;
EXCEPTION WHEN invalid_text_representation OR invalid_datetime_format OR datetime_field_overflow OR numeric_value_out_of_range THEN
 RAISE EXCEPTION 'invalid_inventory_command' USING ERRCODE='22023';
END $$;
REVOKE ALL ON FUNCTION public.inventory_object_v1(jsonb,text[]),public.inventory_id_v1(jsonb),public.inventory_revision_v1(jsonb),
 public.inventory_match_v1(jsonb,jsonb),public.inventory_item_ref_v1(uuid,jsonb),public.inventory_evidence_v1(uuid,text[],text[],uuid[]),
 public.inventory_command_v1(uuid,uuid,jsonb,jsonb) FROM PUBLIC,anon,authenticated,holo_mcp,service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
