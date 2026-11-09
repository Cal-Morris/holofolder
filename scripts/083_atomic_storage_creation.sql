-- Internal only. Native collection-creation inverses remain unsupported: #396 + #379 block enablement.
-- Additive command over existing storage/ledger/audit. No conversion, runtime routes or helper grants.
BEGIN;
SET LOCAL lock_timeout='3s';
ALTER TABLE public.storage_collection_state ADD COLUMN IF NOT EXISTS location text;
ALTER TABLE public.storage_collection_state DROP CONSTRAINT IF EXISTS storage_collection_location_check;
ALTER TABLE public.storage_collection_state ADD CONSTRAINT storage_collection_location_check
 CHECK (location IS NULL OR (kind='custom' AND length(location) BETWEEN 1 AND 200 AND btrim(location)=location));

-- Historical root snapshots predate location. Preserve their exact projection when it is absent.
-- Non-null private location is still captured/redacted/recovered by the existing recorder.
DO $projection$
DECLARE body text;
BEGIN
 SELECT pg_get_functiondef('collection_audit_private.state(text,jsonb)'::regprocedure) INTO body;
 IF position($anchor$WHEN 'storage_collection_state' THEN$anchor$ IN body)=0 THEN
   IF position($anchor$WHEN 'binder_appearances' THEN$anchor$ IN body)=0 THEN RAISE EXCEPTION 'creation_projection_signature_changed'; END IF;
   body:=replace(body,$old$WHEN 'binder_appearances' THEN$old$,
     $new$WHEN 'storage_collection_state' THEN RETURN CASE WHEN row_data->'location' IS NULL OR row_data->'location'='null'::jsonb
       THEN row_data-ARRAY['updated_at','created_at','location'] ELSE row_data-ARRAY['updated_at','created_at'] END;
 WHEN 'binder_appearances' THEN$new$);
   EXECUTE body;
 END IF;
END $projection$;

