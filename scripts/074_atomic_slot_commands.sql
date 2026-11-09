-- Staged structural commands only. NO runtime role, including service_role, may execute them.
-- #394 must add its transactional recorder and #396 recovery before a later reviewed grant.
BEGIN;
SET LOCAL lock_timeout = '3s';

-- Frozen legacy rows in converted binders must not double-count inventory or wants.
CREATE OR REPLACE FUNCTION public.slot_saved_count_v1(owner_id uuid) RETURNS bigint
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT (SELECT coalesce(sum(public.billing_card_weight(c.status,c.wanted_cards)),0)
   FROM public.pokemon_collection c WHERE c.user_id=owner_id AND NOT EXISTS
   (SELECT 1 FROM public.storage_collection_state s WHERE s.collection_id=c.binder_id AND s.authority='slots'))
 + (SELECT count(*) FROM public.inventory_items WHERE owner_user_id=owner_id)
 + (SELECT coalesce(sum(greatest(jsonb_array_length(s.wanted_cards),CASE WHEN s.status='wishlisted' THEN 1 ELSE 0 END)
     + CASE WHEN s.status='considering' THEN 1 ELSE 0 END),0)
    FROM public.binder_slots s JOIN public.storage_collection_state c USING(collection_id,owner_user_id)
    WHERE s.owner_user_id=owner_id AND c.authority='slots')
