-- 108: drop the legacy collection model and replace row-trigger audit with per-command audit.
--
-- Every binder is native (105, 107), so the legacy tables, the conversion machinery, old
-- restore/recovery versions and storage_collection_state.authority go. The audit used a row
-- trigger (capture) on every changed row plus a deferred flush that wrote two copies of the
-- delta (changes redacted, recovery_state full). Now each writer collects the before/after of
-- the rows it changed and records ONE collection_activity row itself, with one stored copy in
-- `changes`. Readers project the fields they return; certificates, labels and artwork uploads
-- never leave the server.
--
-- Existing collection_activity rows (pre-108, test data only) are deleted on the first run; a
-- pg_dump taken before applying holds them. Idempotent: a re-run replaces the same functions.
-- Apply after the app that stops calling the dropped functions is deployed.

SET lock_timeout = '5s';

-- 1. Old audit: row capture triggers, the deferred flush and its staging tables.
DO $$
DECLARE t text;
BEGIN
 FOREACH t IN ARRAY ARRAY['binders','user_settings','binder_shares','binder_appearances','inventory_owner_state','storage_collection_state',
   'inventory_items','binder_slots','inventory_placements'] LOOP
   EXECUTE format('DROP TRIGGER IF EXISTS collection_audit_capture ON public.%I',t);
 END LOOP;
END $$;
DROP TABLE IF EXISTS collection_audit_private.deltas;
DROP TABLE IF EXISTS collection_audit_private.pending;

-- 2. Legacy model: tables (their triggers, policies, indexes and grants go with them), the write
--    fence, provenance columns and the authority switch.
DROP TRIGGER IF EXISTS storage_authority_guard ON public.storage_collection_state;
DROP FUNCTION IF EXISTS collection_audit_private.frozen_restore_v1(public.pokemon_collection);
DROP FUNCTION IF EXISTS public.legacy_binder_wants_v1(public.pokemon_collection);
DROP TABLE IF EXISTS public.binder_legacy_rows;
DROP TABLE IF EXISTS public.pokemon_collection;
DROP TABLE IF EXISTS collection_audit_private.legacy_write_fence;
ALTER TABLE public.inventory_items DROP COLUMN IF EXISTS legacy_source;
ALTER TABLE public.storage_collection_state DROP CONSTRAINT IF EXISTS storage_collection_state_check;
ALTER TABLE public.storage_collection_state DROP CONSTRAINT IF EXISTS storage_collection_state_authority_check;
ALTER TABLE public.storage_collection_state DROP COLUMN IF EXISTS authority;
ALTER TABLE public.storage_collection_state DROP COLUMN IF EXISTS conversion_receipt;
ALTER TABLE public.storage_collection_state DROP COLUMN IF EXISTS conversion_version;
ALTER TABLE public.storage_collection_state DROP COLUMN IF EXISTS converted_at;

-- 3. One stored copy. Pre-108 events carried legacy tables and the duplicate column; drop them once.
DO $$
BEGIN
 IF EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='collection_activity' AND column_name='recovery_state') THEN
   TRUNCATE public.collection_activity;
   ALTER TABLE public.collection_activity DROP COLUMN recovery_state, DROP COLUMN pokemon_id, DROP COLUMN pokemon_name,
     DROP COLUMN before_state, DROP COLUMN after_state;
   ALTER TABLE public.collection_activity ALTER COLUMN action SET DEFAULT 'collection_change';
 END IF;
END $$;

-- 4. Functions with no remaining caller (app or SQL).
DROP FUNCTION IF EXISTS public.analytics_collection_identity(jsonb);
DROP FUNCTION IF EXISTS public.analytics_collection_state(jsonb);
DROP FUNCTION IF EXISTS public.assign_pokemon_collection_binder();
DROP FUNCTION IF EXISTS public.collection_recovery_v1(text,uuid,jsonb);
DROP FUNCTION IF EXISTS public.convert_legacy_binder_v1(uuid,uuid,text);
DROP FUNCTION IF EXISTS public.developer_delete_collection(uuid,uuid,uuid,integer,jsonb);
DROP FUNCTION IF EXISTS public.enforce_collection_billing();
DROP FUNCTION IF EXISTS public.guard_legacy_binder_write_v1();
DROP FUNCTION IF EXISTS public.guard_storage_authority_v1();
DROP FUNCTION IF EXISTS public.inventory_grid_read_v1();
DROP FUNCTION IF EXISTS public.legacy_binder_evidence_v1(uuid);
DROP FUNCTION IF EXISTS public.legacy_binder_slot_id_v1(uuid,integer);
DROP FUNCTION IF EXISTS public.record_collection_activity();
DROP FUNCTION IF EXISTS public.save_collection_with_acquisition(uuid,uuid,uuid,integer,jsonb,jsonb,jsonb,text);
DROP FUNCTION IF EXISTS public.set_pokemon_collection_updated_at();
DROP FUNCTION IF EXISTS public.slot_page_v1(uuid,uuid,uuid,integer,bigint,bigint,bigint,bigint);
DROP FUNCTION IF EXISTS collection_audit_private.activate_legacy_write_fence();
DROP FUNCTION IF EXISTS collection_audit_private.capture();
DROP FUNCTION IF EXISTS collection_audit_private.command_result(uuid,jsonb,text);
DROP FUNCTION IF EXISTS collection_audit_private.converted_dependencies_v1(uuid,bigint,jsonb,uuid[]);
DROP FUNCTION IF EXISTS collection_audit_private.flush();
DROP FUNCTION IF EXISTS collection_audit_private.guard_legacy_write_row();
DROP FUNCTION IF EXISTS collection_audit_private.guard_legacy_write_statement();
DROP FUNCTION IF EXISTS collection_audit_private.keep_legacy_write_fence();
DROP FUNCTION IF EXISTS collection_audit_private.legacy_recovery_preview(uuid,uuid,bigint);
DROP FUNCTION IF EXISTS collection_audit_private.legacy_write_enforced();
DROP FUNCTION IF EXISTS collection_audit_private.redact(jsonb);
DROP FUNCTION IF EXISTS collection_audit_private.restore_raw_content_v1(uuid,uuid,jsonb,jsonb);
DROP FUNCTION IF EXISTS collection_audit_private.restore_raw_content_v2(uuid,uuid,jsonb,jsonb);
DROP FUNCTION IF EXISTS collection_audit_private.restore_raw_content_v3(uuid,uuid,jsonb,jsonb);

-- 5. Per-command audit and every writer rewritten against the native tables only.
-- ---------------------------------------------------------------------------
-- Per-command audit. Each writer collects the before/after of the rows it
-- changed (RETURNING, joined to the statement snapshot for the old row) and
-- records ONE collection_activity row itself. No row triggers, no staging.
-- ---------------------------------------------------------------------------

-- One changed row in the stored audit shape: {table, id, before, after}, timestamps dropped.
CREATE OR REPLACE FUNCTION collection_audit_private.delta(table_name text, before_row jsonb, after_row jsonb)
 RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path TO ''
AS $function$
 SELECT jsonb_build_object('table',table_name,
   'id',coalesce(r->>'id',r->>'inventory_item_id',r->>'collection_id',r->>'owner_user_id',r->>'user_id'),
   'before',collection_audit_private.state(table_name,before_row),'after',collection_audit_private.state(table_name,after_row))
 FROM (SELECT coalesce(after_row,before_row) r) x
$function$;

-- Merge a writer's changes per row (first before, last after), drop no-ops and write one event.
CREATE OR REPLACE FUNCTION collection_audit_private.record_v1(owner_id uuid, ctx jsonb, action text, changes jsonb[], evidence jsonb, recovery_of bigint)
 RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE delta jsonb; ids jsonb; event_id bigint;
BEGIN
 SELECT jsonb_agg(jsonb_build_object('table',t,'id',k,'before',b,'after',a) ORDER BY t||'/'||k) INTO delta FROM (
   SELECT v->>'table' t,v->>'id' k,(array_agg(v->'before' ORDER BY n))[1] b,(array_agg(v->'after' ORDER BY n DESC))[1] a
   FROM unnest(changes) WITH ORDINALITY u(v,n) GROUP BY 1,2) merged WHERE b IS DISTINCT FROM a;
 IF delta IS NULL OR NOT EXISTS(SELECT 1 FROM auth.users WHERE id=owner_id) THEN RETURN NULL; END IF;
 IF jsonb_array_length(delta)>16384 OR octet_length(delta::text)>16777216 THEN RAISE EXCEPTION 'audit_evidence_too_large'; END IF;
 SELECT jsonb_build_object(
 'inventoryItemIds',(SELECT coalesce(jsonb_agg(DISTINCT id ORDER BY id),'[]') FROM (
   SELECT v->>'id' id FROM jsonb_array_elements(delta) v WHERE v->>'table'='inventory_items'
   UNION SELECT v->'before'->>'inventory_item_id' FROM jsonb_array_elements(delta) v WHERE v->>'table'='inventory_placements'
   UNION SELECT v->'after'->>'inventory_item_id' FROM jsonb_array_elements(delta) v WHERE v->>'table'='inventory_placements'
   UNION SELECT jsonb_array_elements_text(coalesce(ctx->'affectedEntities'->'inventoryItemIds','[]'))) touched WHERE id IS NOT NULL),
 'slotIds',(SELECT coalesce(jsonb_agg(DISTINCT id ORDER BY id),'[]') FROM (
   SELECT v->>'id' id FROM jsonb_array_elements(delta) v WHERE v->>'table'='binder_slots'
   UNION SELECT v->'before'->>'slot_id' FROM jsonb_array_elements(delta) v WHERE v->>'table'='inventory_placements'
   UNION SELECT v->'after'->>'slot_id' FROM jsonb_array_elements(delta) v WHERE v->>'table'='inventory_placements'
   UNION SELECT jsonb_array_elements_text(coalesce(ctx->'affectedEntities'->'slotIds','[]'))) touched WHERE id IS NOT NULL),
 'collectionIds',(SELECT coalesce(jsonb_agg(DISTINCT id ORDER BY id),'[]') FROM (
   SELECT coalesce(v->'after'->>'collection_id',v->'before'->>'collection_id',v->'after'->>'binder_id',v->'before'->>'binder_id',
     CASE WHEN v->>'table'='binders' THEN v->>'id' END) id FROM jsonb_array_elements(delta) v
   UNION SELECT jsonb_array_elements_text(coalesce(ctx->'affectedEntities'->'collectionIds','[]'))) touched WHERE id IS NOT NULL)) INTO ids;
 INSERT INTO public.collection_activity(owner_user_id,recorded_at,format_version,actor_kind,actor_user_id,actor_job,source,client_id,operation_id,batch_id,
   client_occurred_at,action,affected_entities,changes,command_evidence,recovery_of_event_id)
 VALUES(owner_id,clock_timestamp(),1,coalesce(ctx->'actor'->>'kind','unknown'),(ctx->'actor'->>'userId')::uuid,ctx->'actor'->>'job',coalesce(ctx->>'source','unknown'),
   ctx->>'clientId',ctx->>'operationId',ctx->>'batchId',(ctx->>'clientOccurredAt')::timestamptz,coalesce(action,'collection_change'),ids,delta,evidence,recovery_of)
 RETURNING id INTO event_id;
 RETURN event_id;
END $function$;

-- A storage command's event: its context, action and compact before/after evidence.
CREATE OR REPLACE FUNCTION collection_audit_private.command_result(owner_id uuid, result jsonb, action text, changes jsonb[])
 RETURNS bigint LANGUAGE sql SET search_path TO ''
AS $function$
 SELECT collection_audit_private.record_v1(owner_id,result->'context',action,changes,
   jsonb_build_object('before',(SELECT coalesce(jsonb_agg(v->'before'),'[]') FROM jsonb_array_elements(coalesce(result->'evidence','[]')) v),
     'after',result->'after','inventoryRevision',result->'inventoryRevision','acquiredItemIds',result->'acquiredItemIds','selectedItemIds',result->'selectedItemIds'),NULL)
$function$;

-- Writers outside the storage commands (binder rename, reorder, layout, sharing, appearance,
-- settings saves through PostgREST) record one event per statement. Storage commands set
-- collection_audit.command for their transaction and record their own single event instead.
CREATE OR REPLACE FUNCTION collection_audit_private.record_statement()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE owner_id uuid; changes jsonb[]; owned jsonb[];
BEGIN
 IF current_setting('collection_audit.command',true)='on' THEN RETURN NULL; END IF;
 IF TG_OP='INSERT' THEN
   SELECT array_agg(collection_audit_private.delta(TG_TABLE_NAME,NULL,to_jsonb(n))) INTO changes FROM new_rows n;
 ELSIF TG_OP='DELETE' THEN
   SELECT array_agg(collection_audit_private.delta(TG_TABLE_NAME,to_jsonb(o),NULL)) INTO changes FROM old_rows o;
 ELSE
   SELECT array_agg(collection_audit_private.delta(TG_TABLE_NAME,o.r,n.r)) INTO changes
   FROM (SELECT to_jsonb(x) r FROM old_rows x) o JOIN (SELECT to_jsonb(x) r FROM new_rows x) n
     ON coalesce(o.r->>'id',o.r->>'owner_user_id')=coalesce(n.r->>'id',n.r->>'owner_user_id');
 END IF;
 FOR owner_id,owned IN
   SELECT coalesce(d->'after'->>'owner_user_id',d->'after'->>'user_id',d->'before'->>'owner_user_id',d->'before'->>'user_id')::uuid,array_agg(d)
   FROM unnest(changes) d GROUP BY 1
 LOOP
   PERFORM collection_audit_private.record_v1(owner_id,collection_audit_private.context(owner_id),NULL,owned,NULL,NULL);
 END LOOP;
 RETURN NULL;
END $function$;

