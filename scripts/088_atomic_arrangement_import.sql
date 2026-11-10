-- Internal only, #365 execution slice. #379 admission stays denied. No prototype grants/conversions.
BEGIN;
SET LOCAL lock_timeout='3s';
CREATE OR REPLACE FUNCTION collection_audit_private.import_arrangement_v1(actor uuid,owner_id uuid,request jsonb,ctx jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET lock_timeout='3s' SET statement_timeout='10s' AS $$
DECLARE membership public.partnerships; prior public.developer_idempotency; digest text; revision bigint; destination uuid;
 state public.storage_collection_state; token jsonb; copy jsonb; item_value jsonb; slot_value jsonb; want jsonb; member text;
 item public.inventory_items; placed public.inventory_placements; card public.tcg_cards; identity_value jsonb;
 declared uuid[]:='{}'; required uuid[]; selected text[]:='{}'; added text[]:='{}'; slot_ids text[]:='{}'; placed_ids text[]:='{}';
 source_slots text[]:='{}'; saved_before bigint; allowed integer; result jsonb;
BEGIN
 -- Membership lock order matches 083 and excludes partner unlink/non-key membership edits until commit.
 SELECT * INTO membership FROM public.partnerships WHERE actor IN(user1_id,user2_id) FOR SHARE;
 IF actor IS NULL OR owner_id IS NULL OR owner_id IS DISTINCT FROM
   (CASE WHEN membership.owner_user_id IS NOT NULL AND public.billing_partner_allowed(membership.owner_user_id,actor) THEN membership.owner_user_id ELSE actor END)
   OR NOT public.billing_partner_allowed(owner_id,actor) THEN RAISE EXCEPTION 'storage_access_denied' USING ERRCODE='42501'; END IF;
 IF NOT public.inventory_object_v1(request,ARRAY['version','operationId','inventoryRevision','destinationCollectionId','collections','emptyDestinationSlots','manifest','slots','copies'])
   OR request->'version' IS DISTINCT FROM '1'::jsonb OR octet_length(request::text)>8388608
   OR NOT public.inventory_id_v1(request->'operationId') OR length(request->>'operationId') NOT BETWEEN 8 AND 100
   OR NOT public.inventory_revision_v1(request->'inventoryRevision')
   OR jsonb_typeof(request->'destinationCollectionId') IS DISTINCT FROM 'string'
   OR (request->>'destinationCollectionId')!~*'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
   OR jsonb_typeof(request->'collections') IS DISTINCT FROM 'array' OR jsonb_array_length(request->'collections') NOT BETWEEN 1 AND 32
   OR jsonb_typeof(request->'emptyDestinationSlots') IS DISTINCT FROM 'array' OR jsonb_array_length(request->'emptyDestinationSlots')>4096
   OR jsonb_typeof(request->'slots') IS DISTINCT FROM 'array' OR jsonb_array_length(request->'slots') NOT BETWEEN 1 AND 4096
   OR jsonb_typeof(request->'copies') IS DISTINCT FROM 'array' OR jsonb_array_length(request->'copies')>5000 THEN
   RAISE EXCEPTION 'invalid_arrangement_import' USING ERRCODE='22023'; END IF;
 destination:=(request->>'destinationCollectionId')::uuid; required:=ARRAY[destination];
 PERFORM pg_advisory_xact_lock(hashtextextended(owner_id::text,4701));
 digest:=encode(sha256(convert_to(jsonb_build_object('owner',owner_id,'request',request,'context',ctx)::text,'UTF8')),'hex');
 SELECT * INTO prior FROM public.developer_idempotency WHERE actor_id=actor AND operation='backup_arrangement_v1' AND request_key=request->>'operationId' FOR UPDATE;
 IF FOUND THEN
   IF prior.input_digest<>digest THEN RAISE EXCEPTION 'idempotency_conflict' USING ERRCODE='40001'; END IF;
   RETURN prior.result;
 END IF;
 IF EXISTS(SELECT 1 FROM public.collection_activity WHERE owner_user_id=owner_id AND operation_id=request->>'operationId' AND format_version=1) THEN
   RAISE EXCEPTION 'idempotency_conflict' USING ERRCODE='40001'; END IF;
 SELECT inventory_revision INTO revision FROM public.inventory_owner_state WHERE owner_user_id=owner_id FOR UPDATE;
 IF revision IS NULL OR to_jsonb(revision) IS DISTINCT FROM request->'inventoryRevision' THEN RAISE EXCEPTION 'inventory_revision_conflict' USING ERRCODE='40001'; END IF;
 IF revision>=9007199254740991 THEN RAISE EXCEPTION 'inventory_revision_overflow' USING ERRCODE='22023'; END IF;
 FOR token IN SELECT v FROM jsonb_array_elements(request->'collections') v ORDER BY v->>'collectionId' LOOP
   IF NOT public.inventory_object_v1(token,ARRAY['collectionId','version','layoutRevision'])
     OR NOT public.inventory_revision_v1(token->'version') OR NOT public.inventory_revision_v1(token->'layoutRevision') THEN
     RAISE EXCEPTION 'invalid_arrangement_import' USING ERRCODE='22023'; END IF;
   IF (token->>'collectionId')::uuid=ANY(declared) THEN RAISE EXCEPTION 'invalid_arrangement_import' USING ERRCODE='22023'; END IF;
   declared:=array_append(declared,(token->>'collectionId')::uuid);
   PERFORM 1 FROM public.binders WHERE id=(token->>'collectionId')::uuid AND owner_user_id=owner_id FOR UPDATE;
   IF NOT FOUND THEN RAISE EXCEPTION 'storage_access_denied' USING ERRCODE='42501'; END IF;
   SELECT * INTO state FROM public.storage_collection_state WHERE collection_id=(token->>'collectionId')::uuid AND owner_user_id=owner_id FOR UPDATE;
   IF NOT FOUND OR state.authority<>'slots' OR state.conversion_version IS NOT NULL OR state.conversion_receipt IS NOT NULL THEN
     RAISE EXCEPTION 'arrangement_converted_or_legacy_unsupported' USING ERRCODE='0A000'; END IF;
   IF to_jsonb(state.version) IS DISTINCT FROM token->'version' OR to_jsonb(state.layout_revision) IS DISTINCT FROM token->'layoutRevision' THEN
     RAISE EXCEPTION 'inventory_collection_conflict' USING ERRCODE='40001'; END IF;
 END LOOP;
 IF NOT destination=ANY(declared) THEN RAISE EXCEPTION 'invalid_arrangement_import' USING ERRCODE='22023'; END IF;
 SELECT * INTO state FROM public.storage_collection_state WHERE collection_id=destination AND owner_user_id=owner_id;
 IF coalesce(state.preset_manifest,'null') IS DISTINCT FROM request->'manifest'
   OR (SELECT count(*) FROM public.binder_slots WHERE collection_id=destination)<>jsonb_array_length(request->'emptyDestinationSlots')
   OR EXISTS(SELECT 1 FROM public.binder_slots WHERE collection_id=destination AND (status IS NOT NULL OR wanted_cards<>'[]')) THEN
   RAISE EXCEPTION 'arrangement_destination_conflict' USING ERRCODE='40001'; END IF;
 IF (SELECT count(DISTINCT s->>'id') FROM jsonb_array_elements(request->'emptyDestinationSlots') s)<>jsonb_array_length(request->'emptyDestinationSlots') THEN
   RAISE EXCEPTION 'invalid_arrangement_import' USING ERRCODE='22023'; END IF;
 FOR slot_value IN SELECT jsonb_array_elements(request->'emptyDestinationSlots') LOOP
   IF slot_value->'inventoryItemId' IS DISTINCT FROM 'null'::jsonb THEN RAISE EXCEPTION 'invalid_arrangement_import' USING ERRCODE='22023'; END IF;
   PERFORM public.slot_check_ref_v1(owner_id,destination,slot_value);
 END LOOP;
 saved_before:=public.slot_saved_count_v1(owner_id);
 -- Validate all physical identities, explicit move refs and recorded metadata before any writes.
 FOR copy IN SELECT jsonb_array_elements(request->'copies') LOOP
   item_value:=copy->'item';
   IF NOT public.inventory_object_v1(copy,ARRAY['kind','item','ref'])
     OR NOT public.inventory_object_v1(item_value,ARRAY['id','identity','grading','acquiredAt','version'])
     OR NOT public.inventory_id_v1(item_value->'id') OR NOT public.valid_inventory_identity_v1(item_value->'identity')
     OR NOT public.inventory_revision_v1(item_value->'version') OR item_value->>'id'=ANY(selected)
     OR NOT public.valid_grading_record_v1(nullif(item_value->'grading','null'))
     OR (item_value->'grading'<>'null' AND (item_value->'identity'->>'kind'<>'card' OR item_value->'grading'->'label'->'assetIds'<>'[]'))
     OR (item_value->'acquiredAt'<>'null' AND (jsonb_typeof(item_value->'acquiredAt')<>'string' OR NOT isfinite((item_value->>'acquiredAt')::timestamptz))) THEN
     RAISE EXCEPTION 'invalid_import_copy' USING ERRCODE='22023'; END IF;
   selected:=array_append(selected,item_value->>'id'); identity_value:=item_value->'identity';
   IF identity_value->>'kind'='card' THEN
     card:=public.slot_catalog_card_v1(identity_value->>'cardId');
     IF card.id IS NULL THEN RAISE EXCEPTION 'inventory_catalog_unavailable' USING ERRCODE='22023'; END IF;
   ELSIF (identity_value->>'pokemonId')::numeric NOT BETWEEN 1 AND 1025 THEN RAISE EXCEPTION 'inventory_catalog_unavailable' USING ERRCODE='22023'; END IF;
   IF copy->>'kind'='add' THEN
     IF copy->'ref'<>'null' OR item_value->'version'<>'0' OR EXISTS(SELECT 1 FROM public.inventory_items WHERE id=item_value->>'id') THEN
       RAISE EXCEPTION 'import_copy_conflict' USING ERRCODE='40001'; END IF;
     added:=array_append(added,item_value->>'id');
   ELSIF copy->>'kind'='existing' THEN
     item:=public.inventory_item_ref_v1(owner_id,copy->'ref');
     IF item.id IS DISTINCT FROM item_value->>'id' OR to_jsonb(item.version) IS DISTINCT FROM item_value->'version'
       OR item.identity IS DISTINCT FROM identity_value OR coalesce(item.grading,'null') IS DISTINCT FROM item_value->'grading'
       OR item.acquired_at IS DISTINCT FROM (item_value->>'acquiredAt')::timestamptz THEN RAISE EXCEPTION 'import_copy_conflict' USING ERRCODE='40001'; END IF;
     IF item.legacy_source IS NOT NULL THEN RAISE EXCEPTION 'import_frozen_copy_unsupported' USING ERRCODE='0A000'; END IF;
     SELECT * INTO placed FROM public.inventory_placements WHERE inventory_item_id=item.id AND owner_user_id=owner_id;
     IF placed.slot_id IS NOT NULL THEN
       IF NOT placed.collection_id=ANY(declared) THEN RAISE EXCEPTION 'invalid_arrangement_import' USING ERRCODE='22023'; END IF;
       required:=array_append(required,placed.collection_id); source_slots:=array_append(source_slots,placed.slot_id);
     END IF;
   ELSE RAISE EXCEPTION 'invalid_import_copy' USING ERRCODE='22023'; END IF;
 END LOOP;
 IF EXISTS(SELECT unnest(declared) EXCEPT SELECT unnest(required)) THEN RAISE EXCEPTION 'invalid_arrangement_import' USING ERRCODE='22023'; END IF;
 FOR slot_value IN SELECT jsonb_array_elements(request->'slots') LOOP
   IF NOT public.inventory_object_v1(slot_value,ARRAY['id','target','status','wantedCards','inventoryItemId','presetOrigin'])
     OR NOT public.inventory_id_v1(slot_value->'id') OR slot_value->>'id'=ANY(slot_ids)
     OR EXISTS(SELECT 1 FROM public.binder_slots WHERE id=slot_value->>'id')
     OR NOT (slot_value->'target'='null' OR public.valid_inventory_identity_v1(slot_value->'target'))
     OR NOT (slot_value->'status'='null' OR slot_value->>'status' IN ('collected','finalized','considering','wishlisted'))
     OR NOT public.valid_slot_wants_v1(slot_value->'wantedCards') OR jsonb_array_length(slot_value->'wantedCards')>100
     OR NOT (slot_value->'inventoryItemId'='null' OR public.inventory_id_v1(slot_value->'inventoryItemId'))
     OR coalesce(slot_value->>'status' IN ('collected','finalized'),false) IS DISTINCT FROM (slot_value->'inventoryItemId'<>'null') THEN
     RAISE EXCEPTION 'invalid_import_slot' USING ERRCODE='22023'; END IF;
   slot_ids:=array_append(slot_ids,slot_value->>'id');
   IF slot_value->'inventoryItemId'<>'null' THEN
     IF NOT slot_value->>'inventoryItemId'=ANY(selected) OR slot_value->>'inventoryItemId'=ANY(placed_ids) THEN RAISE EXCEPTION 'invalid_import_slot' USING ERRCODE='22023'; END IF;
     placed_ids:=array_append(placed_ids,slot_value->>'inventoryItemId');
   END IF;
   IF slot_value->'presetOrigin'<>'null' AND (NOT public.inventory_object_v1(slot_value->'presetOrigin',ARRAY['source','entryId'])
     OR slot_value->'presetOrigin'->'source' IS DISTINCT FROM request->'manifest'->'source'
     OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(request->'manifest'->'entries') e WHERE e->'id'=slot_value->'presetOrigin'->'entryId')) THEN
     RAISE EXCEPTION 'invalid_import_provenance' USING ERRCODE='22023'; END IF;
   FOR want IN SELECT jsonb_array_elements(slot_value->'wantedCards') LOOP
     card:=public.slot_catalog_card_v1(want->>'card_id');
     IF card.id IS NULL THEN RAISE EXCEPTION 'inventory_catalog_unavailable' USING ERRCODE='22023'; END IF;
     -- Asset URLs remain inert, public hints only. Never fetch any backup URL.
     IF want ? 'card_image' AND (want->>'card_image')!~'^https://(assets[.]tcgdex[.]net|assets[.]holofolder[.]com)/[^?#@:]*$' THEN
       RAISE EXCEPTION 'import_asset_unsupported' USING ERRCODE='22023'; END IF;
     FOR member IN SELECT jsonb_array_elements_text(coalesce(want->'wanted_by','[]')) LOOP
       IF NOT public.billing_partner_allowed(owner_id,member::uuid) THEN RAISE EXCEPTION 'invalid_wanted_assignment' USING ERRCODE='22023'; END IF;
     END LOOP;
   END LOOP;
 END LOOP;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(request->'copies') c WHERE c->>'kind'='existing' AND NOT c->'item'->>'id'=ANY(placed_ids)) THEN
   RAISE EXCEPTION 'invalid_import_move' USING ERRCODE='22023'; END IF;
 -- All effects, the existing recorder and the permanent ledger share this transaction.
 INSERT INTO public.inventory_items(id,owner_user_id,identity,grading,acquired_at)
 SELECT c->'item'->>'id',owner_id,c->'item'->'identity',nullif(c->'item'->'grading','null'),(c->'item'->>'acquiredAt')::timestamptz
 FROM jsonb_array_elements(request->'copies') c WHERE c->>'kind'='add';
 DELETE FROM public.inventory_placements WHERE owner_user_id=owner_id AND inventory_item_id=ANY(selected);
 UPDATE public.binder_slots SET status=NULL,version=version+1,updated_at=clock_timestamp() WHERE owner_user_id=owner_id AND id=ANY(source_slots);
 DELETE FROM public.binder_slots WHERE owner_user_id=owner_id AND collection_id=destination;
 INSERT INTO public.binder_slots(id,collection_id,owner_user_id,position,target,status,wanted_cards,preset_origin)
 SELECT s->>'id',destination,owner_id,n-1,nullif(s->'target','null'),s->>'status',s->'wantedCards',nullif(s->'presetOrigin','null')
 FROM jsonb_array_elements(request->'slots') WITH ORDINALITY a(s,n);
 INSERT INTO public.inventory_placements(inventory_item_id,owner_user_id,collection_id,slot_id,version)
 SELECT s->>'inventoryItemId',owner_id,destination,s->>'id',CASE WHEN c->>'kind'='add' THEN 0
   ELSE coalesce((c->'ref'->'placement'->'slot'->>'placementVersion')::bigint,-1)+1 END
 FROM jsonb_array_elements(request->'slots') s JOIN jsonb_array_elements(request->'copies') c ON c->'item'->>'id'=s->>'inventoryItemId';
 FOR slot_value IN SELECT jsonb_array_elements(request->'slots') LOOP
   PERFORM public.slot_check_target_v1(owner_id,slot_value->>'id',slot_value->'target');
 END LOOP;
 IF public.billing_enforced() AND NOT public.billing_has_paid(owner_id) AND public.slot_saved_count_v1(owner_id)>saved_before THEN
   SELECT free_card_limit INTO allowed FROM public.billing_configuration WHERE id;
   IF public.slot_saved_count_v1(owner_id)>coalesce(allowed,10) THEN RAISE EXCEPTION 'card_limit_reached'; END IF;
 END IF;
 UPDATE public.inventory_owner_state SET inventory_revision=inventory_revision+1 WHERE owner_user_id=owner_id RETURNING inventory_revision INTO revision;
 UPDATE public.storage_collection_state SET version=version+1,layout_revision=layout_revision+CASE WHEN collection_id=destination THEN 1 ELSE 0 END
 WHERE owner_user_id=owner_id AND collection_id=ANY(declared);
 SELECT jsonb_build_object('inventoryRevision',revision,'collectionId',destination,'collectionVersion',version,'layoutRevision',layout_revision,
   'changed',true,'slotIds',to_jsonb(slot_ids),'addedItemIds',to_jsonb(added),'removedEmptySlotIds',(SELECT coalesce(jsonb_agg(s->'id'),'[]') FROM jsonb_array_elements(request->'emptyDestinationSlots') s)) INTO result FROM public.storage_collection_state WHERE collection_id=destination;
 IF octet_length(result::text)>1048576 THEN RAISE EXCEPTION 'import_receipt_too_large' USING ERRCODE='22023'; END IF;
 PERFORM collection_audit_private.command_result(owner_id,result||jsonb_build_object('context',ctx),'backup.arrangement');
 INSERT INTO public.developer_idempotency(actor_id,operation,request_key,input_digest,result,expires_at)
 VALUES(actor,'backup_arrangement_v1',request->>'operationId',digest,result,'infinity');
 RETURN result;