$$;
-- Retain current prices, trial, paid access and the existing legacy billing lock.
CREATE OR REPLACE FUNCTION public.enforce_collection_billing() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE previous integer:=0; allowed integer;
BEGIN
 IF TG_OP='UPDATE' AND NEW.user_id IS DISTINCT FROM OLD.user_id THEN RAISE EXCEPTION 'Collection owner cannot be changed' USING ERRCODE='42501'; END IF;
 IF NOT public.billing_enforced() OR public.billing_has_paid(NEW.user_id) THEN RETURN NEW; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(NEW.user_id::text,4701));
 IF TG_OP='UPDATE' THEN previous:=public.billing_card_weight(OLD.status,OLD.wanted_cards); END IF;
 IF public.billing_card_weight(NEW.status,NEW.wanted_cards)<=previous THEN RETURN NEW; END IF;
 SELECT free_card_limit INTO allowed FROM public.billing_configuration WHERE id;
 IF public.slot_saved_count_v1(NEW.user_id)>coalesce(allowed,10) THEN RAISE EXCEPTION 'card_limit_reached'; END IF;
 RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION public.get_billing_access(owner_id uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT jsonb_build_object('enforced',c.enforced,
  'perpetual',EXISTS(SELECT 1 FROM public.perpetual_licences WHERE owner_user_id=owner_id),
  'status',(SELECT status FROM public.billing_accounts WHERE owner_user_id=owner_id),
  'paid_through',(SELECT paid_through FROM public.billing_accounts WHERE owner_user_id=owner_id),
  'trial_ends_at',(SELECT created_at+interval '168 hours' FROM auth.users WHERE id=owner_id AND created_at<=now()),
  'saved_card_count',public.slot_saved_count_v1(owner_id),'free_card_limit',c.free_card_limit,'free_binder_limit',c.free_binder_limit)
 FROM public.billing_configuration c WHERE c.id
 AND ((select auth.role())='service_role' OR public.billing_partner_allowed(owner_id,(select auth.uid())))
$$;

-- Returns a coherent single-statement page, and rejects a changed owner-wide snapshot on continuation.
-- Owner-only EXECUTE for now; #376 binds the trusted actor/owner in the supported dispatcher later.
CREATE OR REPLACE FUNCTION public.slot_page_v1(actor uuid,owner_id uuid,collection uuid,page_size integer DEFAULT 100,
 after_position bigint DEFAULT NULL,expected_inventory bigint DEFAULT NULL,expected_collection bigint DEFAULT NULL,expected_layout bigint DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE state public.storage_collection_state; revision bigint; result jsonb; last_position bigint; more boolean;
BEGIN
 IF actor IS NULL OR owner_id IS NULL OR NOT public.billing_partner_allowed(owner_id,actor) THEN RAISE EXCEPTION 'slot_access_denied' USING ERRCODE='42501'; END IF;
 IF page_size IS NULL OR page_size NOT BETWEEN 1 AND 500 OR after_position<0 THEN RAISE EXCEPTION 'invalid_slot_page' USING ERRCODE='22023'; END IF;
 SELECT * INTO state FROM public.storage_collection_state WHERE collection_id=collection AND owner_user_id=owner_id;
 IF NOT FOUND OR state.authority<>'slots' THEN RAISE EXCEPTION 'slot_storage_unavailable' USING ERRCODE='55000'; END IF;
 SELECT inventory_revision INTO revision FROM public.inventory_owner_state WHERE owner_user_id=owner_id;
 IF revision IS NULL THEN RAISE EXCEPTION 'slot_storage_unavailable' USING ERRCODE='55000'; END IF;
 IF (after_position IS NOT NULL OR expected_inventory IS NOT NULL OR expected_collection IS NOT NULL OR expected_layout IS NOT NULL)
   AND (revision IS DISTINCT FROM expected_inventory OR state.version IS DISTINCT FROM expected_collection OR state.layout_revision IS DISTINCT FROM expected_layout) THEN
   RAISE EXCEPTION 'slot_revision_conflict' USING ERRCODE='40001',DETAIL=jsonb_build_object('inventoryRevision',revision,'collectionVersion',state.version,'layoutRevision',state.layout_revision)::text;
 END IF;
 SELECT coalesce(jsonb_agg(to_jsonb(page) ORDER BY position,id),'[]'),max(position) INTO result,last_position FROM (
   SELECT s.*,p.inventory_item_id,p.version AS placement_version,i.version AS item_version
   FROM public.binder_slots s LEFT JOIN public.inventory_placements p ON p.slot_id=s.id AND p.owner_user_id=owner_id
   LEFT JOIN public.inventory_items i ON i.id=p.inventory_item_id AND i.owner_user_id=owner_id
   WHERE s.collection_id=collection AND s.owner_user_id=owner_id AND (after_position IS NULL OR s.position>after_position)
   ORDER BY s.position,s.id LIMIT page_size) page;
 SELECT EXISTS(SELECT 1 FROM public.binder_slots WHERE collection_id=collection AND owner_user_id=owner_id AND position>last_position) INTO more;
 IF octet_length(result::text)>1048576 THEN RAISE EXCEPTION 'slot_page_too_large_reduce_limit' USING ERRCODE='22023'; END IF;
 RETURN jsonb_build_object('inventoryRevision',revision,'collectionVersion',state.version,'layoutRevision',state.layout_revision,
   'slots',result,'nextPosition',CASE WHEN more THEN last_position ELSE NULL END);
END $$;

-- Exact preconditions, including absence. Whole-slot operations cannot erase a later placement.
CREATE OR REPLACE FUNCTION public.slot_check_ref_v1(owner_id uuid,collection uuid,ref jsonb) RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE s public.binder_slots; p public.inventory_placements; i public.inventory_items;
BEGIN
 IF jsonb_typeof(ref) IS DISTINCT FROM 'object' OR ref-ARRAY['id','version','inventoryItemId','itemVersion','placementVersion']<>'{}'
   OR NOT ref ?& ARRAY['id','version','inventoryItemId','itemVersion','placementVersion'] THEN RAISE EXCEPTION 'invalid_slot_command' USING ERRCODE='22023'; END IF;
 SELECT * INTO s FROM public.binder_slots WHERE id=ref->>'id' AND collection_id=collection AND owner_user_id=owner_id FOR UPDATE;
 IF NOT FOUND OR to_jsonb(s.version) IS DISTINCT FROM ref->'version' THEN RAISE EXCEPTION 'slot_conflict' USING ERRCODE='40001',DETAIL=coalesce(to_jsonb(s)::text,'null'); END IF;
 SELECT * INTO p FROM public.inventory_placements WHERE slot_id=s.id AND owner_user_id=owner_id FOR UPDATE;
 IF coalesce(to_jsonb(p.inventory_item_id),'null') IS DISTINCT FROM ref->'inventoryItemId'
   OR coalesce(to_jsonb(p.version),'null') IS DISTINCT FROM ref->'placementVersion' THEN RAISE EXCEPTION 'placement_conflict' USING ERRCODE='40001'; END IF;
 IF p.inventory_item_id IS NOT NULL THEN SELECT * INTO i FROM public.inventory_items WHERE id=p.inventory_item_id AND owner_user_id=owner_id FOR UPDATE; END IF;
 IF coalesce(to_jsonb(i.version),'null') IS DISTINCT FROM ref->'itemVersion' THEN RAISE EXCEPTION 'item_conflict' USING ERRCODE='40001'; END IF;
END $$;

-- Persisted equivalent of readCatalogMetadata/catalogCardIds. Never resolve by a name.
CREATE OR REPLACE FUNCTION public.slot_catalog_ids_v1(card public.tcg_cards) RETURNS text[]
LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE meta jsonb:=card.external_ids_json->'catalog'; ids text[]:=ARRAY[card.id];
BEGIN
 IF jsonb_typeof(meta->'canonicalId')='string' AND length(meta->>'canonicalId') BETWEEN 1 AND 200 THEN ids:=array_append(ids,meta->>'canonicalId'); END IF;
 IF jsonb_typeof(meta->'aliasIds')='array' THEN
   IF jsonb_array_length(meta->'aliasIds')<=1000 AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(meta->'aliasIds') v WHERE jsonb_typeof(v)<>'string' OR length(v #>> '{}') NOT BETWEEN 1 AND 200) THEN
     ids:=ids||ARRAY(SELECT jsonb_array_elements_text(meta->'aliasIds'));
   END IF;
 END IF;
 RETURN ids;
END $$;
CREATE OR REPLACE FUNCTION public.slot_catalog_card_v1(card_key text) RETURNS public.tcg_cards
LANGUAGE plpgsql STABLE SET search_path='' AS $$
DECLARE card public.tcg_cards; found_ids text[];
BEGIN
 SELECT * INTO card FROM public.tcg_cards WHERE id=card_key;
 IF FOUND THEN RETURN card; END IF;
 -- Canonical/alias fallback is bounded to two matches and refuses ambiguous stored evidence.
 SELECT array_agg(id) INTO found_ids FROM (SELECT c.id FROM public.tcg_cards c WHERE card_key=ANY(public.slot_catalog_ids_v1(c)) LIMIT 2) matches;
 IF cardinality(found_ids)=1 THEN SELECT * INTO card FROM public.tcg_cards WHERE id=found_ids[1]; RETURN card; END IF;
 RETURN NULL;
END $$;

-- Persisted equivalent of matchesSlotTarget/inventoryItemCandidate, with actual placement evidence.
CREATE OR REPLACE FUNCTION public.slot_check_target_v1(owner_id uuid,slot_key text,target_value jsonb) RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE identity_value jsonb; target_card public.tcg_cards; item_card public.tcg_cards;
BEGIN
 IF target_value='null' THEN RETURN; END IF; -- Existing unknown copies may always enter/remain free slots.
 IF target_value IS NULL OR NOT public.valid_inventory_identity_v1(target_value) THEN RAISE EXCEPTION 'invalid_slot_target' USING ERRCODE='22023'; END IF;
 IF target_value->>'kind'='pokemon' AND (target_value->>'pokemonId')::bigint NOT BETWEEN 1 AND 1025 THEN RAISE EXCEPTION 'slot_catalog_unavailable' USING ERRCODE='22023'; END IF;
 IF target_value->>'kind'='card' THEN
   target_card:=public.slot_catalog_card_v1(target_value->>'cardId');
   IF target_card.id IS NULL THEN RAISE EXCEPTION 'slot_catalog_unavailable' USING ERRCODE='22023'; END IF;
 END IF;
 SELECT i.identity INTO identity_value FROM public.inventory_placements p JOIN public.inventory_items i ON i.id=p.inventory_item_id AND i.owner_user_id=p.owner_user_id
 WHERE p.slot_id=slot_key AND p.owner_user_id=owner_id;
 IF identity_value IS NULL THEN RETURN; END IF;
 IF identity_value->>'kind'='card' THEN item_card:=public.slot_catalog_card_v1(identity_value->>'cardId'); END IF;
 IF target_value->>'kind'='pokemon' THEN
   IF identity_value->>'kind'='pokemon' AND identity_value->'pokemonId'=target_value->'pokemonId' THEN RETURN; END IF;
   IF item_card.id IS NOT NULL AND EXISTS(SELECT 1 FROM public.tcg_card_dex_ids WHERE card_id=item_card.id AND dex_id=(target_value->>'pokemonId')::bigint) THEN RETURN; END IF;
 ELSIF item_card.id IS NOT NULL AND target_value->>'cardId'=ANY(public.slot_catalog_ids_v1(item_card))
   AND (NOT target_value ? 'language' OR target_value->'language'=identity_value->'language')
   AND (NOT target_value ? 'finish' OR target_value->'finish'=identity_value->'finish') THEN RETURN;
 END IF;
 RAISE EXCEPTION 'slot_target_mismatch' USING ERRCODE='22023';
END $$;

CREATE OR REPLACE FUNCTION public.slot_command_v1(actor uuid,owner_id uuid,request jsonb,trusted_source jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET lock_timeout='3s' SET statement_timeout='10s' AS $$
DECLARE collection uuid; state public.storage_collection_state; revision bigint; prior public.developer_idempotency;
 command jsonb; ref jsonb; key text; kind text; keys text[]; ordered text[]; previous_order text[]; moving text[]; anchor text; idx integer;
 touched text[]:='{}'; removed text[]:='{}'; changed boolean:=false; structural boolean:=false; count_work integer:=0; inserted integer:=0;
 saved_before bigint; allowed integer; result jsonb; digest text; context jsonb; wants jsonb; member text;
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
 saved_before:=public.slot_saved_count_v1(owner_id);
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
 IF public.billing_enforced() AND NOT public.billing_has_paid(owner_id) AND public.slot_saved_count_v1(owner_id)>saved_before THEN
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
   'acquisition',false,'changed',changed,'context',context,'slots',(SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY position,id),'[]') FROM public.binder_slots s WHERE s.collection_id=collection AND s.owner_user_id=owner_id AND s.id=ANY(touched)));
 IF octet_length(result::text)>1048576 THEN RAISE EXCEPTION 'slot_result_too_large_reduce_batch' USING ERRCODE='22023'; END IF;
 INSERT INTO public.developer_idempotency(actor_id,operation,request_key,input_digest,result,expires_at)
 VALUES(actor,'binder_slots_v1',request->>'operationId',digest,result,'infinity');
 RETURN result;
END $$;

-- Hard staging boundary. These prototypes are SQL-owner-only, even service_role cannot call them.
REVOKE ALL ON FUNCTION public.slot_saved_count_v1(uuid),public.slot_page_v1(uuid,uuid,uuid,integer,bigint,bigint,bigint,bigint),
 public.slot_catalog_ids_v1(public.tcg_cards),public.slot_catalog_card_v1(text),public.slot_check_ref_v1(uuid,uuid,jsonb),public.slot_check_target_v1(uuid,text,jsonb),public.slot_command_v1(uuid,uuid,jsonb,jsonb)
 FROM PUBLIC,anon,authenticated,holo_mcp,service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