CREATE OR REPLACE FUNCTION collection_audit_private.create_collection_v1(actor uuid,owner_id uuid,request jsonb,ctx jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET lock_timeout='3s' SET statement_timeout='10s' AS $$
DECLARE prior public.developer_idempotency; revision bigint; digest text; result jsonb; collection uuid;
 manifest jsonb; entry jsonb; target_value jsonb; card public.tcg_cards; binder_count integer; next_sort integer;
 membership public.partnerships; source_value jsonb; keys text[]; slot_keys text[]; r integer; c integer; grid jsonb;
BEGIN
 -- Upgrade the gateway's key-share lock before owner locks, also excluding non-key membership changes.
 SELECT * INTO membership FROM public.partnerships WHERE actor IN(user1_id,user2_id) FOR SHARE;
 IF actor IS NULL OR owner_id IS NULL
   OR owner_id IS DISTINCT FROM (CASE WHEN membership.owner_user_id IS NOT NULL AND public.billing_partner_allowed(membership.owner_user_id,actor) THEN membership.owner_user_id ELSE actor END)
   OR NOT public.billing_partner_allowed(owner_id,actor) THEN
   RAISE EXCEPTION 'storage_access_denied' USING ERRCODE='42501';
 END IF;
 IF octet_length(request::text)>2097152 OR NOT public.inventory_object_v1(request,
   ARRAY['version','operationId','inventoryRevision','collectionId','name','kind','defaultPresentation','location','grid','manifest','slotIds'])
   OR request->'version' IS DISTINCT FROM '1'::jsonb OR NOT public.inventory_revision_v1(request->'inventoryRevision')
   OR NOT public.inventory_id_v1(request->'operationId') OR length(request->>'operationId') NOT BETWEEN 8 AND 100
   OR jsonb_typeof(request->'collectionId') IS DISTINCT FROM 'string'
   OR (request->>'collectionId')!~*'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
   OR jsonb_typeof(request->'name') IS DISTINCT FROM 'string' OR length(request->>'name') NOT BETWEEN 1 AND 40
   OR request->>'name' IS DISTINCT FROM btrim(regexp_replace(request->>'name','[[:space:]]+',' ','g'))
   OR NOT coalesce(request->>'kind' IN ('binder','slab','custom'),false)
   OR request->>'defaultPresentation' IS DISTINCT FROM (CASE request->>'kind' WHEN 'binder' THEN 'binder' WHEN 'slab' THEN 'slabs' ELSE 'list' END)
   OR NOT (request->'location'='null' OR request->>'kind'='custom' AND public.inventory_id_v1(request->'location')) THEN
   RAISE EXCEPTION 'invalid_collection_creation' USING ERRCODE='22023';
 END IF;
 grid:=request->'grid';
 IF grid<>'null' THEN
   IF NOT public.inventory_object_v1(grid,ARRAY['rows','cols']) OR NOT public.inventory_revision_v1(grid->'rows')
     OR NOT public.inventory_revision_v1(grid->'cols') OR (grid->>'rows')::numeric NOT BETWEEN 1 AND 8
     OR (grid->>'cols')::numeric NOT BETWEEN 1 AND 8 THEN RAISE EXCEPTION 'invalid_collection_grid' USING ERRCODE='22023'; END IF;
   r:=(grid->>'rows')::integer; c:=(grid->>'cols')::integer;
 END IF;
 manifest:=request->'manifest'; source_value:=manifest->'source';
 IF NOT public.inventory_object_v1(manifest,ARRAY['source','name','entries'])
   OR NOT public.inventory_object_v1(source_value,ARRAY['id','version'])
   OR NOT public.inventory_id_v1(source_value->'id') OR NOT public.inventory_id_v1(source_value->'version')
   OR jsonb_typeof(manifest->'name') IS DISTINCT FROM 'string' OR length(btrim(manifest->>'name'))=0 OR length(manifest->>'name')>200
   OR jsonb_typeof(manifest->'entries') IS DISTINCT FROM 'array' OR jsonb_array_length(manifest->'entries')>4096
   OR jsonb_typeof(request->'slotIds') IS DISTINCT FROM 'array'
   OR jsonb_array_length(request->'slotIds')<>jsonb_array_length(manifest->'entries') THEN
   RAISE EXCEPTION 'invalid_collection_manifest' USING ERRCODE='22023';
 END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(request->'slotIds') v WHERE NOT public.inventory_id_v1(v))
   OR EXISTS(SELECT 1 FROM jsonb_array_elements(manifest->'entries') e WHERE NOT public.inventory_object_v1(e,ARRAY['id','target']) OR NOT public.inventory_id_v1(e->'id')) THEN
   RAISE EXCEPTION 'invalid_collection_manifest' USING ERRCODE='22023';
 END IF;
 SELECT coalesce(array_agg(v->>'id'),'{}') INTO keys FROM jsonb_array_elements(manifest->'entries') v;
 SELECT coalesce(array_agg(v #>> '{}' ORDER BY n),'{}') INTO slot_keys FROM jsonb_array_elements(request->'slotIds') WITH ORDINALITY a(v,n);
 IF cardinality(keys)<>(SELECT count(DISTINCT v) FROM unnest(keys) v)
   OR cardinality(slot_keys)<>(SELECT count(DISTINCT v) FROM unnest(slot_keys) v) THEN
   RAISE EXCEPTION 'invalid_collection_manifest' USING ERRCODE='22023';
 END IF;
 collection:=(request->>'collectionId')::uuid;
 -- Match legacy create/reorder's management lock before the existing allowance/inventory lock.
 PERFORM pg_advisory_xact_lock(hashtextextended(owner_id::text,6102));
 PERFORM pg_advisory_xact_lock(hashtextextended(owner_id::text,4701));
 digest:=encode(sha256(convert_to(jsonb_build_object('owner',owner_id,'request',request,'context',ctx)::text,'UTF8')),'hex');
 SELECT * INTO prior FROM public.developer_idempotency WHERE actor_id=actor AND operation='collection_create_v1' AND request_key=request->>'operationId' FOR UPDATE;
 IF FOUND THEN
   IF prior.input_digest<>digest THEN RAISE EXCEPTION 'idempotency_conflict' USING ERRCODE='40001'; END IF;
   RETURN prior.result;
 END IF;
 -- Actor/credential changes never reuse another accepted creation's owner-scoped identity.
 IF EXISTS(SELECT 1 FROM public.collection_activity WHERE owner_user_id=owner_id AND operation_id=request->>'operationId' AND format_version=1) THEN
   RAISE EXCEPTION 'idempotency_conflict' USING ERRCODE='40001';
 END IF;
 SELECT inventory_revision INTO revision FROM public.inventory_owner_state WHERE owner_user_id=owner_id FOR UPDATE;
 revision:=coalesce(revision,0);
 IF to_jsonb(revision) IS DISTINCT FROM request->'inventoryRevision' THEN RAISE EXCEPTION 'inventory_revision_conflict' USING ERRCODE='40001'; END IF;
 IF revision=9007199254740991 THEN RAISE EXCEPTION 'inventory_revision_overflow' USING ERRCODE='22023'; END IF;
 IF EXISTS(SELECT 1 FROM public.binders WHERE id=collection)
   OR EXISTS(SELECT 1 FROM public.binder_slots WHERE id=ANY(slot_keys)) THEN RAISE EXCEPTION 'creation_identity_conflict' USING ERRCODE='40001'; END IF;
 -- Validate copied targets independently. No ownership, names or UI catalog evidence is authoritative.
 FOR entry IN SELECT jsonb_array_elements(manifest->'entries') LOOP
   target_value:=entry->'target';
   IF target_value='null' THEN CONTINUE; END IF;
   IF NOT public.valid_inventory_identity_v1(target_value) THEN RAISE EXCEPTION 'invalid_collection_target' USING ERRCODE='22023'; END IF;
   IF target_value->>'kind'='pokemon' THEN
     IF (target_value->>'pokemonId')::numeric NOT BETWEEN 1 AND 1025 THEN RAISE EXCEPTION 'collection_catalog_unavailable' USING ERRCODE='22023'; END IF;
   ELSE
     card:=public.slot_catalog_card_v1(target_value->>'cardId');
     IF card.id IS NULL OR length(btrim(card.set_id))=0 OR length(btrim(card.local_id))=0 THEN
       RAISE EXCEPTION 'collection_catalog_unavailable' USING ERRCODE='22023'; END IF;
     IF target_value ? 'language' AND NOT (
       length(btrim(coalesce(card.name_json->>(target_value->>'language'),'')))>0
       OR card.image_languages_json @> jsonb_build_array(target_value->>'language')) THEN
       RAISE EXCEPTION 'collection_language_unavailable' USING ERRCODE='22023'; END IF;
     -- A finish constraint needs explicit catalog evidence, never inference from rarity or a UI label.
     IF target_value ? 'finish' AND card.variants_json->(CASE target_value->>'finish' WHEN 'reverse_holo' THEN 'reverse' ELSE target_value->>'finish' END) IS DISTINCT FROM 'true'::jsonb THEN
       RAISE EXCEPTION 'collection_finish_unavailable' USING ERRCODE='22023'; END IF;
   END IF;
 END LOOP;
 PERFORM 1 FROM public.binders WHERE owner_user_id=owner_id ORDER BY id FOR UPDATE;
 SELECT count(*),coalesce(max(sort_order),-1)+1 INTO binder_count,next_sort FROM public.binders WHERE owner_user_id=owner_id;
 IF binder_count>=20 THEN RAISE EXCEPTION 'binder_safety_limit_reached' USING ERRCODE='P0001'; END IF;
 -- Existing triggers enforce plan cap and custom grid; failing either rolls back every row and audit delta.
 INSERT INTO public.inventory_owner_state(owner_user_id) VALUES(owner_id) ON CONFLICT DO NOTHING;
 INSERT INTO public.binders(id,owner_user_id,name,sort_order,is_default,binder_rows,binder_cols)
 VALUES(collection,owner_id,request->>'name',next_sort,binder_count=0,r,c);
 INSERT INTO public.storage_collection_state(collection_id,owner_user_id,kind,default_presentation,location,preset_manifest,authority)
 VALUES(collection,owner_id,request->>'kind',request->>'defaultPresentation',request->>'location',manifest,'slots');
 INSERT INTO public.binder_slots(id,collection_id,owner_user_id,position,target,preset_origin)
 SELECT slot_keys[n],collection,owner_id,n-1,nullif(e->'target','null'),jsonb_build_object('source',source_value,'entryId',e->'id')
 FROM jsonb_array_elements(manifest->'entries') WITH ORDINALITY a(e,n);
 UPDATE public.inventory_owner_state SET inventory_revision=inventory_revision+1 WHERE owner_user_id=owner_id RETURNING inventory_revision INTO revision;
 result:=jsonb_build_object('collectionId',collection,'inventoryRevision',revision,'collectionVersion',0,'layoutRevision',0,
   'changed',true,'slotIds',request->'slotIds','recoverySupported',false);
 IF octet_length(result::text)>1048576 THEN RAISE EXCEPTION 'creation_receipt_too_large' USING ERRCODE='22023'; END IF;
 -- Use 076's recorder. No parallel audit insert and no silent cleanup inverse.
 PERFORM collection_audit_private.command_result(owner_id,result||jsonb_build_object('context',ctx),'collection.create');
 INSERT INTO public.developer_idempotency(actor_id,operation,request_key,input_digest,result,expires_at)
 VALUES(actor,'collection_create_v1',request->>'operationId',digest,result,'infinity');
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION collection_audit_private.create_collection_v1(uuid,uuid,jsonb,jsonb) FROM PUBLIC,anon,authenticated,holo_mcp,service_role;

-- Extend only 082's reviewed dispatch. Preserve its signature/ACL and every existing authorization branch.
DO $gateway$
DECLARE body text;
BEGIN
 SELECT pg_get_functiondef('public.storage_execute_v1(text,uuid,jsonb)'::regprocedure) INTO body;
 IF position('collection_audit_private.create_collection_v1' IN body)=0 THEN
   IF position($anchor$WHEN 'inventory' THEN$anchor$ IN body)=0
     OR position($anchor$operation NOT IN ('inventory','slots','recovery.preview','recovery.apply')$anchor$ IN body)=0 THEN
     RAISE EXCEPTION 'creation_gateway_signature_changed';
   END IF;
   body:=replace(body,$anchor$operation NOT IN ('inventory','slots','recovery.preview','recovery.apply')$anchor$,
     $anchor$operation NOT IN ('inventory','slots','collection.create','recovery.preview','recovery.apply')$anchor$);
   body:=replace(body,$anchor$WHEN 'inventory' THEN$anchor$,
     $new$WHEN 'collection.create' THEN result:=collection_audit_private.create_collection_v1(actor,owner_id,request,ctx);
 WHEN 'inventory' THEN$new$);
   EXECUTE body;
 END IF;
END $gateway$;
NOTIFY pgrst,'reload schema';
COMMIT;