EXCEPTION WHEN invalid_text_representation OR invalid_datetime_format OR datetime_field_overflow OR numeric_value_out_of_range THEN
 RAISE EXCEPTION 'invalid_arrangement_import' USING ERRCODE='22023';
END $$;
REVOKE ALL ON FUNCTION collection_audit_private.import_arrangement_v1(uuid,uuid,jsonb,jsonb) FROM PUBLIC,anon,authenticated,holo_mcp,service_role;
DO $gateway$
DECLARE body text;
BEGIN
 SELECT pg_get_functiondef('public.storage_execute_v1(text,uuid,jsonb)'::regprocedure) INTO body;
 IF position('collection_audit_private.import_arrangement_v1' IN body)=0 THEN
   IF position($anchor$WHEN 'collection.create' THEN$anchor$ IN body)=0 OR position($anchor$'inventory','slots','collection.create'$anchor$ IN body)=0 THEN
     RAISE EXCEPTION 'import_gateway_signature_changed'; END IF;
   body:=replace(body,$anchor$'inventory','slots','collection.create'$anchor$,$anchor$'inventory','slots','backup.arrangement','collection.create'$anchor$);
   body:=replace(body,$anchor$WHEN 'collection.create' THEN$anchor$,$new$WHEN 'backup.arrangement' THEN result:=collection_audit_private.import_arrangement_v1(actor,owner_id,request,ctx);
 WHEN 'collection.create' THEN$new$);
   EXECUTE body;
 END IF;
END $gateway$;
NOTIFY pgrst,'reload schema';
COMMIT;