CREATE OR REPLACE FUNCTION public.storage_execute_v1(operation text, owner_id uuid, request jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
 SET lock_timeout TO '3s'
 SET statement_timeout TO '10s'
AS $function$
DECLARE ctx jsonb; actor uuid; intent jsonb; result jsonb; membership public.partnerships;
BEGIN
 -- SECURITY DEFINER changes current_user. PostgREST's active role is the trust boundary.
 IF current_setting('role',true) IS DISTINCT FROM 'service_role' THEN
   RAISE EXCEPTION 'storage_access_denied' USING ERRCODE='42501';
 END IF;
 ctx:=collection_audit_private.context(owner_id);
 IF ctx->'actor'->>'kind' IS DISTINCT FROM 'user' OR NOT coalesce(ctx->>'source' IN ('app','rest','mcp'),false) THEN
   RAISE EXCEPTION 'storage_access_denied' USING ERRCODE='42501';
 END IF;
 actor:=(ctx->'actor'->>'userId')::uuid;
 -- Lock current membership before entering any executor's 4701 advisory locks.
 SELECT * INTO membership FROM public.partnerships WHERE actor IN(user1_id,user2_id) FOR KEY SHARE;
 IF owner_id IS NULL OR actor IS NULL
   OR owner_id IS DISTINCT FROM (CASE WHEN membership.owner_user_id IS NOT NULL AND public.billing_partner_allowed(membership.owner_user_id,actor) THEN membership.owner_user_id ELSE actor END)
   OR (actor<>owner_id AND (membership.id IS NULL OR membership.owner_user_id<>owner_id))
   OR NOT public.billing_partner_allowed(owner_id,actor) THEN
   RAISE EXCEPTION 'storage_access_denied' USING ERRCODE='42501';
 END IF;
 -- A trial or disabled app billing enforcement never grants developer access.
 IF ctx->>'source' IN ('rest','mcp') AND NOT (
   EXISTS(SELECT 1 FROM public.perpetual_licences p WHERE p.owner_user_id=storage_execute_v1.owner_id)
   OR EXISTS(SELECT 1 FROM public.billing_accounts b WHERE b.owner_user_id=storage_execute_v1.owner_id
     AND b.status IN ('active','past_due') AND b.paid_through>now())) THEN
   RAISE EXCEPTION 'premium_required' USING ERRCODE='HF402';
 END IF;
 IF operation NOT IN ('inventory','slots','backup.restore.raw','backup.arrangement','collection.create','recovery.preview','recovery.apply','recovery.preview.v2','recovery.apply.v2') OR operation IS NULL
   OR request IS NULL OR jsonb_typeof(request)<>'object' OR octet_length(request::text)>8388608 THEN
   RAISE EXCEPTION 'invalid_storage_request' USING ERRCODE='22023';
 END IF;
 -- The server binds the parsed original ID; the header's retry-stable intent is never caller JSON.
 IF operation NOT IN ('recovery.preview','recovery.preview.v2') AND ctx->>'operationId' IS DISTINCT FROM request->>'operationId' THEN
   RAISE EXCEPTION 'storage_operation_mismatch' USING ERRCODE='42501';
 END IF;
 intent:=jsonb_build_object('source',ctx->'source','clientId',ctx->'clientId','batchId',ctx->'batchId','clientOccurredAt',NULL);
 -- Commands record their own single audit event; statement-level recorders stay quiet.
 PERFORM set_config('collection_audit.command','on',true);
 CASE operation
 WHEN 'backup.restore.raw' THEN
   IF request->'version' IS DISTINCT FROM '4'::jsonb THEN
     RAISE EXCEPTION 'unsupported_raw_restore_version' USING ERRCODE='22023'; END IF;
   PERFORM 1 FROM public.partnerships WHERE actor IN(user1_id,user2_id) FOR SHARE;
   PERFORM pg_advisory_xact_lock(hashtextextended(owner_id::text,6102));
   PERFORM pg_advisory_xact_lock(hashtextextended(owner_id::text,4701));
   IF EXISTS(SELECT 1 FROM public.developer_idempotency l WHERE l.actor_id=actor AND l.request_key=request->>'operationId'
     AND l.operation IN ('raw_content_restore_v1','raw_content_restore_v2','raw_content_restore_v3')) THEN
     RAISE EXCEPTION 'idempotency_conflict' USING ERRCODE='40001'; END IF;
   result:=collection_audit_private.restore_raw_content_v4(actor,owner_id,request,ctx);
 WHEN 'backup.arrangement' THEN result:=collection_audit_private.execute_creation_import_v1(operation,actor,owner_id,request,ctx);
 WHEN 'collection.create' THEN result:=collection_audit_private.execute_creation_import_v1(operation,actor,owner_id,request,ctx);
 WHEN 'inventory','slots' THEN result:=collection_audit_private.execute_command_v1(operation,actor,owner_id,request,intent);
 WHEN 'recovery.preview' THEN
   IF NOT public.inventory_object_v1(request,ARRAY['eventId','restoreUnassignedItemIds']) OR (SELECT count(*) FROM jsonb_object_keys(request))<>2
     OR jsonb_typeof(request->'eventId') IS DISTINCT FROM 'string' OR (request->>'eventId')!~'^[1-9][0-9]{0,18}$'
     OR (request->>'eventId')::numeric>9223372036854775807 OR jsonb_typeof(request->'restoreUnassignedItemIds') IS DISTINCT FROM 'array'
     OR jsonb_array_length(request->'restoreUnassignedItemIds')>16384 OR octet_length(request::text)>1048576
     OR EXISTS(SELECT 1 FROM jsonb_array_elements(request->'restoreUnassignedItemIds') v WHERE NOT public.inventory_id_v1(v)) THEN
     RAISE EXCEPTION 'invalid_recovery_request' USING ERRCODE='22023';
   END IF;
   result:=collection_audit_private.recovery_preview_v1(actor,owner_id,(request->>'eventId')::bigint,
     ARRAY(SELECT jsonb_array_elements_text(request->'restoreUnassignedItemIds')));
 WHEN 'recovery.apply' THEN result:=collection_audit_private.execute_recovery_v1(operation,actor,owner_id,request,intent);
 WHEN 'recovery.preview.v2' THEN result:=collection_audit_private.recovery_preview_v2(actor,owner_id,request);
 WHEN 'recovery.apply.v2' THEN result:=collection_audit_private.execute_recovery_v1(operation,actor,owner_id,request,intent);
 END CASE;
 IF result IS NULL OR octet_length(result::text)>16777216 THEN RAISE EXCEPTION 'storage_result_unavailable' USING ERRCODE='55000'; END IF;
 RETURN result;
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
 changes jsonb[]:='{}'; hit boolean;
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
 -- Owner-wide write lock. No command scans/locks other owners.
 PERFORM pg_advisory_xact_lock(hashtextextended(owner_id::text,4701));
 SELECT inventory_revision INTO revision FROM public.inventory_owner_state WHERE owner_user_id=owner_id FOR UPDATE;
 IF revision IS NULL THEN RAISE EXCEPTION 'slot_storage_unavailable' USING ERRCODE='55000'; END IF;
 PERFORM 1 FROM public.binders WHERE id=collection AND owner_user_id=owner_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'slot_access_denied' USING ERRCODE='42501'; END IF;
 SELECT * INTO state FROM public.storage_collection_state WHERE collection_id=collection AND owner_user_id=owner_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'slot_storage_unavailable' USING ERRCODE='55000'; END IF;
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
         WITH i AS (INSERT INTO public.binder_slots(id,owner_user_id,collection_id,position) VALUES(key,owner_id,collection,cardinality(ordered)) RETURNING *)
         SELECT changes||array_agg(collection_audit_private.delta('binder_slots',NULL,to_jsonb(i))) INTO changes FROM i;
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
     WITH u AS (UPDATE public.binder_slots SET target=CASE WHEN command ? 'target' THEN nullif(command->'target','null') ELSE target END,
       wanted_cards=CASE WHEN command ? 'wantedCards' THEN wants ELSE wanted_cards END,version=version+1,updated_at=clock_timestamp()
       WHERE id=key AND owner_user_id=owner_id AND collection_id=collection
       AND ((command ? 'target' AND target IS DISTINCT FROM nullif(command->'target','null'))
         OR (command ? 'wantedCards' AND wanted_cards IS DISTINCT FROM wants)) RETURNING *)
     SELECT changes||array_agg(collection_audit_private.delta('binder_slots',to_jsonb(o),to_jsonb(u))),count(*)>0 INTO changes,hit
     FROM u JOIN public.binder_slots o ON o.id=u.id;
     changed:=changed OR hit;
   ELSE
     FOR ref IN SELECT jsonb_array_elements(command->'slots') LOOP
       key:=ref->>'id';
       IF kind='clear' THEN
         WITH d AS (DELETE FROM public.inventory_placements WHERE slot_id=key AND owner_user_id=owner_id RETURNING *)
         SELECT changes||array_agg(collection_audit_private.delta('inventory_placements',to_jsonb(d),NULL)),count(*)>0 INTO changes,hit FROM d;
         IF hit THEN
           WITH u AS (UPDATE public.binder_slots SET status=NULL,version=version+1,updated_at=clock_timestamp() WHERE id=key AND owner_user_id=owner_id RETURNING *)
           SELECT changes||array_agg(collection_audit_private.delta('binder_slots',to_jsonb(o),to_jsonb(u))) INTO changes FROM u JOIN public.binder_slots o ON o.id=u.id;
           changed:=true;
         END IF;
       ELSE
         IF ref->'inventoryItemId'<>'null' THEN
           retained_copy_versions:=retained_copy_versions||jsonb_build_array(jsonb_build_object('id',ref->'inventoryItemId','version',ref->'itemVersion'));
         END IF;
         -- Unassign first (what the placement FK cascade would do); the inventory item is never deleted.
         WITH d AS (DELETE FROM public.inventory_placements WHERE slot_id=key AND owner_user_id=owner_id AND collection_id=collection RETURNING *)
         SELECT changes||array_agg(collection_audit_private.delta('inventory_placements',to_jsonb(d),NULL)) INTO changes FROM d;
         WITH d AS (DELETE FROM public.binder_slots WHERE id=key AND owner_user_id=owner_id AND collection_id=collection RETURNING *)
         SELECT changes||array_agg(collection_audit_private.delta('binder_slots',to_jsonb(d),NULL)) INTO changes FROM d;
         ordered:=array_remove(ordered,key); removed:=array_append(removed,key); structural:=true; changed:=true;
       END IF;
     END LOOP;
   END IF;
 END LOOP;
 IF structural THEN
   WITH u AS (UPDATE public.binder_slots s SET position=o.position-1 FROM unnest(ordered) WITH ORDINALITY o(id,position)
     WHERE s.id=o.id AND s.collection_id=collection AND s.owner_user_id=owner_id AND s.position<>o.position-1 RETURNING s.*)
   SELECT changes||array_agg(collection_audit_private.delta('binder_slots',to_jsonb(p),to_jsonb(u))) INTO changes FROM u JOIN public.binder_slots p ON p.id=u.id;
 END IF;
 IF saved_before IS NOT NULL AND public.billing_enforced() AND NOT public.billing_has_paid(owner_id) AND public.slot_saved_count_v1(owner_id)>saved_before THEN
   SELECT free_card_limit INTO allowed FROM public.billing_configuration WHERE id;
   IF public.slot_saved_count_v1(owner_id)>coalesce(allowed,10) THEN RAISE EXCEPTION 'card_limit_reached'; END IF;
 END IF;
 IF changed THEN
   WITH u AS (UPDATE public.inventory_owner_state SET inventory_revision=inventory_revision+1 WHERE owner_user_id=owner_id RETURNING *)
   SELECT max(u.inventory_revision),changes||array_agg(collection_audit_private.delta('inventory_owner_state',to_jsonb(o),to_jsonb(u))) INTO revision,changes
   FROM u JOIN public.inventory_owner_state o ON o.owner_user_id=u.owner_user_id;
   WITH u AS (UPDATE public.storage_collection_state SET version=version+1,layout_revision=layout_revision+CASE WHEN structural THEN 1 ELSE 0 END
     WHERE collection_id=collection AND owner_user_id=owner_id RETURNING *)
   SELECT changes||array_agg(collection_audit_private.delta('storage_collection_state',to_jsonb(o),to_jsonb(u))) INTO changes
   FROM u JOIN public.storage_collection_state o ON o.collection_id=u.collection_id;
   SELECT * INTO state FROM public.storage_collection_state WHERE collection_id=collection AND owner_user_id=owner_id;
 END IF;
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
 PERFORM collection_audit_private.command_result(owner_id,result,'slots'||'.'||CASE WHEN jsonb_array_length(request->'commands')=1 THEN request->'commands'->0->>'kind' ELSE 'bulk' END,changes);
 INSERT INTO public.developer_idempotency(actor_id,operation,request_key,input_digest,result,expires_at)
 VALUES(actor,'binder_slots_v1',request->>'operationId',digest,result,'infinity');
 RETURN result;
END $function$;

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
 insert_order text[]; insert_index integer; insert_work integer:=0; changes jsonb[]:='{}';
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
   IF NOT FOUND THEN RAISE EXCEPTION 'inventory_storage_unavailable' USING ERRCODE='55000'; END IF;
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
     IF NOT collection=ANY(declared_collections) THEN RAISE EXCEPTION 'inventory_access_denied' USING ERRCODE='42501'; END IF;
     IF EXISTS(SELECT 1 FROM public.binder_slots WHERE id=command->>'slotId') THEN RAISE EXCEPTION 'slot_conflict' USING ERRCODE='40001'; END IF;
     SELECT coalesce(array_agg(id ORDER BY position,id),'{}') INTO insert_order FROM public.binder_slots WHERE collection_id=(command->>'collectionId')::uuid AND owner_user_id=owner_id;
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
     IF NOT collection=ANY(declared_collections) THEN RAISE EXCEPTION 'inventory_access_denied' USING ERRCODE='42501'; END IF;
     IF NOT EXISTS(SELECT 1 FROM public.binders WHERE id=(command->>'collectionId')::uuid AND owner_user_id=owner_id) THEN RAISE EXCEPTION 'inventory_access_denied' USING ERRCODE='42501'; END IF;
     collections:=ARRAY[collection];
     IF EXISTS(SELECT 1 FROM public.binders WHERE id=(command->>'collectionId')::uuid AND owner_user_id=owner_id AND is_default) THEN
       IF command->'replacementDefaultCollectionId'='null' OR NOT (command->>'replacementDefaultCollectionId')::uuid=ANY(declared_collections)
         OR command->>'replacementDefaultCollectionId'=collection::text
         OR NOT EXISTS(SELECT 1 FROM public.binders WHERE id=(command->>'replacementDefaultCollectionId')::uuid AND owner_user_id=owner_id) THEN RAISE EXCEPTION 'inventory_default_replacement_required' USING ERRCODE='22023'; END IF;
       collections:=array_append(collections,(command->>'replacementDefaultCollectionId')::uuid);
     ELSIF command->'replacementDefaultCollectionId'<>'null' THEN RAISE EXCEPTION 'invalid_inventory_command' USING ERRCODE='22023'; END IF;
     FOR ref IN SELECT jsonb_array_elements(command->'slots') LOOP
       PERFORM public.slot_check_ref_v1(owner_id,collection,ref); slots:=array_append(slots,ref->>'id');
     END LOOP;
     IF cardinality(slots)<>(SELECT count(*) FROM public.binder_slots WHERE collection_id=(command->>'collectionId')::uuid AND owner_user_id=owner_id) THEN RAISE EXCEPTION 'slot_conflict' USING ERRCODE='40001'; END IF;
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
     WITH u AS (UPDATE public.binder_slots s SET position=x.ordinality-1 FROM unnest(insert_order) WITH ORDINALITY x(id,ordinality)
       WHERE s.id=x.id AND s.collection_id=(command->>'collectionId')::uuid AND s.owner_user_id=owner_id AND s.position<>x.ordinality-1 RETURNING s.*)
     SELECT changes||array_agg(collection_audit_private.delta('binder_slots',to_jsonb(o),to_jsonb(u))) INTO changes FROM u JOIN public.binder_slots o ON o.id=u.id;
     WITH i AS (INSERT INTO public.binder_slots(id,owner_user_id,collection_id,position,target,status,version)
       VALUES(command->>'slotId',owner_id,collection,insert_index-1,nullif(command->'target','null'),CASE WHEN chosen.id IS NULL THEN NULL ELSE 'collected' END,CASE WHEN chosen.id IS NULL THEN 0 ELSE 1 END) RETURNING *)
     SELECT changes||array_agg(collection_audit_private.delta('binder_slots',NULL,to_jsonb(i))) INTO changes FROM i;
     IF chosen.id IS NOT NULL THEN
       IF chosen.id=ANY(acquired_ids) THEN
         WITH i AS (INSERT INTO public.inventory_items(id,owner_user_id,identity,grading,acquired_at) VALUES(chosen.id,owner_id,chosen.identity,chosen.grading,chosen.acquired_at) RETURNING *)
         SELECT changes||array_agg(collection_audit_private.delta('inventory_items',NULL,to_jsonb(i))) INTO changes FROM i;
       END IF;
       WITH i AS (INSERT INTO public.inventory_placements(inventory_item_id,owner_user_id,collection_id,slot_id,version)
         VALUES(chosen.id,owner_id,collection,command->>'slotId',0) RETURNING *)
       SELECT changes||array_agg(collection_audit_private.delta('inventory_placements',NULL,to_jsonb(i))) INTO changes FROM i;
     END IF;
     structural_collections:=structural_collections||collections;
   END IF;
   IF kind='add' OR (kind='assign' AND chosen.id=ANY(acquired_ids)) THEN
     WITH i AS (INSERT INTO public.inventory_items(id,owner_user_id,identity,grading,acquired_at) VALUES(chosen.id,owner_id,chosen.identity,chosen.grading,chosen.acquired_at) RETURNING *)
     SELECT changes||array_agg(collection_audit_private.delta('inventory_items',NULL,to_jsonb(i))) INTO changes FROM i;
   END IF;
   IF kind='edit' AND effective THEN
     WITH u AS (UPDATE public.inventory_items SET grading=nullif(command->'grading','null'),version=version+1,updated_at=now() WHERE id=chosen.id AND owner_user_id=owner_id RETURNING *)
     SELECT changes||array_agg(collection_audit_private.delta('inventory_items',to_jsonb(o),to_jsonb(u))) INTO changes FROM u JOIN public.inventory_items o ON o.id=u.id;
   ELSIF kind IN ('unassign','removeOwned','move','assign') THEN
     WITH d AS (DELETE FROM public.inventory_placements WHERE owner_user_id=owner_id AND inventory_item_id=ANY(items) RETURNING *)
     SELECT changes||array_agg(collection_audit_private.delta('inventory_placements',to_jsonb(d),NULL)) INTO changes FROM d;
     WITH u AS (UPDATE public.binder_slots SET status=NULL,version=version+1,updated_at=now() WHERE owner_user_id=owner_id AND id=ANY(slots) RETURNING *)
     SELECT changes||array_agg(collection_audit_private.delta('binder_slots',to_jsonb(o),to_jsonb(u))) INTO changes FROM u JOIN public.binder_slots o ON o.id=u.id;
     IF kind IN ('move','assign') THEN
       WITH i AS (INSERT INTO public.inventory_placements(inventory_item_id,owner_user_id,collection_id,slot_id,version)
       VALUES(chosen.id,owner_id,(dest->>'collectionId')::uuid,dest->'slot'->>'id',CASE WHEN kind='move' THEN placement.version+1 ELSE 0 END) RETURNING *)
       SELECT changes||array_agg(collection_audit_private.delta('inventory_placements',NULL,to_jsonb(i))) INTO changes FROM i;
       WITH u AS (UPDATE public.binder_slots SET status='collected',wanted_cards=CASE WHEN command->'fulfillWant'='null' THEN wanted_cards ELSE wanted_cards-(command->'fulfillWant'->>'index')::integer END
       WHERE id=dest->'slot'->>'id' AND owner_user_id=owner_id RETURNING *)
       SELECT changes||array_agg(collection_audit_private.delta('binder_slots',to_jsonb(o),to_jsonb(u))) INTO changes FROM u JOIN public.binder_slots o ON o.id=u.id;
       IF command->>'occupied'='swap' THEN
         WITH i AS (INSERT INTO public.inventory_placements(inventory_item_id,owner_user_id,collection_id,slot_id,version)
         VALUES(displaced.id,owner_id,placement.collection_id,placement.slot_id,dest_placement.version+1) RETURNING *)
         SELECT changes||array_agg(collection_audit_private.delta('inventory_placements',NULL,to_jsonb(i))) INTO changes FROM i;
         WITH u AS (UPDATE public.binder_slots SET status='collected' WHERE id=placement.slot_id AND owner_user_id=owner_id RETURNING *)
         SELECT changes||array_agg(collection_audit_private.delta('binder_slots',to_jsonb(o),to_jsonb(u))) INTO changes FROM u JOIN public.binder_slots o ON o.id=u.id;
       END IF;
     ELSIF kind='removeOwned' THEN
       -- Future persisted non-owning references must compose their clearing here (#377/#394).
       WITH d AS (DELETE FROM public.inventory_items WHERE id=chosen.id AND owner_user_id=owner_id RETURNING *)
       SELECT changes||array_agg(collection_audit_private.delta('inventory_items',to_jsonb(d),NULL)) INTO changes FROM d;
     END IF;
   ELSIF kind='removeSlots' THEN
     -- Unassign first (what the placement FK cascade would do), so the event records it.
     WITH d AS (DELETE FROM public.inventory_placements WHERE owner_user_id=owner_id AND slot_id=ANY(slots) RETURNING *)
     SELECT changes||array_agg(collection_audit_private.delta('inventory_placements',to_jsonb(d),NULL)) INTO changes FROM d;
     WITH d AS (DELETE FROM public.binder_slots WHERE owner_user_id=owner_id AND id=ANY(slots) RETURNING *)
     SELECT changes||array_agg(collection_audit_private.delta('binder_slots',to_jsonb(d),NULL)) INTO changes FROM d;
     structural_collections:=structural_collections||collections;
   ELSIF kind='deleteCollection' THEN
     -- Releases slots/placements, never inventory. Children go first (what the FK cascades
     -- would do), so the event records every removed row.
     WITH d AS (DELETE FROM public.inventory_placements WHERE owner_user_id=owner_id AND collection_id=(command->>'collectionId')::uuid RETURNING *)
     SELECT changes||array_agg(collection_audit_private.delta('inventory_placements',to_jsonb(d),NULL)) INTO changes FROM d;
     WITH d AS (DELETE FROM public.binder_slots WHERE owner_user_id=owner_id AND collection_id=(command->>'collectionId')::uuid RETURNING *)
     SELECT changes||array_agg(collection_audit_private.delta('binder_slots',to_jsonb(d),NULL)) INTO changes FROM d;
     WITH d AS (DELETE FROM public.binder_shares WHERE owner_user_id=owner_id AND binder_id=(command->>'collectionId')::uuid RETURNING *)
     SELECT changes||array_agg(collection_audit_private.delta('binder_shares',to_jsonb(d),NULL)) INTO changes FROM d;
     WITH d AS (DELETE FROM public.storage_collection_state WHERE owner_user_id=owner_id AND collection_id=(command->>'collectionId')::uuid RETURNING *)
     SELECT changes||array_agg(collection_audit_private.delta('storage_collection_state',to_jsonb(d),NULL)) INTO changes FROM d;
     WITH d AS (DELETE FROM public.binders WHERE id=(command->>'collectionId')::uuid AND owner_user_id=owner_id RETURNING *)
     SELECT changes||array_agg(collection_audit_private.delta('binders',to_jsonb(d),NULL)) INTO changes FROM d;
     IF command->'replacementDefaultCollectionId'<>'null' THEN
       WITH u AS (UPDATE public.binders SET is_default=true WHERE id=(command->>'replacementDefaultCollectionId')::uuid AND owner_user_id=owner_id RETURNING *)
       SELECT changes||array_agg(collection_audit_private.delta('binders',to_jsonb(o),to_jsonb(u))) INTO changes FROM u JOIN public.binders o ON o.id=u.id;
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
   WITH u AS (UPDATE public.inventory_owner_state SET inventory_revision=inventory_revision+1 WHERE owner_user_id=owner_id RETURNING *)
   SELECT max(u.inventory_revision),changes||array_agg(collection_audit_private.delta('inventory_owner_state',to_jsonb(o),to_jsonb(u))) INTO revision,changes FROM u JOIN public.inventory_owner_state o ON o.owner_user_id=u.owner_user_id;
   WITH u AS (UPDATE public.storage_collection_state SET version=version+1,layout_revision=layout_revision+CASE WHEN collection_id=ANY(structural_collections) THEN 1 ELSE 0 END
   WHERE owner_user_id=owner_id AND collection_id=ANY(changed_collections) RETURNING *)
   SELECT changes||array_agg(collection_audit_private.delta('storage_collection_state',to_jsonb(o),to_jsonb(u))) INTO changes FROM u JOIN public.storage_collection_state o ON o.collection_id=u.collection_id;
 END IF;
 context:=jsonb_build_object('actor',jsonb_build_object('kind','user','userId',actor),'source',trusted_intent->'source','clientId',trusted_intent->'clientId',
   'operationId',request->'operationId','batchId',trusted_intent->'batchId','clientOccurredAt',trusted_intent->'clientOccurredAt',
   'affectedEntities',jsonb_build_object('inventoryItemIds',(SELECT coalesce(jsonb_agg(DISTINCT i ORDER BY i),'[]') FROM unnest(all_items) i),
     'slotIds',(SELECT coalesce(jsonb_agg(DISTINCT s ORDER BY s),'[]') FROM unnest(all_slots) s),
     'collectionIds',(SELECT coalesce(jsonb_agg(DISTINCT c ORDER BY c),'[]') FROM unnest(all_collections) c)));
 result:=jsonb_build_object('inventoryRevision',revision,'changed',changed,'selectedItemIds',selected_ids,'acquiredItemIds',acquired_ids,
   'context',context,'evidence',to_jsonb(evidence),'after',public.inventory_evidence_v1(owner_id,all_items,all_slots,all_collections));
 IF octet_length(result::text)>(CASE WHEN whole_collection_delete THEN 16777216 ELSE 1048576 END) THEN RAISE EXCEPTION 'inventory_result_too_large_reduce_batch' USING ERRCODE='22023'; END IF;
 PERFORM collection_audit_private.command_result(owner_id,result,'inventory'||'.'||CASE WHEN jsonb_array_length(request->'commands')=1 THEN request->'commands'->0->>'kind' ELSE 'bulk' END,changes);
 INSERT INTO public.developer_idempotency(actor_id,operation,request_key,input_digest,result,expires_at)
 VALUES(actor,'inventory_v1',request->>'operationId',digest,result,'infinity');
 RETURN result;
EXCEPTION WHEN invalid_text_representation OR invalid_datetime_format OR datetime_field_overflow OR numeric_value_out_of_range THEN
 RAISE EXCEPTION 'invalid_inventory_command' USING ERRCODE='22023';
END $function$;

CREATE OR REPLACE FUNCTION collection_audit_private.restore_raw_content_v4(actor uuid, owner_id uuid, request jsonb, ctx jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
 SET lock_timeout TO '3s'
 SET statement_timeout TO '10s'
AS $function$
DECLARE membership public.partnerships; live_partner uuid; prior public.developer_idempotency; digest text;
 collection uuid; binder_row public.binders; settings_row public.user_settings; state public.storage_collection_state; revision bigint; pair jsonb; desired jsonb; ref jsonb;
 slot public.binder_slots; item public.inventory_items; want jsonb; member text; card public.tcg_cards;
 ids text[]:='{}'; selected text[]:='{}'; desired_ids text[]:='{}'; required text[]:='{}'; released text[]:='{}';
 work integer:=0; changes jsonb[]:='{}'; saved_before bigint; allowed integer; result jsonb; predicate_state text; prospective jsonb; actual jsonb; event_id bigint; inverse_plan jsonb; layout_delta integer;
BEGIN
 -- Lock live membership before the common owner locks. Scope fields are preconditions only.
 SELECT * INTO membership FROM public.partnerships WHERE actor IN(user1_id,user2_id) FOR SHARE;
 IF actor IS NULL OR owner_id IS NULL OR owner_id IS DISTINCT FROM
   (CASE WHEN membership.owner_user_id IS NOT NULL AND public.billing_partner_allowed(membership.owner_user_id,actor) THEN membership.owner_user_id ELSE actor END)
   OR NOT public.billing_partner_allowed(owner_id,actor) THEN RAISE EXCEPTION 'storage_access_denied' USING ERRCODE='42501'; END IF;
 SELECT CASE WHEN user1_id=owner_id THEN user2_id ELSE user1_id END INTO live_partner
   FROM public.partnerships WHERE owner_user_id=owner_id FOR SHARE;
 IF NOT public.inventory_object_v1(request,ARRAY['version','operationId','inventoryRevision','planning','collection','configuration','slots','items','releaseItemIds','manifest','slotOrder'])
   OR request->'version' IS DISTINCT FROM '4'::jsonb OR NOT public.inventory_id_v1(request->'operationId')
   OR length(request->>'operationId') NOT BETWEEN 8 AND 100 OR octet_length(request::text)>1835008
   OR NOT public.inventory_revision_v1(request->'inventoryRevision')
   OR NOT public.inventory_object_v1(request->'planning',ARRAY['actorUserId','ownerUserId','source','credentialId','authSessionId','partnerUserId','partnershipId'])
   OR NOT public.inventory_object_v1(request->'collection',ARRAY['collectionId','version','layoutRevision'])
   OR NOT public.inventory_object_v1(request->'configuration',ARRAY['name','kind','defaultPresentation','location','rows','cols'])
   OR NOT public.inventory_revision_v1(request->'collection'->'version') OR NOT public.inventory_revision_v1(request->'collection'->'layoutRevision')
   OR jsonb_typeof(request->'slots') IS DISTINCT FROM 'array' OR jsonb_array_length(request->'slots') NOT BETWEEN 1 AND 1025
   OR jsonb_typeof(request->'items') IS DISTINCT FROM 'array' OR jsonb_array_length(request->'items')>2050
   OR 2*jsonb_array_length(request->'slots')+jsonb_array_length(request->'items')>8192
   OR jsonb_typeof(request->'releaseItemIds') IS DISTINCT FROM 'array' OR jsonb_array_length(request->'releaseItemIds')>2050 THEN
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
 IF request->'manifest'<>'null' THEN
   IF NOT public.inventory_object_v1(request->'manifest',ARRAY['source','name','entries'])
     OR NOT public.inventory_object_v1(request->'manifest'->'source',ARRAY['id','version'])
     OR NOT public.inventory_id_v1(request->'manifest'->'source'->'id') OR NOT public.inventory_id_v1(request->'manifest'->'source'->'version')
     OR jsonb_typeof(request->'manifest'->'name') IS DISTINCT FROM 'string' OR btrim(request->'manifest'->>'name')=''
     OR jsonb_typeof(request->'manifest'->'entries') IS DISTINCT FROM 'array' OR jsonb_array_length(request->'manifest'->'entries')>1025 THEN
     RAISE EXCEPTION 'invalid_raw_restore_manifest' USING ERRCODE='22023'; END IF;
   IF EXISTS(SELECT 1 FROM jsonb_array_elements(request->'manifest'->'entries') e
     WHERE NOT public.inventory_object_v1(e,ARRAY['id','target']) OR NOT public.inventory_id_v1(e->'id')
       OR NOT(e->'target'='null' OR public.valid_inventory_identity_v1(e->'target')))
     OR (SELECT count(DISTINCT e->>'id') FROM jsonb_array_elements(request->'manifest'->'entries') e)<>jsonb_array_length(request->'manifest'->'entries') THEN
     RAISE EXCEPTION 'invalid_raw_restore_manifest' USING ERRCODE='22023'; END IF;
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(owner_id::text,6102));
 PERFORM pg_advisory_xact_lock(hashtextextended(owner_id::text,4701));
 digest:=encode(sha256(convert_to(jsonb_build_object('owner',owner_id,'request',request,'context',ctx)::text,'UTF8')),'hex');
 SELECT * INTO prior FROM public.developer_idempotency WHERE actor_id=actor AND operation='raw_content_restore_v4' AND request_key=request->>'operationId' FOR UPDATE;
 IF FOUND THEN
   IF prior.input_digest<>digest THEN RAISE EXCEPTION 'idempotency_conflict' USING ERRCODE='40001'; END IF;
   RETURN prior.result;
 END IF;
 IF EXISTS(SELECT 1 FROM public.collection_activity WHERE owner_user_id=owner_id AND operation_id=request->>'operationId' AND format_version=1) THEN
   RAISE EXCEPTION 'idempotency_conflict' USING ERRCODE='40001'; END IF;
 SELECT inventory_revision INTO revision FROM public.inventory_owner_state WHERE owner_user_id=owner_id FOR UPDATE;
 IF revision IS NULL THEN RAISE EXCEPTION 'storage_owner_state_unavailable' USING ERRCODE='55000'; END IF;
 BEGIN
   IF to_jsonb(revision) IS DISTINCT FROM request->'inventoryRevision' THEN RAISE EXCEPTION 'inventory_revision_conflict' USING ERRCODE='HF951'; END IF;
   collection:=(request->'collection'->>'collectionId')::uuid;
   SELECT * INTO binder_row FROM public.binders WHERE id=collection AND owner_user_id=owner_id FOR UPDATE;
   IF NOT FOUND THEN RAISE EXCEPTION 'storage_access_denied' USING ERRCODE='42501'; END IF;
   SELECT * INTO state FROM public.storage_collection_state WHERE collection_id=collection AND owner_user_id=owner_id FOR UPDATE;
   IF NOT FOUND THEN
     RAISE EXCEPTION 'raw_restore_unsupported' USING ERRCODE='0A000'; END IF;
   IF coalesce(state.preset_manifest,'null') IS DISTINCT FROM request->'manifest' THEN
     RAISE EXCEPTION 'raw_restore_collection_conflict' USING ERRCODE='HF952'; END IF;
   SELECT * INTO settings_row FROM public.user_settings WHERE user_id=owner_id FOR SHARE;
   IF jsonb_build_object('name',binder_row.name,'kind',state.kind,'defaultPresentation',state.default_presentation,'location',state.location,
     'rows',coalesce(binder_row.binder_rows,settings_row.binder_rows,4),'cols',coalesce(binder_row.binder_cols,settings_row.binder_cols,4)) IS DISTINCT FROM request->'configuration' THEN
     RAISE EXCEPTION 'raw_restore_collection_conflict' USING ERRCODE='HF952'; END IF;
   IF to_jsonb(state.version) IS DISTINCT FROM request->'collection'->'version'
     OR to_jsonb(state.layout_revision) IS DISTINCT FROM request->'collection'->'layoutRevision' THEN
     RAISE EXCEPTION 'raw_restore_collection_conflict' USING ERRCODE='HF952'; END IF;
   IF (SELECT coalesce(jsonb_agg(id ORDER BY position),'[]') FROM public.binder_slots WHERE collection_id=collection AND owner_user_id=owner_id)
     IS DISTINCT FROM (SELECT jsonb_agg(v->'before'->'id' ORDER BY n) FROM jsonb_array_elements(request->'slots') WITH ORDINALITY a(v,n)) THEN
     RAISE EXCEPTION 'raw_restore_content_conflict' USING ERRCODE='HF953'; END IF;
   IF NOT public.inventory_object_v1(request->'slotOrder',ARRAY['before','after'])
     OR request->'slotOrder'->'before' IS DISTINCT FROM (SELECT jsonb_agg(v->'before'->'id' ORDER BY n) FROM jsonb_array_elements(request->'slots') WITH ORDINALITY a(v,n))
     OR jsonb_typeof(request->'slotOrder'->'after') IS DISTINCT FROM 'array'
     OR jsonb_array_length(request->'slotOrder'->'after')<>jsonb_array_length(request->'slots')
     OR (SELECT count(DISTINCT v) FROM jsonb_array_elements(request->'slotOrder'->'after') v)<>jsonb_array_length(request->'slots')
     OR (SELECT jsonb_agg(v ORDER BY v) FROM jsonb_array_elements(request->'slotOrder'->'before') v)
       IS DISTINCT FROM (SELECT jsonb_agg(v ORDER BY v) FROM jsonb_array_elements(request->'slotOrder'->'after') v) THEN
     RAISE EXCEPTION 'invalid_raw_restore_order' USING ERRCODE='22023'; END IF;
   layout_delta:=CASE WHEN request->'slotOrder'->'before'=request->'slotOrder'->'after' THEN 0 ELSE 1 END;
   -- Validate the entire selected raw graph before writes. No acquisition, item edit or other-collection move.
   FOR ref IN SELECT jsonb_array_elements(request->'items') LOOP
     item:=public.inventory_item_ref_v1(owner_id,ref);
     IF item.id=ANY(selected) THEN RAISE EXCEPTION 'invalid_raw_restore' USING ERRCODE='22023'; END IF;
     IF item.grading IS NOT NULL THEN RAISE EXCEPTION 'raw_restore_unsupported' USING ERRCODE='0A000'; END IF;
     IF ref->'placement'<>'null' AND ref->'placement'->>'collectionId' IS DISTINCT FROM collection::text THEN
       RAISE EXCEPTION 'raw_restore_other_placement' USING ERRCODE='0A000'; END IF;
     selected:=array_append(selected,item.id);
   END LOOP;
   FOR pair IN SELECT jsonb_array_elements(request->'slots') LOOP
     desired:=pair->'after';
     IF NOT public.inventory_object_v1(pair,ARRAY['before','after'])
       OR NOT public.inventory_object_v1(desired,ARRAY['id','target','status','wantedCards','inventoryItemId','presetOrigin'])
       OR desired->'id' IS DISTINCT FROM pair->'before'->'id' OR NOT public.inventory_id_v1(desired->'id')
       OR desired->>'id'=ANY(ids)
       OR NOT (desired->'target'='null' OR public.valid_inventory_identity_v1(desired->'target'))
       OR NOT (desired->'status'='null' OR desired->>'status' IN ('collected','finalized','considering','wishlisted'))
       OR NOT public.valid_slot_wants_v1(desired->'wantedCards') OR jsonb_array_length(desired->'wantedCards')>100
       OR NOT (desired->'inventoryItemId'='null' OR public.inventory_id_v1(desired->'inventoryItemId'))
       OR coalesce(desired->>'status' IN ('collected','finalized'),false) IS DISTINCT FROM (desired->'inventoryItemId'<>'null') THEN
       RAISE EXCEPTION 'invalid_raw_restore' USING ERRCODE='22023'; END IF;
     ids:=array_append(ids,desired->>'id');
     PERFORM public.slot_check_ref_v1(owner_id,collection,pair->'before');
     SELECT * INTO slot FROM public.binder_slots WHERE id=desired->>'id' AND owner_user_id=owner_id;
     IF coalesce(slot.preset_origin,'null') IS DISTINCT FROM desired->'presetOrigin' THEN
       RAISE EXCEPTION 'raw_restore_content_conflict' USING ERRCODE='HF953'; END IF;
     IF desired->'presetOrigin'<>'null' AND (NOT public.inventory_object_v1(desired->'presetOrigin',ARRAY['source','entryId'])
       OR desired->'presetOrigin'->'source' IS DISTINCT FROM request->'manifest'->'source'
       OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(request->'manifest'->'entries') e WHERE e->'id'=desired->'presetOrigin'->'entryId')) THEN
       RAISE EXCEPTION 'invalid_raw_restore_origin' USING ERRCODE='22023'; END IF;
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
   IF work>8192 THEN RAISE EXCEPTION 'raw_restore_work_exceeded' USING ERRCODE='22023'; END IF;
   IF revision>=9007199254740991 OR state.version>=9007199254740991 OR state.layout_revision>=9007199254740991
     OR EXISTS(SELECT 1 FROM public.binder_slots WHERE owner_user_id=owner_id AND collection_id=collection AND version>=9007199254740991)
     OR EXISTS(SELECT 1 FROM public.inventory_placements WHERE owner_user_id=owner_id AND collection_id=collection AND version>=9007199254740991) THEN
     RAISE EXCEPTION 'raw_restore_version_overflow' USING ERRCODE='22023'; END IF;
   -- Budget the complete prospective private inverse, including old wants and both manifest roots.
   WITH graph AS (
     SELECT 'binder_slots'::text tbl,s.id,
       collection_audit_private.state('binder_slots',to_jsonb(s)) b,
       collection_audit_private.state('binder_slots',to_jsonb(s)||jsonb_build_object('target',v->'after'->'target','status',v->'after'->'status','wanted_cards',v->'after'->'wantedCards','position',CASE WHEN layout_delta=0 THEN s.position ELSE o.n-1 END,'version',s.version+1)) a
       FROM public.binder_slots s JOIN jsonb_array_elements(request->'slots') v ON s.id=v->'after'->>'id'
       JOIN jsonb_array_elements_text(request->'slotOrder'->'after') WITH ORDINALITY o(id,n) ON o.id=s.id
       WHERE s.owner_user_id=owner_id AND s.collection_id=collection
     UNION ALL
     SELECT 'inventory_placements',r->>'itemId',
       (SELECT collection_audit_private.state('inventory_placements',to_jsonb(p)) FROM public.inventory_placements p WHERE p.inventory_item_id=r->>'itemId' AND p.owner_user_id=owner_id),
       (SELECT collection_audit_private.state('inventory_placements',jsonb_build_object('inventory_item_id',r->>'itemId','owner_user_id',owner_id,'collection_id',collection,'slot_id',v->'after'->>'id','version',coalesce((r->'placement'->'slot'->>'placementVersion')::bigint,-1)+1))
         FROM jsonb_array_elements(request->'slots') v WHERE v->'after'->>'inventoryItemId'=r->>'itemId')
       FROM jsonb_array_elements(request->'items') r
     UNION ALL
     SELECT 'storage_collection_state',collection::text,collection_audit_private.state('storage_collection_state',to_jsonb(state)),
       collection_audit_private.state('storage_collection_state',to_jsonb(state)||jsonb_build_object('version',state.version+1,'layout_revision',state.layout_revision+layout_delta))
     UNION ALL
     SELECT 'inventory_owner_state',owner_id::text,collection_audit_private.state('inventory_owner_state',to_jsonb(o)),
       collection_audit_private.state('inventory_owner_state',to_jsonb(o)||jsonb_build_object('inventory_revision',revision+1))
       FROM public.inventory_owner_state o WHERE o.owner_user_id=owner_id)
   SELECT jsonb_agg(jsonb_build_object('table',tbl,'id',id,'before',b,'after',a) ORDER BY tbl,id) INTO prospective FROM graph WHERE b IS DISTINCT FROM a;
   IF jsonb_array_length(prospective)>3077 OR octet_length(prospective::text)>2621440 THEN
     RAISE EXCEPTION 'raw_restore_recovery_envelope_exceeded' USING ERRCODE='22023'; END IF;
   saved_before:=public.slot_saved_count_v1(owner_id);
   WITH d AS (DELETE FROM public.inventory_placements WHERE owner_user_id=owner_id AND collection_id=collection RETURNING *)
   SELECT changes||array_agg(collection_audit_private.delta('inventory_placements',to_jsonb(d),NULL)) INTO changes FROM d;
   WITH u AS (UPDATE public.binder_slots s SET target=nullif(v->'after'->'target','null'),status=v->'after'->>'status',wanted_cards=v->'after'->'wantedCards',position=CASE WHEN layout_delta=0 THEN s.position ELSE x.n-1 END,version=s.version+1,updated_at=clock_timestamp()
     FROM jsonb_array_elements(request->'slots') v JOIN jsonb_array_elements_text(request->'slotOrder'->'after') WITH ORDINALITY x(id,n) ON x.id=v->'after'->>'id' WHERE s.owner_user_id=owner_id AND s.collection_id=collection AND s.id=v->'after'->>'id' RETURNING s.*)
   SELECT changes||array_agg(collection_audit_private.delta('binder_slots',to_jsonb(o),to_jsonb(u))) INTO changes FROM u JOIN public.binder_slots o ON o.id=u.id;
   WITH i AS (INSERT INTO public.inventory_placements(inventory_item_id,owner_user_id,collection_id,slot_id,version)
     SELECT v->'after'->>'inventoryItemId',owner_id,collection,v->'after'->>'id',coalesce((r->'placement'->'slot'->>'placementVersion')::bigint,-1)+1
     FROM jsonb_array_elements(request->'slots') v JOIN jsonb_array_elements(request->'items') r ON r->>'itemId'=v->'after'->>'inventoryItemId' RETURNING *)
   SELECT changes||array_agg(collection_audit_private.delta('inventory_placements',NULL,to_jsonb(i))) INTO changes FROM i;
   FOR pair IN SELECT jsonb_array_elements(request->'slots') LOOP
     PERFORM public.slot_check_target_v1(owner_id,pair->'after'->>'id',pair->'after'->'target');
   END LOOP;
   IF public.billing_enforced() AND NOT public.billing_has_paid(owner_id) AND public.slot_saved_count_v1(owner_id)>saved_before THEN
     SELECT free_card_limit INTO allowed FROM public.billing_configuration WHERE id;
     IF public.slot_saved_count_v1(owner_id)>coalesce(allowed,10) THEN RAISE EXCEPTION 'card_limit_reached'; END IF;
   END IF;
   WITH u AS (UPDATE public.inventory_owner_state SET inventory_revision=inventory_revision+1 WHERE owner_user_id=owner_id RETURNING *)
   SELECT max(u.inventory_revision),changes||array_agg(collection_audit_private.delta('inventory_owner_state',to_jsonb(o),to_jsonb(u))) INTO revision,changes FROM u JOIN public.inventory_owner_state o ON o.owner_user_id=u.owner_user_id;
   WITH u AS (UPDATE public.storage_collection_state SET version=version+1,layout_revision=layout_revision+layout_delta WHERE collection_id=collection AND owner_user_id=owner_id RETURNING *)
   SELECT changes||array_agg(collection_audit_private.delta('storage_collection_state',to_jsonb(o),to_jsonb(u))) INTO changes FROM u JOIN public.storage_collection_state o ON o.collection_id=u.collection_id;
   result:=jsonb_build_object('version',4,'inventoryRevision',revision,'collectionId',collection,'collectionVersion',state.version+1,
     'layoutRevision',state.layout_revision+layout_delta,'slotOrder',request->'slotOrder','changed',true,'slotIds',request->'slotOrder'->'after','releasedItemIds',to_jsonb(released));
   event_id:=collection_audit_private.command_result(owner_id,result||jsonb_build_object('context',ctx),'backup.restore.raw',changes);
   -- Require the recorded event to be exactly the planned inverse, and undoable.
   SELECT a.changes INTO STRICT actual FROM public.collection_activity a WHERE a.id=event_id;
   IF actual IS DISTINCT FROM prospective THEN RAISE EXCEPTION 'raw_restore_audit_graph_mismatch'; END IF;
   inverse_plan:=collection_audit_private.recovery_plan_v1(actor,owner_id,event_id,'{}');
   IF inverse_plan->'supported' IS DISTINCT FROM 'true'::jsonb OR inverse_plan->'conflicts' IS DISTINCT FROM '[]'::jsonb THEN
     RAISE EXCEPTION 'raw_restore_inverse_unavailable'; END IF;
 EXCEPTION WHEN SQLSTATE 'HF951' OR SQLSTATE 'HF952' OR SQLSTATE 'HF953' THEN
   GET STACKED DIAGNOSTICS predicate_state=RETURNED_SQLSTATE;
   SELECT inventory_revision INTO STRICT revision FROM public.inventory_owner_state WHERE owner_user_id=owner_id;
   result:=jsonb_build_object('version',4,'outcome','rejected','operationId',request->>'operationId','inventoryRevision',revision,'code',
     CASE predicate_state WHEN 'HF951' THEN 'inventory_revision_conflict' WHEN 'HF952' THEN 'raw_restore_collection_conflict' ELSE 'raw_restore_content_conflict' END);
 END;
 -- Both accepted and rejected requests retain the original body/context for life, before reconstruction.
 INSERT INTO public.developer_idempotency(actor_id,operation,request_key,input_digest,result,expires_at)
 VALUES(actor,'raw_content_restore_v4',request->>'operationId',digest,result,'infinity');
 RETURN result;
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
 RAISE EXCEPTION 'invalid_raw_restore' USING ERRCODE='22023';
END $function$;

CREATE OR REPLACE FUNCTION collection_audit_private.import_arrangement_v1(actor uuid, owner_id uuid, request jsonb, ctx jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
 SET lock_timeout TO '3s'
 SET statement_timeout TO '10s'
AS $function$
DECLARE -- terminal_predicates_093
membership public.partnerships; prior public.developer_idempotency; digest text; revision bigint; destination uuid;
 state public.storage_collection_state; token jsonb; copy jsonb; item_value jsonb; slot_value jsonb; want jsonb; member text;
 item public.inventory_items; placed public.inventory_placements; card public.tcg_cards; identity_value jsonb;
 declared uuid[]:='{}'; required uuid[]; selected text[]:='{}'; added text[]:='{}'; slot_ids text[]:='{}'; placed_ids text[]:='{}';
 source_slots text[]:='{}'; saved_before bigint; allowed integer; result jsonb; changes jsonb[]:='{}';
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
 IF revision IS NULL THEN RAISE EXCEPTION 'storage_owner_state_unavailable' USING ERRCODE='55000'; END IF;
 IF to_jsonb(revision) IS DISTINCT FROM request->'inventoryRevision' THEN RAISE EXCEPTION 'inventory_revision_conflict' USING ERRCODE='HF931'; END IF;
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
   IF NOT FOUND THEN RAISE EXCEPTION 'storage_access_denied' USING ERRCODE='42501'; END IF;
   IF to_jsonb(state.version) IS DISTINCT FROM token->'version' OR to_jsonb(state.layout_revision) IS DISTINCT FROM token->'layoutRevision' THEN
     RAISE EXCEPTION 'inventory_collection_conflict' USING ERRCODE='HF933'; END IF;
 END LOOP;
 IF NOT destination=ANY(declared) THEN RAISE EXCEPTION 'invalid_arrangement_import' USING ERRCODE='22023'; END IF;
 SELECT * INTO state FROM public.storage_collection_state WHERE collection_id=destination AND owner_user_id=owner_id;
 IF coalesce(state.preset_manifest,'null') IS DISTINCT FROM request->'manifest'
   OR (SELECT count(*) FROM public.binder_slots WHERE collection_id=destination)<>jsonb_array_length(request->'emptyDestinationSlots')
   OR EXISTS(SELECT 1 FROM public.binder_slots WHERE collection_id=destination AND (status IS NOT NULL OR wanted_cards<>'[]')) THEN
   RAISE EXCEPTION 'arrangement_destination_conflict' USING ERRCODE='HF934'; END IF;
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
       RAISE EXCEPTION 'import_copy_conflict' USING ERRCODE='HF935'; END IF;
     added:=array_append(added,item_value->>'id');
   ELSIF copy->>'kind'='existing' THEN
     item:=public.inventory_item_ref_v1(owner_id,copy->'ref');
     IF item.id IS DISTINCT FROM item_value->>'id' OR to_jsonb(item.version) IS DISTINCT FROM item_value->'version'
       OR item.identity IS DISTINCT FROM identity_value OR coalesce(item.grading,'null') IS DISTINCT FROM item_value->'grading'
       OR item.acquired_at IS DISTINCT FROM (item_value->>'acquiredAt')::timestamptz THEN RAISE EXCEPTION 'import_copy_conflict' USING ERRCODE='HF935'; END IF;
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
 WITH i AS (INSERT INTO public.inventory_items(id,owner_user_id,identity,grading,acquired_at)
 SELECT c->'item'->>'id',owner_id,c->'item'->'identity',nullif(c->'item'->'grading','null'),(c->'item'->>'acquiredAt')::timestamptz
 FROM jsonb_array_elements(request->'copies') c WHERE c->>'kind'='add' RETURNING *)
 SELECT changes||array_agg(collection_audit_private.delta('inventory_items',NULL,to_jsonb(i))) INTO changes FROM i;
 WITH d AS (DELETE FROM public.inventory_placements WHERE owner_user_id=owner_id AND inventory_item_id=ANY(selected) RETURNING *)
 SELECT changes||array_agg(collection_audit_private.delta('inventory_placements',to_jsonb(d),NULL)) INTO changes FROM d;
 WITH u AS (UPDATE public.binder_slots SET status=NULL,version=version+1,updated_at=clock_timestamp() WHERE owner_user_id=owner_id AND id=ANY(source_slots) RETURNING *)
 SELECT changes||array_agg(collection_audit_private.delta('binder_slots',to_jsonb(o),to_jsonb(u))) INTO changes FROM u JOIN public.binder_slots o ON o.id=u.id;
 WITH d AS (DELETE FROM public.inventory_placements WHERE owner_user_id=owner_id AND collection_id=destination RETURNING *)
 SELECT changes||array_agg(collection_audit_private.delta('inventory_placements',to_jsonb(d),NULL)) INTO changes FROM d;
 WITH d AS (DELETE FROM public.binder_slots WHERE owner_user_id=owner_id AND collection_id=destination RETURNING *)
 SELECT changes||array_agg(collection_audit_private.delta('binder_slots',to_jsonb(d),NULL)) INTO changes FROM d;
 WITH i AS (INSERT INTO public.binder_slots(id,collection_id,owner_user_id,position,target,status,wanted_cards,preset_origin)
 SELECT s->>'id',destination,owner_id,n-1,nullif(s->'target','null'),s->>'status',s->'wantedCards',nullif(s->'presetOrigin','null')
 FROM jsonb_array_elements(request->'slots') WITH ORDINALITY a(s,n) RETURNING *)
 SELECT changes||array_agg(collection_audit_private.delta('binder_slots',NULL,to_jsonb(i))) INTO changes FROM i;
 WITH i AS (INSERT INTO public.inventory_placements(inventory_item_id,owner_user_id,collection_id,slot_id,version)
 SELECT s->>'inventoryItemId',owner_id,destination,s->>'id',CASE WHEN c->>'kind'='add' THEN 0
   ELSE coalesce((c->'ref'->'placement'->'slot'->>'placementVersion')::bigint,-1)+1 END
 FROM jsonb_array_elements(request->'slots') s JOIN jsonb_array_elements(request->'copies') c ON c->'item'->>'id'=s->>'inventoryItemId' RETURNING *)
 SELECT changes||array_agg(collection_audit_private.delta('inventory_placements',NULL,to_jsonb(i))) INTO changes FROM i;
 FOR slot_value IN SELECT jsonb_array_elements(request->'slots') LOOP
   PERFORM public.slot_check_target_v1(owner_id,slot_value->>'id',slot_value->'target');
 END LOOP;
 IF public.billing_enforced() AND NOT public.billing_has_paid(owner_id) AND public.slot_saved_count_v1(owner_id)>saved_before THEN
   SELECT free_card_limit INTO allowed FROM public.billing_configuration WHERE id;
   IF public.slot_saved_count_v1(owner_id)>coalesce(allowed,10) THEN RAISE EXCEPTION 'card_limit_reached'; END IF;
 END IF;
 WITH u AS (UPDATE public.inventory_owner_state SET inventory_revision=inventory_revision+1 WHERE owner_user_id=owner_id RETURNING *)
 SELECT max(u.inventory_revision),changes||array_agg(collection_audit_private.delta('inventory_owner_state',to_jsonb(o),to_jsonb(u))) INTO revision,changes FROM u JOIN public.inventory_owner_state o ON o.owner_user_id=u.owner_user_id;
 WITH u AS (UPDATE public.storage_collection_state SET version=version+1,layout_revision=layout_revision+CASE WHEN collection_id=destination THEN 1 ELSE 0 END
 WHERE owner_user_id=owner_id AND collection_id=ANY(declared) RETURNING *)
 SELECT changes||array_agg(collection_audit_private.delta('storage_collection_state',to_jsonb(o),to_jsonb(u))) INTO changes FROM u JOIN public.storage_collection_state o ON o.collection_id=u.collection_id;
 SELECT jsonb_build_object('inventoryRevision',revision,'collectionId',destination,'collectionVersion',version,'layoutRevision',layout_revision,
   'changed',true,'slotIds',to_jsonb(slot_ids),'addedItemIds',to_jsonb(added),'removedEmptySlotIds',(SELECT coalesce(jsonb_agg(s->'id'),'[]') FROM jsonb_array_elements(request->'emptyDestinationSlots') s)) INTO result FROM public.storage_collection_state WHERE collection_id=destination;
 IF octet_length(result::text)>1048576 THEN RAISE EXCEPTION 'import_receipt_too_large' USING ERRCODE='22023'; END IF;
 PERFORM collection_audit_private.command_result(owner_id,result||jsonb_build_object('context',ctx),'backup.arrangement',changes);
 INSERT INTO public.developer_idempotency(actor_id,operation,request_key,input_digest,result,expires_at)
 VALUES(actor,'backup_arrangement_v1',request->>'operationId',digest,result,'infinity');
 RETURN result;
EXCEPTION WHEN invalid_text_representation OR invalid_datetime_format OR datetime_field_overflow OR numeric_value_out_of_range THEN
 RAISE EXCEPTION 'invalid_arrangement_import' USING ERRCODE='22023';
END $function$;

CREATE OR REPLACE FUNCTION collection_audit_private.create_collection_v1(actor uuid, owner_id uuid, request jsonb, ctx jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
 SET lock_timeout TO '3s'
 SET statement_timeout TO '10s'
AS $function$
DECLARE -- terminal_predicates_093
prior public.developer_idempotency; revision bigint; digest text; result jsonb; collection uuid;
 manifest jsonb; entry jsonb; target_value jsonb; card public.tcg_cards; binder_count integer; next_sort integer;
 membership public.partnerships; source_value jsonb; keys text[]; slot_keys text[]; r integer; c integer; grid jsonb; changes jsonb[]:='{}';
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
 IF NOT public.inventory_object_v1(manifest-'setScope',ARRAY['source','name','entries'])
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
 -- empty_owner_first_creation_098: already holding membership SHARE, management 6102 and root 4701.
 IF revision IS NULL THEN
   IF EXISTS(SELECT 1 FROM public.binders WHERE owner_user_id=owner_id)
     OR EXISTS(SELECT 1 FROM public.storage_collection_state WHERE owner_user_id=owner_id)
     OR EXISTS(SELECT 1 FROM public.binder_slots WHERE owner_user_id=owner_id)
     OR EXISTS(SELECT 1 FROM public.inventory_items WHERE owner_user_id=owner_id)
     OR EXISTS(SELECT 1 FROM public.inventory_placements WHERE owner_user_id=owner_id)
     OR EXISTS(SELECT 1 FROM public.collection_activity WHERE owner_user_id=owner_id) THEN
     RAISE EXCEPTION 'storage_owner_state_unavailable' USING ERRCODE='55000';
   END IF;
   -- Only a prospective revision. Original validation/caps/recorder must all succeed
   -- before the original atomic INSERT persists a root, default, targets and receipt.
   revision:=0;
 END IF;
 IF to_jsonb(revision) IS DISTINCT FROM request->'inventoryRevision' THEN RAISE EXCEPTION 'inventory_revision_conflict' USING ERRCODE='HF931'; END IF;
 IF revision=9007199254740991 THEN RAISE EXCEPTION 'inventory_revision_overflow' USING ERRCODE='22023'; END IF;
 IF EXISTS(SELECT 1 FROM public.binders WHERE id=collection)
   OR EXISTS(SELECT 1 FROM public.binder_slots WHERE id=ANY(slot_keys)) THEN RAISE EXCEPTION 'creation_identity_conflict' USING ERRCODE='HF932'; END IF;
 -- Validate copied targets independently. No ownership, names or UI catalog evidence is authoritative.
 -- copied_set_scope_101
 IF manifest ? 'setScope' THEN PERFORM collection_audit_private.validate_set_creation_v1(manifest); END IF;
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
 WITH i AS (INSERT INTO public.inventory_owner_state(owner_user_id) VALUES(owner_id) ON CONFLICT DO NOTHING RETURNING *)
 SELECT changes||array_agg(collection_audit_private.delta('inventory_owner_state',NULL,to_jsonb(i))) INTO changes FROM i;
 WITH i AS (INSERT INTO public.binders(id,owner_user_id,name,sort_order,is_default,binder_rows,binder_cols)
 VALUES(collection,owner_id,request->>'name',next_sort,binder_count=0,r,c) RETURNING *)
 SELECT changes||array_agg(collection_audit_private.delta('binders',NULL,to_jsonb(i))) INTO changes FROM i;
 WITH i AS (INSERT INTO public.storage_collection_state(collection_id,owner_user_id,kind,default_presentation,location,preset_manifest)
 VALUES(collection,owner_id,request->>'kind',request->>'defaultPresentation',request->>'location',manifest) RETURNING *)
 SELECT changes||array_agg(collection_audit_private.delta('storage_collection_state',NULL,to_jsonb(i))) INTO changes FROM i;
 WITH i AS (INSERT INTO public.binder_slots(id,collection_id,owner_user_id,position,target,preset_origin)
 SELECT slot_keys[n],collection,owner_id,n-1,nullif(e->'target','null'),jsonb_build_object('source',source_value,'entryId',e->'id')
 FROM jsonb_array_elements(manifest->'entries') WITH ORDINALITY a(e,n) RETURNING *)
 SELECT changes||array_agg(collection_audit_private.delta('binder_slots',NULL,to_jsonb(i))) INTO changes FROM i;
 WITH u AS (UPDATE public.inventory_owner_state SET inventory_revision=inventory_revision+1 WHERE owner_user_id=owner_id RETURNING *)
 SELECT max(u.inventory_revision),changes||array_agg(collection_audit_private.delta('inventory_owner_state',to_jsonb(o),to_jsonb(u))) INTO revision,changes FROM u JOIN public.inventory_owner_state o ON o.owner_user_id=u.owner_user_id;
 result:=jsonb_build_object('collectionId',collection,'inventoryRevision',revision,'collectionVersion',0,'layoutRevision',0,
   'changed',true,'slotIds',request->'slotIds','recoverySupported',false);
 IF octet_length(result::text)>1048576 THEN RAISE EXCEPTION 'creation_receipt_too_large' USING ERRCODE='22023'; END IF;
 PERFORM collection_audit_private.command_result(owner_id,result||jsonb_build_object('context',ctx),'collection.create',changes);
 INSERT INTO public.developer_idempotency(actor_id,operation,request_key,input_digest,result,expires_at)
 VALUES(actor,'collection_create_v1',request->>'operationId',digest,result,'infinity');
 RETURN result;
END $function$;

CREATE OR REPLACE FUNCTION public.developer_save_settings(actor uuid, owner_id uuid, binder_id_input uuid, expected_settings jsonb, expected_layout jsonb, new_settings jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE stored public.user_settings; saved public.user_settings; binder public.binders; next public.user_settings; present boolean; current_layout jsonb; changes jsonb[]:='{}';
BEGIN
 IF actor<>owner_id THEN
  PERFORM 1 FROM public.partnerships WHERE owner_user_id=owner_id AND actor IN(user1_id,user2_id) FOR KEY SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Collection access denied' USING ERRCODE='42501'; END IF;
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(owner_id::text,6103));
 -- One audit event for the whole save, recorded below.
 PERFORM set_config('collection_audit.command','on',true);
 IF binder_id_input IS NOT NULL THEN
  SELECT * INTO binder FROM public.binders WHERE id=binder_id_input AND owner_user_id=owner_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Binder not found' USING ERRCODE='42501'; END IF;
  current_layout:=jsonb_build_object('binder_rows',binder.binder_rows,'binder_cols',binder.binder_cols);
 END IF;
 SELECT * INTO stored FROM public.user_settings WHERE user_id=owner_id FOR UPDATE;
 present:=FOUND;
 IF (CASE WHEN present THEN to_jsonb(stored) ELSE NULL END) IS DISTINCT FROM expected_settings OR current_layout IS DISTINCT FROM expected_layout THEN RETURN jsonb_build_object('conflict',true); END IF;
 SELECT * INTO next FROM jsonb_populate_record(NULL::public.user_settings,new_settings);
 IF present THEN
  WITH u AS (UPDATE public.user_settings SET binder_rows=coalesce(next.binder_rows,stored.binder_rows),binder_cols=coalesce(next.binder_cols,stored.binder_cols),binder_color_id=next.binder_color_id,binder_page_colors=next.binder_page_colors,binder_slot_glare_enabled=next.binder_slot_glare_enabled,card_finish_effects_enabled=next.card_finish_effects_enabled,dark_mode=next.dark_mode,show_binder_value=next.show_binder_value,pricing_region=next.pricing_region,preferred_currency=next.preferred_currency,preferred_card_language=next.preferred_card_language,updated_at=clock_timestamp() WHERE user_id=owner_id RETURNING *)
  SELECT changes||array_agg(collection_audit_private.delta('user_settings',to_jsonb(o),to_jsonb(u))) INTO changes FROM u JOIN public.user_settings o ON o.user_id=u.user_id;
 ELSE
  INSERT INTO public.user_settings(user_id,binder_rows,binder_cols,binder_color_id,binder_page_colors,binder_slot_glare_enabled,card_finish_effects_enabled,dark_mode,show_binder_value,pricing_region,preferred_currency,preferred_card_language)
  VALUES(owner_id,coalesce(next.binder_rows,4),coalesce(next.binder_cols,4),next.binder_color_id,next.binder_page_colors,next.binder_slot_glare_enabled,next.card_finish_effects_enabled,next.dark_mode,next.show_binder_value,next.pricing_region,next.preferred_currency,next.preferred_card_language)
  ON CONFLICT(user_id) DO NOTHING RETURNING * INTO saved;
  IF saved.user_id IS NULL THEN RETURN jsonb_build_object('conflict',true); END IF;
  changes:=changes||collection_audit_private.delta('user_settings',NULL,to_jsonb(saved));
 END IF;
 IF binder_id_input IS NOT NULL THEN
  WITH u AS (UPDATE public.binders SET binder_rows=(new_settings->>'layout_rows')::integer,binder_cols=(new_settings->>'layout_cols')::integer WHERE id=binder_id_input AND owner_user_id=owner_id RETURNING *)
  SELECT changes||array_agg(collection_audit_private.delta('binders',to_jsonb(o),to_jsonb(u))) INTO changes FROM u JOIN public.binders o ON o.id=u.id;
 END IF;
 PERFORM collection_audit_private.record_v1(owner_id,collection_audit_private.context(owner_id),NULL,changes,NULL,NULL);
 RETURN jsonb_build_object('conflict',false);
END $function$;

CREATE OR REPLACE FUNCTION public.developer_create_binder(actor uuid, owner_id uuid, binder_name text, retry_key text, digest text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE existing public.developer_idempotency; saved_id uuid; binder_count integer; next_sort integer; changes jsonb[]:='{}';
BEGIN
 IF actor<>owner_id AND NOT EXISTS(SELECT 1 FROM public.partnerships WHERE owner_user_id=owner_id AND actor IN(user1_id,user2_id)) THEN RAISE EXCEPTION 'Collection access denied'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(actor::text||':create_binder:'||retry_key,6101));
 SELECT * INTO existing FROM public.developer_idempotency WHERE actor_id=actor AND operation='create_binder' AND request_key=retry_key AND expires_at>now();
 IF FOUND THEN
  IF existing.input_digest<>digest THEN RAISE EXCEPTION 'idempotency_conflict'; END IF;
  RETURN existing.result;
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(owner_id::text,6102));
 PERFORM set_config('collection_audit.command','on',true);
 SELECT count(*),coalesce(max(sort_order),-1)+1 INTO binder_count,next_sort FROM public.binders WHERE owner_user_id=owner_id;
 IF binder_count>=20 THEN RAISE EXCEPTION 'binder_safety_limit_reached'; END IF;
 changes:=collection_audit_private.create_binder_rows(owner_id,binder_name,next_sort,binder_count=0);
 IF changes IS NULL THEN RAISE EXCEPTION 'duplicate default binder' USING ERRCODE='23505'; END IF;
 saved_id:=(changes[1]->>'id')::uuid;
 PERFORM collection_audit_private.record_v1(owner_id,collection_audit_private.context(owner_id),NULL,changes,NULL,NULL);
 INSERT INTO public.developer_idempotency(actor_id,operation,request_key,input_digest,result) VALUES(actor,'create_binder',retry_key,digest,jsonb_build_object('id',saved_id))
 ON CONFLICT(actor_id,operation,request_key) DO UPDATE SET input_digest=excluded.input_digest,result=excluded.result,expires_at=excluded.expires_at;
 DELETE FROM public.developer_idempotency WHERE (actor_id,operation,request_key) IN(SELECT actor_id,operation,request_key FROM public.developer_idempotency WHERE expires_at<now() LIMIT 100);
 RETURN jsonb_build_object('id',saved_id);
END $function$;

CREATE OR REPLACE FUNCTION public.ensure_default_binder(owner uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE found_id uuid; changes jsonb[];
BEGIN
  SELECT b.id INTO found_id FROM public.binders b WHERE b.owner_user_id = owner AND b.is_default;
  IF found_id IS NOT NULL THEN RETURN found_id; END IF;
  PERFORM set_config('collection_audit.command','on',true);
  changes := collection_audit_private.create_binder_rows(owner, 'My binder', 0, true);
  IF changes IS NULL THEN
    -- A concurrent call created it first, with its own state row.
    SELECT b.id INTO found_id FROM public.binders b WHERE b.owner_user_id = owner AND b.is_default;
    RETURN found_id;
  END IF;
  PERFORM collection_audit_private.record_v1(owner,collection_audit_private.context(owner),NULL,changes,NULL,NULL);
  RETURN (changes[1]->>'id')::uuid;
END
$function$;

-- A new empty native binder: its row, the owner root and its collection state, as audit changes
-- (binder first). NULL when a concurrent call already created the owner's default binder.
CREATE OR REPLACE FUNCTION collection_audit_private.create_binder_rows(owner_id uuid, binder_name text, sort integer, make_default boolean)
 RETURNS jsonb[]
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE changes jsonb[]:='{}'; saved public.binders;
BEGIN
 INSERT INTO public.binders(owner_user_id,name,sort_order,is_default) VALUES(owner_id,binder_name,sort,make_default)
 ON CONFLICT (owner_user_id) WHERE is_default DO NOTHING RETURNING * INTO saved;
 IF saved.id IS NULL THEN RETURN NULL; END IF;
 changes:=ARRAY[collection_audit_private.delta('binders',NULL,to_jsonb(saved))];
 WITH i AS (INSERT INTO public.inventory_owner_state(owner_user_id) VALUES(owner_id) ON CONFLICT DO NOTHING RETURNING *)
 SELECT changes||array_agg(collection_audit_private.delta('inventory_owner_state',NULL,to_jsonb(i))) INTO changes FROM i;
 WITH i AS (INSERT INTO public.storage_collection_state(collection_id,owner_user_id) VALUES(saved.id,owner_id) RETURNING *)
 SELECT changes||array_agg(collection_audit_private.delta('storage_collection_state',NULL,to_jsonb(i))) INTO changes FROM i;
 WITH u AS (UPDATE public.inventory_owner_state SET inventory_revision=inventory_revision+1 WHERE owner_user_id=owner_id RETURNING *)
 SELECT changes||array_agg(collection_audit_private.delta('inventory_owner_state',to_jsonb(o),to_jsonb(u))) INTO changes
 FROM u JOIN public.inventory_owner_state o ON o.owner_user_id=u.owner_user_id;
 RETURN changes;
END $function$;

CREATE OR REPLACE FUNCTION public.developer_delete_binder(actor uuid, owner_id uuid, binder_id_input uuid, confirm_populated boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE chosen public.binders; remaining integer; slots integer; replacement uuid; changes jsonb[]:='{}';
BEGIN
 IF actor<>owner_id THEN
  PERFORM 1 FROM public.partnerships WHERE owner_user_id=owner_id AND actor IN(user1_id,user2_id) FOR KEY SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Collection access denied' USING ERRCODE='42501'; END IF;
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(owner_id::text,6102));
 PERFORM set_config('collection_audit.command','on',true);
 -- FOR UPDATE also excludes new child FK references until deletion commits or rolls back.
 SELECT * INTO chosen FROM public.binders WHERE id=binder_id_input AND owner_user_id=owner_id FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'reason','not-found','slotCount',0); END IF;
 SELECT count(*) INTO remaining FROM public.binders WHERE owner_user_id=owner_id;
 IF remaining<=1 THEN RETURN jsonb_build_object('ok',false,'reason','last-binder','slotCount',0); END IF;
 -- Populated means at least one recorded card (owned or tracked) in the binder.
 SELECT count(*) INTO slots FROM public.binder_slots WHERE collection_id=chosen.id AND owner_user_id=owner_id AND status IS NOT NULL;
 IF slots>0 AND NOT coalesce(confirm_populated,false) THEN RETURN jsonb_build_object('ok',false,'reason','needs-confirmation','slotCount',slots); END IF;
 IF chosen.is_default THEN SELECT id INTO replacement FROM public.binders WHERE owner_user_id=owner_id AND id<>chosen.id ORDER BY sort_order,id LIMIT 1 FOR UPDATE; END IF;
 -- Children first (what the FK cascades would do), so the event records every removed row.
 WITH d AS (DELETE FROM public.inventory_placements WHERE owner_user_id=owner_id AND collection_id=chosen.id RETURNING *)
 SELECT changes||array_agg(collection_audit_private.delta('inventory_placements',to_jsonb(d),NULL)) INTO changes FROM d;
 WITH d AS (DELETE FROM public.binder_slots WHERE owner_user_id=owner_id AND collection_id=chosen.id RETURNING *)
 SELECT changes||array_agg(collection_audit_private.delta('binder_slots',to_jsonb(d),NULL)) INTO changes FROM d;
 WITH d AS (DELETE FROM public.binder_shares WHERE owner_user_id=owner_id AND binder_id=chosen.id RETURNING *)
 SELECT changes||array_agg(collection_audit_private.delta('binder_shares',to_jsonb(d),NULL)) INTO changes FROM d;
 WITH d AS (DELETE FROM public.storage_collection_state WHERE owner_user_id=owner_id AND collection_id=chosen.id RETURNING *)
 SELECT changes||array_agg(collection_audit_private.delta('storage_collection_state',to_jsonb(d),NULL)) INTO changes FROM d;
 WITH d AS (DELETE FROM public.binders WHERE id=chosen.id AND owner_user_id=owner_id RETURNING *)
 SELECT changes||array_agg(collection_audit_private.delta('binders',to_jsonb(d),NULL)) INTO changes FROM d;
 IF replacement IS NOT NULL THEN
  WITH u AS (UPDATE public.binders SET is_default=true WHERE id=replacement AND owner_user_id=owner_id RETURNING *)
  SELECT changes||array_agg(collection_audit_private.delta('binders',to_jsonb(o),to_jsonb(u))) INTO changes FROM u JOIN public.binders o ON o.id=u.id;
 END IF;
 PERFORM collection_audit_private.record_v1(owner_id,collection_audit_private.context(owner_id),NULL,changes,NULL,NULL);
 RETURN jsonb_build_object('ok',true,'deletedBinderId',chosen.id);
END $function$;

CREATE OR REPLACE FUNCTION collection_audit_private.creation_recovery_proof_v1(owner_id uuid, event_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
 SET "TimeZone" TO 'UTC'
AS $function$
DECLARE original public.collection_activity; binder_delta jsonb; state_delta jsonb; root_delta jsonb;
 collection uuid; state_value jsonb; slot_keys text[]; defaults jsonb; conflicts jsonb:='[]'; references_proof jsonb:='[]';
 fk record; join_columns text; occupied boolean;
BEGIN
 SELECT * INTO original FROM public.collection_activity WHERE id=event_id AND owner_user_id=owner_id;
 IF original.action IS DISTINCT FROM 'collection.create' OR original.format_version<>1
   OR jsonb_typeof(original.changes) IS DISTINCT FROM 'array' THEN RETURN jsonb_build_object('eligible',false); END IF;
 SELECT e INTO binder_delta FROM jsonb_array_elements(original.changes) e WHERE e->>'table'='binders';
 SELECT e INTO state_delta FROM jsonb_array_elements(original.changes) e WHERE e->>'table'='storage_collection_state';
 SELECT e INTO root_delta FROM jsonb_array_elements(original.changes) e WHERE e->>'table'='inventory_owner_state';
 state_value:=state_delta->'after';
 -- Require the whole, bounded 083 event, including copied manifest and every initial slot.
 IF binder_delta IS NULL OR state_delta IS NULL OR root_delta IS NULL
   OR binder_delta->'before' IS DISTINCT FROM 'null'::jsonb OR state_delta->'before' IS DISTINCT FROM 'null'::jsonb
   OR binder_delta->'after'->>'id' IS DISTINCT FROM binder_delta->>'id'
   OR state_delta->>'id' IS DISTINCT FROM binder_delta->>'id'
   OR state_value->>'collection_id' IS DISTINCT FROM binder_delta->>'id'
   OR binder_delta->'after'->>'owner_user_id' IS DISTINCT FROM owner_id::text
   OR state_value->>'owner_user_id' IS DISTINCT FROM owner_id::text
   OR state_value->'version' IS DISTINCT FROM '0'::jsonb
   OR state_value->'layout_revision' IS DISTINCT FROM '0'::jsonb
   OR root_delta->>'id' IS DISTINCT FROM owner_id::text
   OR root_delta->'after'->>'owner_user_id' IS DISTINCT FROM owner_id::text
   OR (root_delta->'before'<>'null' AND root_delta->'before'->>'owner_user_id' IS DISTINCT FROM owner_id::text)
   OR (root_delta->'after'->>'inventory_revision')::numeric IS DISTINCT FROM coalesce((root_delta->'before'->>'inventory_revision')::numeric,0)+1
   OR jsonb_typeof(state_value->'preset_manifest'->'entries') IS DISTINCT FROM 'array'
   OR jsonb_array_length(state_value->'preset_manifest'->'entries')>4096
   OR EXISTS(SELECT 1 FROM jsonb_array_elements(original.changes) e
     WHERE e->>'table' NOT IN ('binders','storage_collection_state','inventory_owner_state','binder_slots'))
   OR (SELECT count(*) FROM jsonb_array_elements(original.changes) e WHERE e->>'table'<>'binder_slots')<>3
   OR (SELECT count(*) FROM jsonb_array_elements(original.changes) e WHERE e->>'table'='binder_slots')
     <>jsonb_array_length(state_value->'preset_manifest'->'entries') THEN
   RETURN jsonb_build_object('eligible',false);
 END IF;
 collection:=(binder_delta->>'id')::uuid;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(original.changes) e WHERE e->>'table'='binder_slots' AND (
     e->'before' IS DISTINCT FROM 'null'::jsonb OR e->'after'->>'id' IS DISTINCT FROM e->>'id'
     OR e->'after'->>'owner_user_id' IS DISTINCT FROM owner_id::text
     OR e->'after'->>'collection_id' IS DISTINCT FROM collection::text
     OR e->'after'->'version' IS DISTINCT FROM '0'::jsonb OR e->'after'->'status' IS DISTINCT FROM 'null'::jsonb
     OR e->'after'->'wanted_cards' IS DISTINCT FROM '[]'::jsonb
     OR (e->'after'->>'position')::integer NOT BETWEEN 0 AND jsonb_array_length(state_value->'preset_manifest'->'entries')-1
     OR e->'after'->'target' IS DISTINCT FROM state_value->'preset_manifest'->'entries'->((e->'after'->>'position')::integer)->'target'
     OR e->'after'->'preset_origin' IS DISTINCT FROM jsonb_build_object('source',state_value->'preset_manifest'->'source',
       'entryId',state_value->'preset_manifest'->'entries'->((e->'after'->>'position')::integer)->'id')))
   OR (SELECT count(DISTINCT e->'after'->'position') FROM jsonb_array_elements(original.changes) e WHERE e->>'table'='binder_slots')
     <>jsonb_array_length(state_value->'preset_manifest'->'entries') THEN
   RETURN jsonb_build_object('eligible',false);
 END IF;
 SELECT coalesce(array_agg(e->>'id'),'{}') INTO slot_keys FROM jsonb_array_elements(original.changes) e WHERE e->>'table'='binder_slots';
 IF binder_delta->'after'->'is_default'='true' THEN
   conflicts:=conflicts||jsonb_build_array(jsonb_build_object('entity','binders/'||collection,'reason','creation_default_requires_explicit_replacement'));
 END IF;
 SELECT coalesce(jsonb_agg(collection_audit_private.state('binders',to_jsonb(b)) ORDER BY b.id),'[]') INTO defaults
 FROM public.binders b WHERE b.owner_user_id=owner_id AND b.is_default AND b.id<>collection;
 IF defaults='[]' AND binder_delta->'after'->'is_default'<>'true' THEN
   conflicts:=conflicts||jsonb_build_array(jsonb_build_object('entity','binders/'||collection,'reason','creation_surviving_default_missing'));
 END IF;
 -- Creation removal is stricter than content recovery: even root counter edits conflict.
 IF (SELECT collection_audit_private.state('storage_collection_state',to_jsonb(s)) FROM public.storage_collection_state s WHERE s.collection_id=collection)
   IS DISTINCT FROM state_value THEN
   conflicts:=conflicts||jsonb_build_array(jsonb_build_object('entity','storage_collection_state/'||collection,'reason','creation_state_changed'));
 END IF;
 IF EXISTS(SELECT 1 FROM public.binder_slots s WHERE s.collection_id=collection AND NOT s.id=ANY(slot_keys)) THEN
   conflicts:=conflicts||jsonb_build_array(jsonb_build_object('entity','binders/'||collection,'reason','creation_slot_set_changed'));
 END IF;
 -- Inspect every FK, including future dependencies. Only the fully evidenced state/slots
 -- may be removed. Never silently cascade shares, wants, deliveries or config.
 FOR fk IN SELECT c.oid,c.conname,c.conrelid,c.confrelid,c.conkey,c.confkey FROM pg_constraint c
   WHERE c.contype='f' AND c.confrelid IN ('public.binders'::regclass,'public.storage_collection_state'::regclass,'public.binder_slots'::regclass)
     AND NOT (c.conrelid='public.storage_collection_state'::regclass AND c.confrelid='public.binders'::regclass)
     AND NOT (c.conrelid='public.binder_slots'::regclass AND c.confrelid='public.storage_collection_state'::regclass)
   ORDER BY c.oid LOOP
   SELECT string_agg(format('c.%I=p.%I',a.attname,b.attname),' AND ' ORDER BY k.n) INTO join_columns
   FROM unnest(fk.conkey,fk.confkey) WITH ORDINALITY k(child,parent,n)
   JOIN pg_attribute a ON a.attrelid=fk.conrelid AND a.attnum=k.child
   JOIN pg_attribute b ON b.attrelid=fk.confrelid AND b.attnum=k.parent;
   EXECUTE format('SELECT EXISTS(SELECT 1 FROM %s c JOIN %s p ON %s WHERE p.%I=$1)',
     fk.conrelid::regclass,fk.confrelid::regclass,join_columns,
     CASE WHEN fk.confrelid='public.binders'::regclass THEN 'id' ELSE 'collection_id' END) INTO occupied USING collection;
   references_proof:=references_proof||jsonb_build_array(jsonb_build_object('constraint',fk.conname,'table',fk.conrelid::regclass::text,
     'definition',pg_get_constraintdef(fk.oid),'occupied',occupied));
   IF occupied THEN conflicts:=conflicts||jsonb_build_array(jsonb_build_object('entity',fk.conrelid::regclass::text||'/'||collection,'reason','creation_dependent_rows')); END IF;
 END LOOP;
 -- Unknown later evidence cannot prove absence. Full later history remains unbounded.
 IF EXISTS(SELECT 1 FROM public.collection_activity h WHERE h.owner_user_id=owner_id AND h.id>event_id
   AND (h.format_version<>1 OR jsonb_typeof(h.changes) IS DISTINCT FROM 'array' OR h.changes='[]')) THEN
   conflicts:=conflicts||jsonb_build_array(jsonb_build_object('entity','binders/'||collection,'reason','creation_history_incomplete'));
 END IF;
 IF EXISTS(SELECT 1 FROM public.collection_activity h CROSS JOIN LATERAL jsonb_array_elements(h.changes) e
   WHERE h.owner_user_id=owner_id AND h.id>event_id AND h.format_version=1 AND (
     e->>'id'=collection::text OR e->>'id'=ANY(slot_keys)
     OR coalesce(e->'before'->>'collection_id',e->'before'->>'binder_id')=collection::text
     OR coalesce(e->'after'->>'collection_id',e->'after'->>'binder_id')=collection::text
     OR e->'before'->>'slot_id'=ANY(slot_keys) OR e->'after'->>'slot_id'=ANY(slot_keys))) THEN
   conflicts:=conflicts||jsonb_build_array(jsonb_build_object('entity','binders/'||collection,'reason','creation_later_dependency_change'));
 END IF;
 RETURN jsonb_build_object('eligible',true,'conflicts',conflicts,'dependencies',jsonb_build_object('defaults',defaults,'references',references_proof));
END $function$;

CREATE OR REPLACE FUNCTION collection_audit_private.recovery_plan_v1(actor uuid, owner_id uuid, event_id bigint, unassigned text[])
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
 SET "TimeZone" TO 'UTC'
AS $function$
DECLARE native_creation_proof jsonb; original public.collection_activity; d jsonb; row_value jsonb; b jsonb; a jsonb; key text; tbl text; col text;
 layout_collections text[]; inverse_rows jsonb[]:='{}'; inverse jsonb:='[]'; conflicts jsonb:='[]'; unsupported jsonb:='[]'; canonical_rows jsonb[]:='{}'; inverse_positions jsonb; inverse_slot_ids text[]; deps jsonb; root jsonb; member text;
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
 IF original.format_version<>1 OR jsonb_typeof(original.changes) IS DISTINCT FROM 'array'
   OR jsonb_array_length(original.changes)=0 THEN
   RETURN jsonb_build_object('supported',false,'unsupported',jsonb_build_array('missing_versioned_inverse'),'conflicts','[]'::jsonb);
 END IF;
 IF jsonb_array_length(original.changes)>16384 OR octet_length(original.changes::text)>16777216 THEN
   RETURN jsonb_build_object('supported',false,'unsupported',jsonb_build_array('evidence_bounds'),'conflicts','[]'::jsonb);
 END IF;
 -- canonical_recovery_timestamps: preserve every original persisted event.
 FOR d IN SELECT jsonb_array_elements(original.changes) LOOP
   col:=CASE d->>'table' WHEN 'inventory_items' THEN 'acquired_at' END;
   IF col IS NOT NULL THEN
     FOREACH key IN ARRAY ARRAY['before','after'] LOOP
       IF d->key->>col IS NOT NULL THEN
         d:=jsonb_set(d,ARRAY[key,col],to_jsonb((d->key->>col)::timestamptz));
       END IF;
     END LOOP;
   END IF;
   canonical_rows:=array_append(canonical_rows,d);
 END LOOP;
 original.changes:=to_jsonb(canonical_rows);
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
   IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(original.changes) e WHERE e->>'table'='inventory_items'
     AND e->>'id'=choice AND e->'before'<>'null' AND e->'after'='null') THEN
     RAISE EXCEPTION 'invalid_unassigned_recovery' USING ERRCODE='22023'; END IF;
   FOR d IN SELECT e FROM jsonb_array_elements(original.changes) e WHERE e->>'table'='inventory_placements' AND e->>'id'=choice LOOP
     IF d->'before'='null' OR d->'after'<>'null' THEN RAISE EXCEPTION 'invalid_unassigned_recovery' USING ERRCODE='22023'; END IF;
     key:=d->'before'->>'slot_id';
     SELECT e INTO row_value FROM jsonb_array_elements(original.changes) e WHERE e->>'table'='binder_slots' AND e->>'id'=key;
     IF row_value IS NULL OR row_value->'before'='null' OR row_value->'after'='null'
       OR row_value->'after'->'status'<>'null'
       OR (row_value->'before')-ARRAY['status','version'] IS DISTINCT FROM (row_value->'after')-ARRAY['status','version'] THEN
       RAISE EXCEPTION 'invalid_unassigned_recovery' USING ERRCODE='22023'; END IF;
     skipped_slots:=array_append(skipped_slots,key);
   END LOOP;
 END LOOP;
 FOR d IN SELECT e FROM jsonb_array_elements(original.changes) e LOOP
   tbl:=d->>'table'; key:=d->>'id'; b:=nullif(d->'before','null'); a:=nullif(d->'after','null');
   IF tbl NOT IN ('inventory_owner_state','storage_collection_state','inventory_items','binder_slots','inventory_placements','binders') THEN
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
     IF b IS NOT NULL AND a IS NOT NULL AND b-ARRAY['version','layout_revision'] IS DISTINCT FROM a-ARRAY['version','layout_revision'] THEN
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
   row_value:=current_rows->(tbl||'/'||key);
   IF tbl='storage_collection_state' AND a IS NOT NULL THEN
     IF row_value-ARRAY['version','layout_revision'] IS DISTINCT FROM a-ARRAY['version','layout_revision']
       OR (b IS NOT NULL AND b->'layout_revision' IS DISTINCT FROM a->'layout_revision' AND row_value->'layout_revision' IS DISTINCT FROM a->'layout_revision') THEN
       conflicts:=conflicts||jsonb_build_array(jsonb_build_object('entity',tbl||'/'||key,'reason','layout_or_config_changed'));
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
 FROM public.collection_activity h CROSS JOIN LATERAL jsonb_array_elements(h.changes) e
 WHERE h.owner_user_id=owner_id AND h.id>event_id AND h.format_version=1 AND (
   (e->>'table'='inventory_items' AND e->>'id'=ANY(item_ids))
   OR (e->>'table'='binder_slots' AND e->>'id'=ANY(slot_ids))
   OR (e->>'table'='binders' AND EXISTS(SELECT 1 FROM jsonb_array_elements(inverse) r WHERE r->>'table'='binders' AND r->>'id'=e->>'id'))
   OR (e->>'table'='inventory_placements' AND (e->>'id'=ANY(item_ids) OR e->'before'->>'slot_id'=ANY(slot_ids) OR e->'after'->>'slot_id'=ANY(slot_ids))));
 -- Layout/collection metadata is included in the reviewed token even for a content-only inverse.
 -- All dependency material stays private. The public wrapper emits only a hash and the changes.
 deps:=public.inventory_evidence_v1(owner_id,item_ids,slot_ids,collection_ids);
 IF (native_creation_proof->>'eligible')::boolean THEN deps:=deps||jsonb_build_object('nativeCreation',native_creation_proof->'dependencies'); END IF;
 SELECT collection_audit_private.state('inventory_owner_state',to_jsonb(s)) INTO root FROM public.inventory_owner_state s WHERE owner_user_id=owner_id;
 IF root IS NULL THEN unsupported:=unsupported||jsonb_build_array('inventory_storage_unavailable'); END IF;
 FOR choice IN SELECT c FROM unnest(collection_ids) c WHERE NOT EXISTS(SELECT 1 FROM public.storage_collection_state WHERE collection_id=c AND owner_user_id=owner_id) LOOP
   IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(inverse) e WHERE e->>'table'='storage_collection_state' AND e->>'id'=choice AND e->'after'='null') THEN
     conflicts:=conflicts||jsonb_build_array(jsonb_build_object('entity','storage_collection_state/'||choice,'reason','collection_unavailable'));
   END IF;
 END LOOP;
 RETURN jsonb_build_object('supported',jsonb_array_length(unsupported)=0,'unsupported',unsupported,'conflicts',conflicts,
   'inverse',inverse,'dependencies',deps,'root',root,'collectionIds',collection_ids);
