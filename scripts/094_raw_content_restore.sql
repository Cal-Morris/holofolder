-- #365 bounded raw content restore. Native public admission remains denied under #379.
BEGIN;
SET LOCAL lock_timeout='3s';
DO $$ BEGIN
 IF to_regprocedure('collection_audit_private.execute_creation_import_v1(text,uuid,uuid,jsonb,jsonb)') IS NULL THEN
   RAISE EXCEPTION 'raw_restore_requires_093'; END IF;
END $$;
CREATE OR REPLACE FUNCTION collection_audit_private.restore_raw_content_v1(actor uuid,owner_id uuid,request jsonb,ctx jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET lock_timeout='3s' SET statement_timeout='10s' AS $$
DECLARE membership public.partnerships; live_partner uuid; prior public.developer_idempotency; digest text;
 collection uuid; binder_row public.binders; settings_row public.user_settings; state public.storage_collection_state; revision bigint; pair jsonb; desired jsonb; ref jsonb;
 slot public.binder_slots; item public.inventory_items; want jsonb; member text; card public.tcg_cards;
 ids text[]:='{}'; selected text[]:='{}'; desired_ids text[]:='{}'; required text[]:='{}'; released text[]:='{}';
 work integer:=0; saved_before bigint; allowed integer; result jsonb; predicate_state text;
BEGIN
 -- Lock live membership before the common owner locks. Scope fields are preconditions only.
 SELECT * INTO membership FROM public.partnerships WHERE actor IN(user1_id,user2_id) FOR SHARE;
 IF actor IS NULL OR owner_id IS NULL OR owner_id IS DISTINCT FROM
   (CASE WHEN membership.owner_user_id IS NOT NULL AND public.billing_partner_allowed(membership.owner_user_id,actor) THEN membership.owner_user_id ELSE actor END)
   OR NOT public.billing_partner_allowed(owner_id,actor) THEN RAISE EXCEPTION 'storage_access_denied' USING ERRCODE='42501'; END IF;
 SELECT CASE WHEN user1_id=owner_id THEN user2_id ELSE user1_id END INTO live_partner
   FROM public.partnerships WHERE owner_user_id=owner_id FOR SHARE;
 IF NOT public.inventory_object_v1(request,ARRAY['version','operationId','inventoryRevision','planning','collection','configuration','slots','items','releaseItemIds'])
   OR request->'version' IS DISTINCT FROM '1'::jsonb OR NOT public.inventory_id_v1(request->'operationId')
   OR length(request->>'operationId') NOT BETWEEN 8 AND 100 OR octet_length(request::text)>1048576
   OR NOT public.inventory_revision_v1(request->'inventoryRevision')
   OR NOT public.inventory_object_v1(request->'planning',ARRAY['actorUserId','ownerUserId','source','credentialId','authSessionId','partnerUserId','partnershipId'])
   OR NOT public.inventory_object_v1(request->'collection',ARRAY['collectionId','version','layoutRevision'])
   OR NOT public.inventory_object_v1(request->'configuration',ARRAY['name','kind','defaultPresentation','location','rows','cols'])
   OR NOT public.inventory_revision_v1(request->'collection'->'version') OR NOT public.inventory_revision_v1(request->'collection'->'layoutRevision')
   OR jsonb_typeof(request->'slots') IS DISTINCT FROM 'array' OR jsonb_array_length(request->'slots') NOT BETWEEN 1 AND 256
   OR jsonb_typeof(request->'items') IS DISTINCT FROM 'array' OR jsonb_array_length(request->'items')>512
   OR 2*jsonb_array_length(request->'slots')+jsonb_array_length(request->'items')>1024
   OR jsonb_typeof(request->'releaseItemIds') IS DISTINCT FROM 'array' OR jsonb_array_length(request->'releaseItemIds')>512 THEN
   RAISE EXCEPTION 'invalid_raw_restore' USING ERRCODE='22023'; END IF;
 IF request->'planning'->>'actorUserId' IS DISTINCT FROM actor::text
   OR request->'planning'->>'ownerUserId' IS DISTINCT FROM owner_id::text
   OR request->'planning'->'source' IS DISTINCT FROM ctx->'source'
   OR request->'planning'->'credentialId' IS DISTINCT FROM coalesce(ctx->'clientId','null')
   OR request->'planning'->'partnershipId' IS DISTINCT FROM coalesce(to_jsonb(membership.id),'null')
   OR request->'planning'->'partnerUserId' IS DISTINCT FROM coalesce(to_jsonb(live_partner),'null')
   OR (ctx->>'source'='app' AND (NOT public.inventory_id_v1(request->'planning'->'authSessionId') OR request->'planning'->'credentialId'<>'null'))
   OR (ctx->>'source'<>'app' AND (request->'planning'->'authSessionId'<>'null' OR NOT public.inventory_id_v1(request->'planning'->'credentialId'))) THEN
   RAISE EXCEPTION 'storage_access_denied' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(owner_id::text,6102));
 PERFORM pg_advisory_xact_lock(hashtextextended(owner_id::text,4701));
 digest:=encode(sha256(convert_to(jsonb_build_object('owner',owner_id,'request',request,'context',ctx)::text,'UTF8')),'hex');
 SELECT * INTO prior FROM public.developer_idempotency WHERE actor_id=actor AND operation='raw_content_restore_v1' AND request_key=request->>'operationId' FOR UPDATE;
 IF FOUND THEN
   IF prior.input_digest<>digest THEN RAISE EXCEPTION 'idempotency_conflict' USING ERRCODE='40001'; END IF;
   RETURN prior.result;
 END IF;
 IF EXISTS(SELECT 1 FROM public.collection_activity WHERE owner_user_id=owner_id AND operation_id=request->>'operationId' AND format_version=1) THEN
   RAISE EXCEPTION 'idempotency_conflict' USING ERRCODE='40001'; END IF;
 SELECT inventory_revision INTO revision FROM public.inventory_owner_state WHERE owner_user_id=owner_id FOR UPDATE;
 IF revision IS NULL THEN RAISE EXCEPTION 'storage_owner_state_unavailable' USING ERRCODE='55000'; END IF;
 BEGIN
   IF to_jsonb(revision) IS DISTINCT FROM request->'inventoryRevision' THEN RAISE EXCEPTION 'inventory_revision_conflict' USING ERRCODE='HF941'; END IF;
   collection:=(request->'collection'->>'collectionId')::uuid;
   SELECT * INTO binder_row FROM public.binders WHERE id=collection AND owner_user_id=owner_id FOR UPDATE;
   IF NOT FOUND THEN RAISE EXCEPTION 'storage_access_denied' USING ERRCODE='42501'; END IF;
   SELECT * INTO state FROM public.storage_collection_state WHERE collection_id=collection AND owner_user_id=owner_id FOR UPDATE;
   IF NOT FOUND OR state.authority<>'slots' OR state.conversion_version IS NOT NULL OR state.conversion_receipt IS NOT NULL
     OR (state.preset_manifest IS NOT NULL AND state.preset_manifest IS DISTINCT FROM '{"source":{"id":"blank","version":"1"},"name":"Blank","entries":[]}'::jsonb)
     OR EXISTS(SELECT 1 FROM public.binder_legacy_rows WHERE collection_id=collection) THEN
     RAISE EXCEPTION 'raw_restore_unsupported' USING ERRCODE='0A000'; END IF;
   SELECT * INTO settings_row FROM public.user_settings WHERE user_id=owner_id FOR SHARE;
   IF jsonb_build_object('name',binder_row.name,'kind',state.kind,'defaultPresentation',state.default_presentation,'location',state.location,
     'rows',coalesce(binder_row.binder_rows,settings_row.binder_rows,4),'cols',coalesce(binder_row.binder_cols,settings_row.binder_cols,4)) IS DISTINCT FROM request->'configuration' THEN
     RAISE EXCEPTION 'raw_restore_collection_conflict' USING ERRCODE='HF942'; END IF;
   IF to_jsonb(state.version) IS DISTINCT FROM request->'collection'->'version'
     OR to_jsonb(state.layout_revision) IS DISTINCT FROM request->'collection'->'layoutRevision' THEN
     RAISE EXCEPTION 'raw_restore_collection_conflict' USING ERRCODE='HF942'; END IF;
   IF (SELECT coalesce(jsonb_agg(id ORDER BY position),'[]') FROM public.binder_slots WHERE collection_id=collection AND owner_user_id=owner_id)
     IS DISTINCT FROM (SELECT jsonb_agg(v->'before'->'id' ORDER BY n) FROM jsonb_array_elements(request->'slots') WITH ORDINALITY a(v,n)) THEN
     RAISE EXCEPTION 'raw_restore_content_conflict' USING ERRCODE='HF943'; END IF;
   -- Validate the entire selected raw graph before writes. No acquisition, item edit or other-collection move.
   FOR ref IN SELECT jsonb_array_elements(request->'items') LOOP
     item:=public.inventory_item_ref_v1(owner_id,ref);
     IF item.id=ANY(selected) THEN RAISE EXCEPTION 'invalid_raw_restore' USING ERRCODE='22023'; END IF;
     IF item.grading IS NOT NULL OR item.legacy_source IS NOT NULL THEN RAISE EXCEPTION 'raw_restore_unsupported' USING ERRCODE='0A000'; END IF;
     IF ref->'placement'<>'null' AND ref->'placement'->>'collectionId' IS DISTINCT FROM collection::text THEN
       RAISE EXCEPTION 'raw_restore_other_placement' USING ERRCODE='0A000'; END IF;
     selected:=array_append(selected,item.id);
   END LOOP;
   FOR pair IN SELECT jsonb_array_elements(request->'slots') LOOP
     desired:=pair->'after';
     IF NOT public.inventory_object_v1(pair,ARRAY['before','after'])
       OR NOT public.inventory_object_v1(desired,ARRAY['id','target','status','wantedCards','inventoryItemId','presetOrigin'])
       OR desired->'id' IS DISTINCT FROM pair->'before'->'id' OR NOT public.inventory_id_v1(desired->'id')
       OR desired->>'id'=ANY(ids) OR desired->'presetOrigin' IS DISTINCT FROM 'null'::jsonb
       OR NOT (desired->'target'='null' OR public.valid_inventory_identity_v1(desired->'target'))
       OR NOT (desired->'status'='null' OR desired->>'status' IN ('collected','finalized','considering','wishlisted'))
       OR NOT public.valid_slot_wants_v1(desired->'wantedCards') OR jsonb_array_length(desired->'wantedCards')>100
       OR NOT (desired->'inventoryItemId'='null' OR public.inventory_id_v1(desired->'inventoryItemId'))
       OR coalesce(desired->>'status' IN ('collected','finalized'),false) IS DISTINCT FROM (desired->'inventoryItemId'<>'null') THEN
       RAISE EXCEPTION 'invalid_raw_restore' USING ERRCODE='22023'; END IF;
     ids:=array_append(ids,desired->>'id');
     PERFORM public.slot_check_ref_v1(owner_id,collection,pair->'before');
     SELECT * INTO slot FROM public.binder_slots WHERE id=desired->>'id' AND owner_user_id=owner_id;
     IF slot.preset_origin IS NOT NULL THEN RAISE EXCEPTION 'raw_restore_unsupported' USING ERRCODE='0A000'; END IF;
     IF pair->'before'->'inventoryItemId'<>'null' THEN
       required:=array_append(required,pair->'before'->>'inventoryItemId');
       IF NOT pair->'before'->>'inventoryItemId'=ANY(selected) THEN RAISE EXCEPTION 'invalid_raw_restore' USING ERRCODE='22023'; END IF;
     END IF;
     IF desired->'inventoryItemId'<>'null' THEN
       IF NOT desired->>'inventoryItemId'=ANY(selected) OR desired->>'inventoryItemId'=ANY(desired_ids) THEN
         RAISE EXCEPTION 'invalid_raw_restore' USING ERRCODE='22023'; END IF;
       desired_ids:=array_append(desired_ids,desired->>'inventoryItemId'); required:=array_append(required,desired->>'inventoryItemId');
     END IF;
     IF desired->'target'<>'null' THEN
       IF desired->'target'->>'kind'='card' THEN
         card:=public.slot_catalog_card_v1(desired->'target'->>'cardId');
         IF card.id IS NULL THEN RAISE EXCEPTION 'inventory_catalog_unavailable' USING ERRCODE='22023'; END IF;
       ELSIF (desired->'target'->>'pokemonId')::numeric NOT BETWEEN 1 AND 1025 THEN
         RAISE EXCEPTION 'inventory_catalog_unavailable' USING ERRCODE='22023'; END IF;
     END IF;
     FOR want IN SELECT jsonb_array_elements(desired->'wantedCards') LOOP
       card:=public.slot_catalog_card_v1(want->>'card_id');
       IF card.id IS NULL THEN RAISE EXCEPTION 'inventory_catalog_unavailable' USING ERRCODE='22023'; END IF;
       IF want ? 'card_image' AND (want->>'card_image')!~'^https://(assets[.]tcgdex[.]net|assets[.]holofolder[.]com)/[^?#@:]*$' THEN
         RAISE EXCEPTION 'raw_restore_asset_unsupported' USING ERRCODE='22023'; END IF;
       FOR member IN SELECT jsonb_array_elements_text(coalesce(want->'wanted_by','[]')) LOOP
         IF member::uuid<>owner_id AND member::uuid IS DISTINCT FROM live_partner THEN RAISE EXCEPTION 'invalid_wanted_assignment' USING ERRCODE='22023'; END IF;
       END LOOP;
     END LOOP;
   END LOOP;
   IF EXISTS(SELECT unnest(selected) EXCEPT SELECT unnest(required)) THEN RAISE EXCEPTION 'invalid_raw_restore' USING ERRCODE='22023'; END IF;
   SELECT coalesce(array_agg(r->>'itemId' ORDER BY r->>'itemId'),'{}') INTO released FROM jsonb_array_elements(request->'items') r
     WHERE r->'placement'<>'null' AND NOT r->>'itemId'=ANY(desired_ids);
   IF to_jsonb(released) IS DISTINCT FROM (SELECT coalesce(jsonb_agg(v ORDER BY v),'[]') FROM jsonb_array_elements(request->'releaseItemIds') v) THEN
     RAISE EXCEPTION 'invalid_raw_restore_release' USING ERRCODE='22023'; END IF;
   SELECT 2*jsonb_array_length(request->'slots')+jsonb_array_length(request->'items')+coalesce(sum(jsonb_array_length(v->'after'->'wantedCards')),0) INTO work FROM jsonb_array_elements(request->'slots') v;
   IF work>1024 THEN RAISE EXCEPTION 'raw_restore_work_exceeded' USING ERRCODE='22023'; END IF;
   saved_before:=public.slot_saved_count_v1(owner_id);
   DELETE FROM public.inventory_placements WHERE owner_user_id=owner_id AND collection_id=collection;
   UPDATE public.binder_slots s SET target=nullif(v->'after'->'target','null'),status=v->'after'->>'status',wanted_cards=v->'after'->'wantedCards',version=s.version+1,updated_at=clock_timestamp()
     FROM jsonb_array_elements(request->'slots') v WHERE s.owner_user_id=owner_id AND s.collection_id=collection AND s.id=v->'after'->>'id';
   INSERT INTO public.inventory_placements(inventory_item_id,owner_user_id,collection_id,slot_id,version)
     SELECT v->'after'->>'inventoryItemId',owner_id,collection,v->'after'->>'id',coalesce((r->'placement'->'slot'->>'placementVersion')::bigint,-1)+1
     FROM jsonb_array_elements(request->'slots') v JOIN jsonb_array_elements(request->'items') r ON r->>'itemId'=v->'after'->>'inventoryItemId';
   FOR pair IN SELECT jsonb_array_elements(request->'slots') LOOP
     PERFORM public.slot_check_target_v1(owner_id,pair->'after'->>'id',pair->'after'->'target');
   END LOOP;
   IF public.billing_enforced() AND NOT public.billing_has_paid(owner_id) AND public.slot_saved_count_v1(owner_id)>saved_before THEN
     SELECT free_card_limit INTO allowed FROM public.billing_configuration WHERE id;
     IF public.slot_saved_count_v1(owner_id)>coalesce(allowed,10) THEN RAISE EXCEPTION 'card_limit_reached'; END IF;
   END IF;
   UPDATE public.inventory_owner_state SET inventory_revision=inventory_revision+1 WHERE owner_user_id=owner_id RETURNING inventory_revision INTO revision;
   UPDATE public.storage_collection_state SET version=version+1 WHERE collection_id=collection AND owner_user_id=owner_id;
   result:=jsonb_build_object('inventoryRevision',revision,'collectionId',collection,'collectionVersion',state.version+1,
     'layoutRevision',state.layout_revision,'changed',true,'slotIds',to_jsonb(ids),'releasedItemIds',to_jsonb(released));
   PERFORM collection_audit_private.command_result(owner_id,result||jsonb_build_object('context',ctx),'backup.restore.raw');
 EXCEPTION WHEN SQLSTATE 'HF941' OR SQLSTATE 'HF942' OR SQLSTATE 'HF943' THEN
   GET STACKED DIAGNOSTICS predicate_state=RETURNED_SQLSTATE;
   SELECT inventory_revision INTO STRICT revision FROM public.inventory_owner_state WHERE owner_user_id=owner_id;
   result:=jsonb_build_object('outcome','rejected','operationId',request->>'operationId','inventoryRevision',revision,'code',
     CASE predicate_state WHEN 'HF941' THEN 'inventory_revision_conflict' WHEN 'HF942' THEN 'raw_restore_collection_conflict' ELSE 'raw_restore_content_conflict' END);
 END;
 -- Both accepted and rejected requests retain the original body/context for life, before reconstruction.
 INSERT INTO public.developer_idempotency(actor_id,operation,request_key,input_digest,result,expires_at)
 VALUES(actor,'raw_content_restore_v1',request->>'operationId',digest,result,'infinity');
 RETURN result;
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
 RAISE EXCEPTION 'invalid_raw_restore' USING ERRCODE='22023';