END $function$;

CREATE OR REPLACE FUNCTION collection_audit_private.recovery_plan_v2(actor uuid, owner_id uuid, event_id bigint, unassigned text[], request jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
 SET "TimeZone" TO 'UTC'
AS $function$
DECLARE plan jsonb; original public.collection_activity; created jsonb; replacement jsonb; state_value jsonb;
 replacement_id uuid:=(request->>'replacementDefaultCollectionId')::uuid; conflicts jsonb; history jsonb;
BEGIN
 -- Retain every original evidence/history/FK check and every original conflict except the
 -- explicit-replacement placeholder, which only this separately versioned contract can resolve.
 plan:=collection_audit_private.recovery_plan_v1(actor,owner_id,event_id,unassigned);
 SELECT * INTO original FROM public.collection_activity WHERE id=event_id AND owner_user_id=owner_id;
 SELECT e INTO created FROM jsonb_array_elements(coalesce(plan->'inverse','[]')) e WHERE e->>'table'='binders';
 IF original.action IS DISTINCT FROM 'collection.create' OR NOT plan->'dependencies' ? 'nativeCreation'
   OR created->'before' IS DISTINCT FROM 'null' OR created->'after'->'is_default' IS DISTINCT FROM 'true' THEN
   RETURN plan||jsonb_build_object('supported',false,'unsupported',coalesce(plan->'unsupported','[]')||'"explicit_replacement_requires_default_creation"'::jsonb);
 END IF;
 SELECT coalesce(jsonb_agg(e),'[]') INTO conflicts FROM jsonb_array_elements(plan->'conflicts') e
 WHERE e->>'reason'<>'creation_default_requires_explicit_replacement';
 SELECT collection_audit_private.state('binders',to_jsonb(b)) INTO replacement FROM public.binders b
 WHERE b.id=replacement_id AND b.owner_user_id=owner_id AND b.id<>(created->>'id')::uuid AND NOT b.is_default;
 SELECT collection_audit_private.state('storage_collection_state',to_jsonb(s)) INTO state_value FROM public.storage_collection_state s
 WHERE s.collection_id=replacement_id AND s.owner_user_id=owner_id;
 IF replacement IS NULL OR state_value IS NULL THEN
   conflicts:=conflicts||jsonb_build_array(jsonb_build_object('entity','binders/'||replacement_id,'reason','creation_replacement_unavailable'));
 ELSIF state_value->'version' IS DISTINCT FROM request->'collections'->0->'version'
   OR state_value->'layout_revision' IS DISTINCT FROM request->'collections'->0->'layoutRevision' THEN
   conflicts:=conflicts||jsonb_build_array(jsonb_build_object('entity','binders/'||replacement_id,'reason','creation_replacement_version_changed'));
 END IF;
 IF plan->'root'->'inventory_revision' IS DISTINCT FROM request->'inventoryRevision' THEN
   conflicts:=conflicts||jsonb_build_array(jsonb_build_object('entity','owner/'||owner_id,'reason','creation_replacement_revision_changed'));
 END IF;
 -- ABA on the nominated collection after preview must stale the token even if all fields return.
 SELECT coalesce(jsonb_agg(h.id ORDER BY h.id),'[]') INTO history FROM public.collection_activity h
 WHERE h.owner_user_id=owner_id AND h.id>event_id AND EXISTS(
   SELECT 1 FROM jsonb_array_elements(h.changes) e WHERE e->>'id'=replacement_id::text
     OR coalesce(e->'before'->>'collection_id',e->'before'->>'binder_id')=replacement_id::text
     OR coalesce(e->'after'->>'collection_id',e->'after'->>'binder_id')=replacement_id::text);
 -- This is an ordinary binder update delta, so the unchanged recorder and deletion-recovery
 -- executor can reverse the whole event later, subject to their existing current-state rules.
 RETURN plan||jsonb_build_object('conflicts',conflicts,
   'inverse',(plan->'inverse')||jsonb_build_array(jsonb_build_object('table','binders','id',replacement_id,
     'before',jsonb_set(coalesce(replacement,'{}'),'{is_default}','true'),'after',replacement)),
   'collectionIds',(plan->'collectionIds')||jsonb_build_array(replacement_id),
   'dependencies',(plan->'dependencies')||jsonb_build_object('defaultReplacement',jsonb_build_object(
     'intent',request-ARRAY['operationId','planToken','confirmed'],'binder',replacement,'state',state_value,'history',history,
     'evidence',public.inventory_evidence_v1(owner_id,'{}','{}',ARRAY[replacement_id]))));
END $function$;

CREATE OR REPLACE FUNCTION collection_audit_private.recovery_preview_v1(actor uuid, owner_id uuid, event_id bigint, unassigned text[] DEFAULT '{}'::text[])
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE plan jsonb; token text;
BEGIN
 plan:=collection_audit_private.recovery_plan_v1(actor,owner_id,event_id,unassigned);
 IF (plan->>'supported')::boolean AND plan->'conflicts'='[]' THEN
   token:=encode(sha256(convert_to(jsonb_build_object('planVersion',1,'actor',actor,'owner',owner_id,'event',event_id,'unassigned',unassigned,'plan',plan)::text,'UTF8')),'hex');
 END IF;
 RETURN jsonb_build_object('planVersion',1,'eventId',event_id::text,'supported',plan->'supported','unsupported',plan->'unsupported',
   'conflicts',plan->'conflicts','planToken',token,'restoreUnassignedItemIds',unassigned,
   'changes',(SELECT coalesce(jsonb_agg(jsonb_build_object('table',e->'table','id',e->'id',
     'before',nullif(e->'after','null')-ARRAY['version','inventory_revision','layout_revision'],
     'after',nullif(e->'before','null')-ARRAY['version','inventory_revision','layout_revision'])),'[]') FROM jsonb_array_elements(coalesce(plan->'inverse','[]')) e),
   'rootRevisionsAdvance',true);
END $function$;

CREATE OR REPLACE FUNCTION collection_audit_private.recovery_preview_v2(actor uuid, owner_id uuid, request jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE plan jsonb; token text;
BEGIN
 PERFORM collection_audit_private.default_recovery_request_v2(request,false);
 plan:=collection_audit_private.recovery_plan_v2(actor,owner_id,(request->>'eventId')::bigint,'{}',request);
 IF (plan->>'supported')::boolean AND plan->'conflicts'='[]' THEN
   token:=encode(sha256(convert_to(jsonb_build_object('planVersion',2,'actor',actor,'owner',owner_id,'plan',plan)::text,'UTF8')),'hex');
 END IF;
 RETURN jsonb_build_object('planVersion',2,'eventId',request->>'eventId','supported',plan->'supported','unsupported',plan->'unsupported',
   'conflicts',plan->'conflicts','planToken',token,'restoreUnassignedItemIds','[]'::jsonb,
   'changes',(SELECT coalesce(jsonb_agg(jsonb_build_object('table',e->'table','id',e->'id',
     'before',nullif(e->'after','null')-ARRAY['version','inventory_revision','layout_revision'],
     'after',nullif(e->'before','null')-ARRAY['version','inventory_revision','layout_revision'])),'[]') FROM jsonb_array_elements(coalesce(plan->'inverse','[]')) e),
   'rootRevisionsAdvance',true);
END $function$;

CREATE OR REPLACE FUNCTION collection_audit_private.recovery_apply_v1(actor uuid, owner_id uuid, request jsonb, trusted_intent jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
 SET lock_timeout TO '3s'
AS $function$
DECLARE -- terminal_predicates_092
validation_slot_ids text[]; validation_item_ids text[]; plan jsonb; reviewed jsonb; prior public.developer_idempotency; digest text; result jsonb; d jsonb; b jsonb; a jsonb;
 tbl text; col text; columns text; updates text; choices text[]; revision bigint; saved_before bigint; allowed integer;
 event_id bigint; original_id bigint; affected uuid[]; ctx jsonb; lock_row record; changes jsonb[]:='{}'; r jsonb;
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
 PERFORM 1 FROM public.partnerships WHERE owner_user_id=owner_id FOR SHARE;
 IF actor<>owner_id AND NOT FOUND THEN
   RAISE EXCEPTION 'recovery_access_denied' USING ERRCODE='42501';
 END IF;
 IF NOT public.billing_partner_allowed(owner_id,actor) THEN RAISE EXCEPTION 'recovery_access_denied' USING ERRCODE='42501'; END IF;
 -- native creation management lock matches legacy/083 ordering, after membership.
 IF EXISTS(SELECT 1 FROM public.collection_activity WHERE id=(request->>'eventId')::bigint AND owner_user_id=owner_id AND action='collection.create') THEN
   PERFORM pg_advisory_xact_lock(hashtextextended(owner_id::text,6102));
 END IF;
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
 FOR lock_row IN SELECT id FROM public.binders WHERE owner_user_id=owner_id AND (plan->'dependencies' ? 'nativeCreation' OR id IN (SELECT v::uuid FROM jsonb_array_elements_text(plan->'collectionIds') v)) ORDER BY id FOR UPDATE LOOP END LOOP;
 FOR lock_row IN SELECT collection_id FROM public.storage_collection_state WHERE owner_user_id=owner_id AND collection_id IN (SELECT v::uuid FROM jsonb_array_elements_text(plan->'collectionIds') v) ORDER BY collection_id FOR UPDATE LOOP END LOOP;
 FOR lock_row IN SELECT id FROM public.inventory_items WHERE owner_user_id=owner_id AND id IN (SELECT v->>'id' FROM jsonb_array_elements(plan->'dependencies'->'items') v) ORDER BY id FOR UPDATE LOOP END LOOP;
 FOR lock_row IN SELECT id FROM public.binder_slots WHERE owner_user_id=owner_id AND id IN (SELECT v->>'id' FROM jsonb_array_elements(plan->'dependencies'->'slots') v) ORDER BY id FOR UPDATE LOOP END LOOP;
 FOR lock_row IN SELECT inventory_item_id FROM public.inventory_placements WHERE owner_user_id=owner_id AND inventory_item_id IN (SELECT v->>'inventory_item_id' FROM jsonb_array_elements(plan->'dependencies'->'placements') v) ORDER BY inventory_item_id FOR UPDATE LOOP END LOOP;
 reviewed:=collection_audit_private.recovery_preview_v1(actor,owner_id,original_id,choices);
 IF reviewed->'planToken'='null' OR reviewed->>'planToken' IS DISTINCT FROM request->>'planToken' THEN
   RAISE EXCEPTION 'recovery_plan_conflict' USING ERRCODE='HF092',DETAIL=(CASE WHEN reviewed->'conflicts'='[]' THEN jsonb_build_array(jsonb_build_object('entity','owner/'||owner_id::text,'reason','reviewed_dependencies_changed')) ELSE reviewed->'conflicts' END)::text;
 END IF;
 plan:=collection_audit_private.recovery_plan_v1(actor,owner_id,original_id,choices);
 saved_before:=public.slot_saved_count_v1(owner_id);
 SELECT coalesce(array_agg(v::uuid),'{}') INTO affected FROM jsonb_array_elements_text(plan->'collectionIds') v;
 -- All placements in the inverse are removed together, permitting a checked swap.
 WITH gone AS (DELETE FROM public.inventory_placements p USING jsonb_array_elements(plan->'inverse') e
 WHERE e->>'table'='inventory_placements' AND p.inventory_item_id=e->>'id' AND p.owner_user_id=owner_id RETURNING p.*)
 SELECT changes||array_agg(collection_audit_private.delta('inventory_placements',to_jsonb(gone),NULL)) INTO changes FROM gone;
 -- Deletes run child-first. Non-delta children would be silently cascaded, so block them.
 FOR d IN SELECT e FROM jsonb_array_elements(plan->'inverse') e WHERE e->'before'='null'
   ORDER BY CASE e->>'table' WHEN 'binder_slots' THEN 1 WHEN 'inventory_items' THEN 2 WHEN 'storage_collection_state' THEN 3 ELSE 4 END LOOP
   tbl:=d->>'table';
   IF tbl IN ('storage_collection_state','binders') THEN
     IF NOT plan->'dependencies' ? 'nativeCreation' THEN RAISE EXCEPTION 'recovery_unsupported_creation' USING ERRCODE='0A000'; END IF;
     -- State goes before its binder (order 3 < 4); a created collection has no shares (creation proof).
     IF tbl='binders' THEN
       DELETE FROM public.binders WHERE id=(d->>'id')::uuid AND owner_user_id=owner_id RETURNING to_jsonb(binders.*) INTO r;
     ELSE
       DELETE FROM public.storage_collection_state WHERE collection_id=(d->>'id')::uuid AND owner_user_id=owner_id RETURNING to_jsonb(storage_collection_state.*) INTO r;
     END IF;
     IF r IS NOT NULL THEN changes:=changes||collection_audit_private.delta(tbl,r,NULL); END IF;
     CONTINUE;
   END IF;
   IF tbl='inventory_placements' THEN CONTINUE; END IF;
   IF tbl='inventory_items' AND EXISTS(SELECT 1 FROM public.inventory_placements WHERE inventory_item_id=d->>'id')
     OR tbl='binder_slots' AND EXISTS(SELECT 1 FROM public.inventory_placements WHERE slot_id=d->>'id') THEN
     RAISE EXCEPTION 'recovery_dependency_conflict' USING ERRCODE='HF092'; END IF;
   EXECUTE format('DELETE FROM public.%1$I WHERE id=$1 AND owner_user_id=$2 RETURNING to_jsonb(%1$I.*)',tbl) INTO r USING d->>'id',owner_id;
   IF r IS NOT NULL THEN changes:=changes||collection_audit_private.delta(tbl,r,NULL); END IF;
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
     EXECUTE format('INSERT INTO public.%1$I(%2$s) SELECT %2$s FROM jsonb_populate_record(NULL::public.%1$I,$1) RETURNING to_jsonb(%1$I.*)',tbl,columns) INTO r USING b;
     changes:=changes||collection_audit_private.delta(tbl,NULL,r);
   ELSE
     EXECUTE format('WITH u AS (UPDATE public.%1$I t SET %2$s FROM jsonb_populate_record(NULL::public.%1$I,$1) r WHERE t.%3$I=r.%3$I AND t.owner_user_id=$2 RETURNING t.*)
       SELECT collection_audit_private.delta(%1$L,to_jsonb(o),to_jsonb(u)) FROM u JOIN public.%1$I o ON o.%3$I=u.%3$I',tbl,updates,col) INTO r USING b,owner_id;
     IF r IS NOT NULL THEN changes:=changes||r; END IF;
   END IF;
 END LOOP;
 -- Retain the exact original validation sets once, without rescanning full frozen JSON per placement.
 SELECT coalesce(array_agg(e->>'id') FILTER(WHERE e->>'table'='binder_slots'),'{}'),
   coalesce(array_agg(e->>'id') FILTER(WHERE e->>'table' IN ('inventory_items','inventory_placements')),'{}')
 INTO validation_slot_ids,validation_item_ids FROM jsonb_array_elements(plan->'inverse') e;
 -- Revalidate targets against the authoritative catalog, after all restored item/slot rows exist.
 FOR lock_row IN SELECT i.identity,s.target FROM public.inventory_placements p JOIN public.inventory_items i ON i.id=p.inventory_item_id
   JOIN public.binder_slots s ON s.id=p.slot_id WHERE p.owner_user_id=owner_id AND (p.slot_id=ANY(validation_slot_ids) OR p.inventory_item_id=ANY(validation_item_ids)) LOOP
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
 WITH u AS (UPDATE public.inventory_owner_state SET inventory_revision=inventory_revision+1 WHERE owner_user_id=owner_id RETURNING *)
 SELECT max(u.inventory_revision),changes||array_agg(collection_audit_private.delta('inventory_owner_state',to_jsonb(o),to_jsonb(u))) INTO revision,changes FROM u JOIN public.inventory_owner_state o ON o.owner_user_id=u.owner_user_id;
 WITH u AS (UPDATE public.storage_collection_state s SET version=version+1,layout_revision=layout_revision+CASE WHEN EXISTS(
   SELECT 1 FROM jsonb_array_elements(plan->'inverse') e WHERE e->>'table'='storage_collection_state' AND e->>'id'=s.collection_id::text
     AND e->'before'->'layout_revision' IS DISTINCT FROM e->'after'->'layout_revision' AND e->'after'<>'null') THEN 1 ELSE 0 END
 WHERE s.owner_user_id=owner_id AND collection_id=ANY(affected) AND NOT EXISTS(
   SELECT 1 FROM jsonb_array_elements(plan->'inverse') e WHERE e->>'table'='storage_collection_state' AND e->>'id'=s.collection_id::text AND e->'after'='null') RETURNING s.*)
 SELECT changes||array_agg(collection_audit_private.delta('storage_collection_state',to_jsonb(o),to_jsonb(u))) INTO changes FROM u JOIN public.storage_collection_state o ON o.collection_id=u.collection_id;
 ctx:=jsonb_build_object('actor',jsonb_build_object('kind','user','userId',actor),'source',trusted_intent->'source','clientId',trusted_intent->'clientId',
   'operationId',request->'operationId','batchId',trusted_intent->'batchId','clientOccurredAt',trusted_intent->'clientOccurredAt','action','recovery.apply');
 event_id:=collection_audit_private.record_v1(owner_id,ctx,'recovery.apply',changes,NULL,original_id);
 IF event_id IS NULL THEN RAISE EXCEPTION 'recovery_recorder_missing'; END IF;
 result:=jsonb_build_object('recoveredEventId',original_id::text,'eventId',event_id::text,'inventoryRevision',revision,
   'collections',(SELECT coalesce(jsonb_agg(jsonb_build_object('collectionId',collection_id,'version',version,'layoutRevision',layout_revision) ORDER BY collection_id),'[]')
     FROM public.storage_collection_state WHERE owner_user_id=owner_id AND collection_id=ANY(affected)));
 INSERT INTO public.developer_idempotency(actor_id,operation,request_key,input_digest,result,expires_at)
 VALUES(actor,'recovery_v1',request->>'operationId',digest,result,'infinity');
 RETURN result;
END $function$;

CREATE OR REPLACE FUNCTION collection_audit_private.recovery_apply_v2(actor uuid, owner_id uuid, request jsonb, trusted_intent jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
 SET lock_timeout TO '3s'
AS $function$
DECLARE -- terminal_predicates_092
validation_slot_ids text[]; validation_item_ids text[]; plan jsonb; reviewed jsonb; prior public.developer_idempotency; digest text; result jsonb; d jsonb; b jsonb; a jsonb;
 tbl text; col text; columns text; updates text; choices text[]; revision bigint; saved_before bigint; allowed integer;
 event_id bigint; original_id bigint; affected uuid[]; ctx jsonb; lock_row record; changes jsonb[]:='{}'; r jsonb;
BEGIN
 PERFORM collection_audit_private.default_recovery_request_v2(request,true);
 IF NOT public.inventory_object_v1(trusted_intent,ARRAY['source','clientId','batchId','clientOccurredAt'])
   OR NOT coalesce(trusted_intent->>'source' IN ('app','rest','mcp','import'),false)
   OR (trusted_intent->'clientId'<>'null' AND NOT public.inventory_id_v1(trusted_intent->'clientId'))
   OR (trusted_intent->'batchId'<>'null' AND NOT public.inventory_id_v1(trusted_intent->'batchId'))
   OR (trusted_intent->'clientOccurredAt'<>'null' AND (jsonb_typeof(trusted_intent->'clientOccurredAt')<>'string'
     OR NOT isfinite((trusted_intent->>'clientOccurredAt')::timestamptz))) THEN RAISE EXCEPTION 'invalid_trusted_context' USING ERRCODE='22023'; END IF;
 IF actor IS NULL OR owner_id IS NULL OR NOT EXISTS(SELECT 1 FROM auth.users WHERE id=actor) THEN RAISE EXCEPTION 'recovery_access_denied' USING ERRCODE='42501'; END IF;
 -- Owner recovery may restore a partner's wanted_by too. Hold current membership through
 -- commit for either caller, before the owner lock to preserve command lock ordering.
 PERFORM 1 FROM public.partnerships WHERE owner_user_id=owner_id FOR SHARE;
 IF actor<>owner_id AND NOT FOUND THEN
   RAISE EXCEPTION 'recovery_access_denied' USING ERRCODE='42501';
 END IF;
 IF NOT public.billing_partner_allowed(owner_id,actor) THEN RAISE EXCEPTION 'recovery_access_denied' USING ERRCODE='42501'; END IF;
 -- native creation management lock matches legacy/083 ordering, after membership.
 IF EXISTS(SELECT 1 FROM public.collection_activity WHERE id=(request->>'eventId')::bigint AND owner_user_id=owner_id AND action='collection.create') THEN
   PERFORM pg_advisory_xact_lock(hashtextextended(owner_id::text,6102));
 END IF;
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
 plan:=collection_audit_private.recovery_plan_v2(actor,owner_id,original_id,choices,request);
 IF NOT (plan->>'supported')::boolean THEN RAISE EXCEPTION 'recovery_unsupported' USING ERRCODE='0A000',DETAIL=(plan->'unsupported')::text; END IF;
 -- Lock existing dependencies in a fixed order before re-reading/review-token validation.
 -- Absent identity and destination races fail PK/UNIQUE/FK constraints, never UPSERT/displace.
 FOR lock_row IN SELECT id FROM public.binders WHERE owner_user_id=owner_id AND (plan->'dependencies' ? 'nativeCreation' OR id IN (SELECT v::uuid FROM jsonb_array_elements_text(plan->'collectionIds') v)) ORDER BY id FOR UPDATE LOOP END LOOP;
 FOR lock_row IN SELECT collection_id FROM public.storage_collection_state WHERE owner_user_id=owner_id AND collection_id IN (SELECT v::uuid FROM jsonb_array_elements_text(plan->'collectionIds') v) ORDER BY collection_id FOR UPDATE LOOP END LOOP;
 FOR lock_row IN SELECT id FROM public.inventory_items WHERE owner_user_id=owner_id AND id IN (SELECT v->>'id' FROM jsonb_array_elements(plan->'dependencies'->'items') v) ORDER BY id FOR UPDATE LOOP END LOOP;
 FOR lock_row IN SELECT id FROM public.binder_slots WHERE owner_user_id=owner_id AND id IN (SELECT v->>'id' FROM jsonb_array_elements(plan->'dependencies'->'slots') v) ORDER BY id FOR UPDATE LOOP END LOOP;
 FOR lock_row IN SELECT inventory_item_id FROM public.inventory_placements WHERE owner_user_id=owner_id AND inventory_item_id IN (SELECT v->>'inventory_item_id' FROM jsonb_array_elements(plan->'dependencies'->'placements') v) ORDER BY inventory_item_id FOR UPDATE LOOP END LOOP;
 reviewed:=collection_audit_private.recovery_preview_v2(actor,owner_id,request-ARRAY['operationId','planToken','confirmed']);
 IF reviewed->'planToken'='null' OR reviewed->>'planToken' IS DISTINCT FROM request->>'planToken' THEN
   RAISE EXCEPTION 'recovery_plan_conflict' USING ERRCODE='HF092',DETAIL=(CASE WHEN reviewed->'conflicts'='[]' THEN jsonb_build_array(jsonb_build_object('entity','owner/'||owner_id::text,'reason','reviewed_dependencies_changed')) ELSE reviewed->'conflicts' END)::text;
 END IF;
 plan:=collection_audit_private.recovery_plan_v2(actor,owner_id,original_id,choices,request);
 saved_before:=public.slot_saved_count_v1(owner_id);
 SELECT coalesce(array_agg(v::uuid),'{}') INTO affected FROM jsonb_array_elements_text(plan->'collectionIds') v;
 -- All placements in the inverse are removed together, permitting a checked swap.
 WITH gone AS (DELETE FROM public.inventory_placements p USING jsonb_array_elements(plan->'inverse') e
 WHERE e->>'table'='inventory_placements' AND p.inventory_item_id=e->>'id' AND p.owner_user_id=owner_id RETURNING p.*)
 SELECT changes||array_agg(collection_audit_private.delta('inventory_placements',to_jsonb(gone),NULL)) INTO changes FROM gone;
 -- Deletes run child-first. Non-delta children would be silently cascaded, so block them.
 FOR d IN SELECT e FROM jsonb_array_elements(plan->'inverse') e WHERE e->'before'='null'
   ORDER BY CASE e->>'table' WHEN 'binder_slots' THEN 1 WHEN 'inventory_items' THEN 2 WHEN 'storage_collection_state' THEN 3 ELSE 4 END LOOP
   tbl:=d->>'table';
   IF tbl IN ('storage_collection_state','binders') THEN
     IF NOT plan->'dependencies' ? 'nativeCreation' THEN RAISE EXCEPTION 'recovery_unsupported_creation' USING ERRCODE='0A000'; END IF;
     -- State goes before its binder (order 3 < 4); a created collection has no shares (creation proof).
     IF tbl='binders' THEN
       DELETE FROM public.binders WHERE id=(d->>'id')::uuid AND owner_user_id=owner_id RETURNING to_jsonb(binders.*) INTO r;
     ELSE
       DELETE FROM public.storage_collection_state WHERE collection_id=(d->>'id')::uuid AND owner_user_id=owner_id RETURNING to_jsonb(storage_collection_state.*) INTO r;
     END IF;
     IF r IS NOT NULL THEN changes:=changes||collection_audit_private.delta(tbl,r,NULL); END IF;
     CONTINUE;
   END IF;
   IF tbl='inventory_placements' THEN CONTINUE; END IF;
   IF tbl='inventory_items' AND EXISTS(SELECT 1 FROM public.inventory_placements WHERE inventory_item_id=d->>'id')
     OR tbl='binder_slots' AND EXISTS(SELECT 1 FROM public.inventory_placements WHERE slot_id=d->>'id') THEN
     RAISE EXCEPTION 'recovery_dependency_conflict' USING ERRCODE='HF092'; END IF;
   EXECUTE format('DELETE FROM public.%1$I WHERE id=$1 AND owner_user_id=$2 RETURNING to_jsonb(%1$I.*)',tbl) INTO r USING d->>'id',owner_id;
   IF r IS NOT NULL THEN changes:=changes||collection_audit_private.delta(tbl,r,NULL); END IF;
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
     EXECUTE format('INSERT INTO public.%1$I(%2$s) SELECT %2$s FROM jsonb_populate_record(NULL::public.%1$I,$1) RETURNING to_jsonb(%1$I.*)',tbl,columns) INTO r USING b;
     changes:=changes||collection_audit_private.delta(tbl,NULL,r);
   ELSE
     EXECUTE format('WITH u AS (UPDATE public.%1$I t SET %2$s FROM jsonb_populate_record(NULL::public.%1$I,$1) r WHERE t.%3$I=r.%3$I AND t.owner_user_id=$2 RETURNING t.*)
       SELECT collection_audit_private.delta(%1$L,to_jsonb(o),to_jsonb(u)) FROM u JOIN public.%1$I o ON o.%3$I=u.%3$I',tbl,updates,col) INTO r USING b,owner_id;
     IF r IS NOT NULL THEN changes:=changes||r; END IF;
   END IF;
 END LOOP;
 -- Retain the exact original validation sets once, without rescanning full frozen JSON per placement.
 SELECT coalesce(array_agg(e->>'id') FILTER(WHERE e->>'table'='binder_slots'),'{}'),
   coalesce(array_agg(e->>'id') FILTER(WHERE e->>'table' IN ('inventory_items','inventory_placements')),'{}')
 INTO validation_slot_ids,validation_item_ids FROM jsonb_array_elements(plan->'inverse') e;
 -- Revalidate targets against the authoritative catalog, after all restored item/slot rows exist.
 FOR lock_row IN SELECT i.identity,s.target FROM public.inventory_placements p JOIN public.inventory_items i ON i.id=p.inventory_item_id
   JOIN public.binder_slots s ON s.id=p.slot_id WHERE p.owner_user_id=owner_id AND (p.slot_id=ANY(validation_slot_ids) OR p.inventory_item_id=ANY(validation_item_ids)) LOOP
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
 WITH u AS (UPDATE public.inventory_owner_state SET inventory_revision=inventory_revision+1 WHERE owner_user_id=owner_id RETURNING *)
 SELECT max(u.inventory_revision),changes||array_agg(collection_audit_private.delta('inventory_owner_state',to_jsonb(o),to_jsonb(u))) INTO revision,changes FROM u JOIN public.inventory_owner_state o ON o.owner_user_id=u.owner_user_id;
 WITH u AS (UPDATE public.storage_collection_state s SET version=version+1,layout_revision=layout_revision+CASE WHEN EXISTS(
   SELECT 1 FROM jsonb_array_elements(plan->'inverse') e WHERE e->>'table'='storage_collection_state' AND e->>'id'=s.collection_id::text
     AND e->'before'->'layout_revision' IS DISTINCT FROM e->'after'->'layout_revision' AND e->'after'<>'null') THEN 1 ELSE 0 END
 WHERE s.owner_user_id=owner_id AND collection_id=ANY(affected) AND NOT EXISTS(
   SELECT 1 FROM jsonb_array_elements(plan->'inverse') e WHERE e->>'table'='storage_collection_state' AND e->>'id'=s.collection_id::text AND e->'after'='null') RETURNING s.*)
 SELECT changes||array_agg(collection_audit_private.delta('storage_collection_state',to_jsonb(o),to_jsonb(u))) INTO changes FROM u JOIN public.storage_collection_state o ON o.collection_id=u.collection_id;
 ctx:=jsonb_build_object('actor',jsonb_build_object('kind','user','userId',actor),'source',trusted_intent->'source','clientId',trusted_intent->'clientId',
   'operationId',request->'operationId','batchId',trusted_intent->'batchId','clientOccurredAt',trusted_intent->'clientOccurredAt','action','recovery.apply');
 event_id:=collection_audit_private.record_v1(owner_id,ctx,'recovery.apply',changes,NULL,original_id);
 IF event_id IS NULL THEN RAISE EXCEPTION 'recovery_recorder_missing'; END IF;
 result:=jsonb_build_object('recoveredEventId',original_id::text,'eventId',event_id::text,'inventoryRevision',revision,
   'collections',(SELECT coalesce(jsonb_agg(jsonb_build_object('collectionId',collection_id,'version',version,'layoutRevision',layout_revision) ORDER BY collection_id),'[]')
     FROM public.storage_collection_state WHERE owner_user_id=owner_id AND collection_id=ANY(affected)));
 INSERT INTO public.developer_idempotency(actor_id,operation,request_key,input_digest,result,expires_at)
 VALUES(actor,'recovery_v1',request->>'operationId',digest,result,'infinity');
 RETURN result;
END $function$;

CREATE OR REPLACE FUNCTION public.analytics_capture_price(row_data jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  quote JSONB; quotes JSONB; amount NUMERIC; provider_at TIMESTAMPTZ; quote_finish TEXT; quote_variant TEXT; quote_source TEXT; quote_confidence TEXT;
BEGIN
  -- Only cards someone owns or wants keep a price history.
  IF NOT EXISTS (
    SELECT 1 FROM public.inventory_items i
    WHERE i.identity->>'cardId'=row_data->>'card_id' AND COALESCE(i.identity->>'language','en')=COALESCE(row_data->>'language','en')
  ) AND NOT EXISTS (
    SELECT 1 FROM public.binder_slots s
    WHERE s.wanted_cards<>'[]'::jsonb AND s.wanted_cards @> jsonb_build_array(jsonb_build_object('card_id',row_data->>'card_id'))
      AND EXISTS (SELECT 1 FROM jsonb_array_elements(s.wanted_cards) w WHERE w->>'card_id'=row_data->>'card_id' AND COALESCE(w->>'card_language','en')=COALESCE(row_data->>'language','en'))
  ) THEN RETURN; END IF;
  quotes := CASE WHEN jsonb_typeof(row_data->'finish_prices')='array' THEN row_data->'finish_prices' ELSE '[]'::jsonb END;
  IF jsonb_array_length(quotes)=0 THEN quotes := jsonb_build_array(jsonb_build_object(
    'marketGbpAmount',COALESCE(NULLIF(row_data->'market_gbp_amount','null'::jsonb),row_data->'gbp_amount'),
    'source',row_data->'source','confidence',row_data->'confidence','updatedAt',row_data->'source_updated_at','finish','','variantKey','unverified')); END IF;
  FOR quote IN SELECT value FROM jsonb_array_elements(quotes) LOOP
    quote_source := quote->>'source';
    quote_finish := COALESCE(quote->>'finish','');
    quote_variant := quote->>'variantKey';
    quote_confidence := COALESCE(quote->>'confidence','unknown');
    IF quote_source IS NULL OR quote_source NOT IN ('tcgplayer','cardmarket','pokepulse') OR quote_variant IS NULL OR quote_variant='' OR quote_finish NOT IN ('','normal','holo','reverse_holo') OR quote_confidence NOT IN ('high','medium','low','unknown') OR jsonb_typeof(quote->'marketGbpAmount') IS DISTINCT FROM 'number' THEN CONTINUE; END IF;
    amount := (quote->>'marketGbpAmount')::numeric;
    IF amount <= 0 THEN CONTINUE; END IF;
    BEGIN
      provider_at := NULLIF(quote->>'updatedAt','')::timestamptz;
    EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN
      provider_at := NULL;
    END;
    INSERT INTO public.card_price_history(card_id,language,finish,variant_key,source,observed_day,gbp_amount,confidence,source_updated_at)
    VALUES(row_data->>'card_id',COALESCE(row_data->>'language','en'),quote_finish,quote_variant,quote_source,(now() AT TIME ZONE 'UTC')::date,amount,quote_confidence,provider_at)
    ON CONFLICT(card_id,language,variant_key,source,observed_day) DO UPDATE SET gbp_amount=EXCLUDED.gbp_amount,confidence=EXCLUDED.confidence,source_updated_at=EXCLUDED.source_updated_at,recorded_at=now();
  END LOOP;
  DELETE FROM public.card_price_history WHERE observed_day < (now() AT TIME ZONE 'UTC')::date - 89;
END
$function$;

CREATE OR REPLACE FUNCTION public.check_slot_placement_v1()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE slot_key text; slot_keys text[];
BEGIN
 IF TG_TABLE_NAME = 'binder_slots' THEN
   IF TG_OP = 'DELETE' THEN slot_keys := ARRAY[OLD.id];
   ELSIF TG_OP = 'INSERT' THEN slot_keys := ARRAY[NEW.id];
   ELSE slot_keys := ARRAY[OLD.id,NEW.id]; END IF;
 ELSE
   IF TG_OP = 'DELETE' THEN slot_keys := ARRAY[OLD.slot_id];
   ELSIF TG_OP = 'INSERT' THEN slot_keys := ARRAY[NEW.slot_id];
   ELSE slot_keys := ARRAY[OLD.slot_id,NEW.slot_id]; END IF;
 END IF;
 FOREACH slot_key IN ARRAY slot_keys LOOP
   IF EXISTS (SELECT 1 FROM public.binder_slots s WHERE s.id = slot_key
     AND (coalesce(s.status IN ('collected','finalized'),false) IS DISTINCT FROM
       EXISTS (SELECT 1 FROM public.inventory_placements p WHERE p.slot_id = slot_key))) THEN
     RAISE EXCEPTION 'Slot ownership requires exactly one placement' USING ERRCODE = '23514';
   END IF;
 END LOOP;
 RETURN NULL;
END $function$;


-- 6. Writers outside the storage commands record through statement-level triggers.
DO $$
DECLARE t text; op text;
BEGIN
 FOREACH t IN ARRAY ARRAY['binders','user_settings','binder_shares','binder_appearances'] LOOP
   FOREACH op IN ARRAY ARRAY['insert','update','delete'] LOOP
     EXECUTE format('DROP TRIGGER IF EXISTS collection_audit_%s ON public.%I',op,t);
     EXECUTE format('CREATE TRIGGER collection_audit_%1$s AFTER %2$s ON public.%3$I REFERENCING %4$s FOR EACH STATEMENT EXECUTE FUNCTION collection_audit_private.record_statement()',
       op,upper(op),t,CASE op WHEN 'insert' THEN 'NEW TABLE AS new_rows' WHEN 'delete' THEN 'OLD TABLE AS old_rows' ELSE 'OLD TABLE AS old_rows NEW TABLE AS new_rows' END);
   END LOOP;
 END LOOP;
END $$;

-- 7. Private helpers stay private.
REVOKE ALL ON FUNCTION collection_audit_private.delta(text,jsonb,jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION collection_audit_private.record_v1(uuid,jsonb,text,jsonb[],jsonb,bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION collection_audit_private.command_result(uuid,jsonb,text,jsonb[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION collection_audit_private.record_statement() FROM PUBLIC;
REVOKE ALL ON FUNCTION collection_audit_private.create_binder_rows(uuid,text,integer,boolean) FROM PUBLIC;

-- 8. changes now holds whole rows (certificates, labels, artwork). Only the server reads history and
--    projects it; signed-in users lose their direct column grants.
DO $$
DECLARE cols text;
BEGIN
 SELECT string_agg(quote_ident(column_name),',') INTO cols FROM information_schema.column_privileges
 WHERE table_schema='public' AND table_name='collection_activity' AND grantee IN ('authenticated','anon') AND privilege_type='SELECT';
 IF cols IS NOT NULL THEN EXECUTE format('REVOKE SELECT (%s) ON public.collection_activity FROM authenticated, anon',cols); END IF;
END $$;
REVOKE ALL ON public.collection_activity FROM authenticated, anon;

-- 9. The price-history gate now looks for wanted cards in slots; index the few slots that have wants.
CREATE INDEX IF NOT EXISTS binder_slots_wanted_cards ON public.binder_slots USING gin (wanted_cards jsonb_path_ops) WHERE wanted_cards <> '[]'::jsonb;