END $$;
REVOKE ALL ON FUNCTION collection_audit_private.restore_raw_content_v1(uuid,uuid,jsonb,jsonb) FROM PUBLIC,anon,authenticated,holo_mcp,service_role;
DO $gateway$
DECLARE body text; anchor text;
BEGIN
 SELECT pg_get_functiondef('public.storage_execute_v1(text,uuid,jsonb)'::regprocedure) INTO body;
 IF position('collection_audit_private.restore_raw_content_v1' IN body)=0 THEN
   anchor:=$a$'inventory','slots','backup.arrangement','collection.create'$a$;
   IF position(anchor IN body)=0 OR position($a$WHEN 'backup.arrangement' THEN$a$ IN body)=0 THEN RAISE EXCEPTION 'raw_restore_gateway_changed'; END IF;
   body:=replace(body,anchor,$a$'inventory','slots','backup.restore.raw','backup.arrangement','collection.create'$a$);
   body:=replace(body,$a$WHEN 'backup.arrangement' THEN$a$,$a$WHEN 'backup.restore.raw' THEN result:=collection_audit_private.restore_raw_content_v1(actor,owner_id,request,ctx);
 WHEN 'backup.arrangement' THEN$a$);
   EXECUTE body;
 END IF;
END $gateway$;
NOTIFY pgrst,'reload schema';
COMMIT;
