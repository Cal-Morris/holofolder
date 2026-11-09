-- Extend 027/032 in place. Account-lifetime metadata, never price-history retention.
-- Parent applies after 075 as ONE transaction. No conversion or runtime executor grants.
BEGIN;
SET LOCAL lock_timeout='3s';
ALTER TABLE public.collection_activity ALTER COLUMN pokemon_id DROP NOT NULL;
ALTER TABLE public.collection_activity ALTER COLUMN pokemon_name DROP NOT NULL;
ALTER TABLE public.collection_activity
 ADD COLUMN IF NOT EXISTS format_version integer NOT NULL DEFAULT 0,
 ADD COLUMN IF NOT EXISTS actor_kind text NOT NULL DEFAULT 'unknown',
 ADD COLUMN IF NOT EXISTS actor_user_id uuid,
 ADD COLUMN IF NOT EXISTS actor_job text,
 ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'unknown',
 ADD COLUMN IF NOT EXISTS client_id text,
 ADD COLUMN IF NOT EXISTS operation_id text,
 ADD COLUMN IF NOT EXISTS batch_id text,
 ADD COLUMN IF NOT EXISTS client_occurred_at timestamptz,
 ADD COLUMN IF NOT EXISTS action text NOT NULL DEFAULT 'legacy',
 ADD COLUMN IF NOT EXISTS affected_entities jsonb,
 ADD COLUMN IF NOT EXISTS changes jsonb,
 ADD COLUMN IF NOT EXISTS recovery_state jsonb,
 ADD COLUMN IF NOT EXISTS command_evidence jsonb;
-- No actor/entity FK: deleted entities and changed account names must not erase evidence.
-- Existing (owner_user_id,id DESC) index already supports private keyset pagination.
ALTER TABLE public.collection_activity DROP CONSTRAINT IF EXISTS collection_activity_actor_check;
ALTER TABLE public.collection_activity ADD CONSTRAINT collection_activity_actor_check
 CHECK (actor_kind IN ('unknown','user','system') AND (actor_kind='user')=(actor_user_id IS NOT NULL));
ALTER TABLE public.collection_activity DROP CONSTRAINT IF EXISTS collection_activity_metadata_check;
ALTER TABLE public.collection_activity ADD CONSTRAINT collection_activity_metadata_check CHECK (
 format_version IN (0,1) AND (format_version=0 OR (operation_id IS NOT NULL AND length(operation_id) BETWEEN 1 AND 200))
 AND (actor_kind='system')=(actor_job IS NOT NULL)
 AND source IN ('unknown','direct','app','rest','mcp','import','system','migration'));

REVOKE ALL ON public.collection_activity FROM PUBLIC,anon,authenticated,holo_mcp,service_role;
GRANT SELECT(id,owner_user_id,pokemon_id,pokemon_name,recorded_at,before_state,after_state,
 format_version,actor_kind,actor_user_id,actor_job,source,client_id,operation_id,batch_id,client_occurred_at,action,affected_entities,changes)
 ON public.collection_activity TO authenticated;
GRANT SELECT ON public.collection_activity TO service_role;
DROP POLICY IF EXISTS "Read own or partner activity" ON public.collection_activity;
CREATE POLICY "Read own or partner activity" ON public.collection_activity FOR SELECT TO authenticated USING (
 (owner_user_id=(select auth.uid()) OR owner_user_id IN (
 SELECT owner_user_id FROM public.partnerships WHERE user1_id=(select auth.uid()) OR user2_id=(select auth.uid())))
 AND public.billing_partner_allowed(owner_user_id,(select auth.uid())));

-- Ephemeral transactional accumulator, NOT another history feed. Always empty after commit.
-- No caller-writable GUC establishes context. Runtime roles cannot access this schema/table.
CREATE SCHEMA IF NOT EXISTS collection_audit_private;
REVOKE ALL ON SCHEMA collection_audit_private FROM PUBLIC,anon,authenticated,holo_mcp,service_role;
CREATE TABLE IF NOT EXISTS collection_audit_private.pending (
 transaction_id bigint NOT NULL, owner_id uuid NOT NULL, context jsonb NOT NULL,
 command_evidence jsonb,
 PRIMARY KEY(transaction_id,owner_id)
);
REVOKE ALL ON collection_audit_private.pending FROM PUBLIC,anon,authenticated,holo_mcp,service_role;
CREATE TABLE IF NOT EXISTS collection_audit_private.deltas (
 transaction_id bigint NOT NULL,owner_id uuid NOT NULL,entity text NOT NULL,table_name text NOT NULL,entity_id text NOT NULL,
 before_state jsonb,after_state jsonb,PRIMARY KEY(transaction_id,owner_id,entity)
);
REVOKE ALL ON collection_audit_private.deltas FROM PUBLIC,anon,authenticated,holo_mcp,service_role;


CREATE OR REPLACE FUNCTION collection_audit_private.context(owner_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE value jsonb; actor uuid; role_name text:=current_setting('role',true);
BEGIN
 -- Only a service-key request can establish a server header. Never copy inbound user headers.
 IF role_name='service_role' THEN
   value:=coalesce(nullif(current_setting('request.headers',true),''),'{}')::jsonb->>'x-holo-audit-context';
   IF value IS NOT NULL THEN value:=(value #>> '{}')::jsonb; END IF;
   IF value IS NOT NULL THEN
     IF value->'actor'->>'kind'='system' AND value->>'source' IN ('system','migration')
       AND length(value->'actor'->>'job') BETWEEN 1 AND 80 AND length(value->>'operationId') BETWEEN 1 AND 200 THEN
       RETURN jsonb_build_object('actor',jsonb_build_object('kind','system','job',value->'actor'->'job'),'source',value->'source','operationId',value->'operationId','batchId',value->'batchId');
     END IF;
     IF NOT coalesce(value->'actor'->>'kind'='user' AND value->>'source' IN ('app','rest','mcp','import')
       AND length(value->>'operationId') BETWEEN 1 AND 200,false) THEN RAISE EXCEPTION 'invalid_trusted_audit_context'; END IF;
     actor:=(value->'actor'->>'userId')::uuid;
     IF actor IS NULL OR NOT EXISTS(SELECT 1 FROM auth.users WHERE id=actor) THEN RAISE EXCEPTION 'invalid_audit_actor'; END IF;
     IF actor<>owner_id THEN
       PERFORM 1 FROM public.partnerships WHERE owner_user_id=owner_id AND actor IN(user1_id,user2_id) FOR KEY SHARE;
       IF NOT FOUND THEN RAISE EXCEPTION 'audit_actor_access_denied' USING ERRCODE='42501'; END IF;
     END IF;
     RETURN jsonb_build_object('actor',jsonb_build_object('kind','user','userId',actor),'source',value->'source',
       'clientId',value->'clientId','operationId',value->'operationId','batchId',value->'batchId','clientOccurredAt',value->'clientOccurredAt');
   END IF;
 ELSIF role_name='authenticated' THEN
   actor:=(select auth.uid());
   IF actor IS NOT NULL THEN RETURN jsonb_build_object('actor',jsonb_build_object('kind','user','userId',actor),'source','direct','operationId',gen_random_uuid()); END IF;
 END IF;
 RETURN jsonb_build_object('actor',jsonb_build_object('kind','unknown'),'source','unknown','operationId',gen_random_uuid());
END $$;

-- Explicit projection of safe persisted fields. Tokens, URLs, queues and credentials never enter history.
CREATE OR REPLACE FUNCTION collection_audit_private.state(table_name text,row_data jsonb) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
BEGIN
 IF row_data IS NULL THEN RETURN NULL; END IF;
 CASE table_name
 WHEN 'binder_shares' THEN RETURN jsonb_build_object('id',row_data->'id','owner_user_id',row_data->'owner_user_id',
   'binder_id',row_data->'binder_id','is_enabled',row_data->'is_enabled','show_prices',row_data->'show_prices');
 WHEN 'binder_appearances' THEN RETURN row_data-ARRAY['updated_at','created_at'];
 ELSE RETURN row_data-ARRAY['updated_at','created_at'];
 END CASE;
END $$;
CREATE OR REPLACE FUNCTION collection_audit_private.redact(value jsonb) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE result jsonb; key text; child jsonb;
BEGIN
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
END $$;

CREATE OR REPLACE FUNCTION collection_audit_private.capture() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
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
 entity:=TG_TABLE_NAME||'/'||coalesce(row_data->>'id',row_data->>'inventory_item_id',row_data->>'collection_id',row_data->>'legacy_row_id',owner_id::text);
 INSERT INTO collection_audit_private.pending(transaction_id,owner_id,context)
 VALUES(tx,owner_id,collection_audit_private.context(owner_id)) ON CONFLICT DO NOTHING;
 INSERT INTO collection_audit_private.deltas(transaction_id,owner_id,entity,table_name,entity_id,before_state,after_state)
 VALUES(tx,owner_id,entity,TG_TABLE_NAME,substr(entity,position('/' IN entity)+1),b,a)
 ON CONFLICT ON CONSTRAINT deltas_pkey DO UPDATE SET after_state=excluded.after_state;
 IF TG_TABLE_NAME='storage_collection_state' AND a->>'authority'='slots' AND a->'conversion_receipt' IS NOT NULL AND a->'conversion_receipt'<>'null'
   AND b->>'authority' IS DISTINCT FROM 'slots' THEN
   UPDATE collection_audit_private.pending SET context=context||jsonb_build_object('action','legacy_conversion'),command_evidence=a->'conversion_receipt'
   WHERE transaction_id=tx AND pending.owner_id=capture.owner_id;
 END IF;
 RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION collection_audit_private.flush() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE pending_row collection_audit_private.pending; delta jsonb; ids jsonb; legacy jsonb; ctx jsonb;
BEGIN
 DELETE FROM collection_audit_private.pending WHERE transaction_id=NEW.transaction_id AND owner_id=NEW.owner_id RETURNING * INTO pending_row;
 IF NOT FOUND THEN RETURN NULL; END IF;
 WITH removed AS (DELETE FROM collection_audit_private.deltas WHERE transaction_id=NEW.transaction_id AND owner_id=NEW.owner_id RETURNING *)
 SELECT jsonb_agg(jsonb_build_object('table',table_name,'id',entity_id,'before',before_state,'after',after_state) ORDER BY entity)
 INTO delta FROM removed WHERE before_state IS DISTINCT FROM after_state;
 IF delta IS NULL OR NOT EXISTS(SELECT 1 FROM auth.users WHERE id=NEW.owner_id) THEN RETURN NULL; END IF;
 -- Explicit safety bound, never truncate evidence. Large-collection command admission remains #383's gate.
 IF jsonb_array_length(delta)>16384 OR octet_length(delta::text)>16777216 THEN RAISE EXCEPTION 'audit_evidence_too_large'; END IF;
 SELECT jsonb_build_object(
 'inventoryItemIds',(SELECT coalesce(jsonb_agg(DISTINCT id ORDER BY id),'[]') FROM (
   SELECT v->>'id' id FROM jsonb_array_elements(delta) v WHERE v->>'table'='inventory_items'
   UNION SELECT v->'before'->>'inventory_item_id' FROM jsonb_array_elements(delta) v WHERE v->>'table'='inventory_placements'
   UNION SELECT v->'after'->>'inventory_item_id' FROM jsonb_array_elements(delta) v WHERE v->>'table'='inventory_placements'
   UNION SELECT jsonb_array_elements_text(coalesce(pending_row.context->'affectedEntities'->'inventoryItemIds','[]'))) touched WHERE id IS NOT NULL),
 'slotIds',(SELECT coalesce(jsonb_agg(DISTINCT id ORDER BY id),'[]') FROM (
   SELECT v->>'id' id FROM jsonb_array_elements(delta) v WHERE v->>'table'='binder_slots'
   UNION SELECT v->'before'->>'slot_id' FROM jsonb_array_elements(delta) v WHERE v->>'table'='inventory_placements'
   UNION SELECT v->'after'->>'slot_id' FROM jsonb_array_elements(delta) v WHERE v->>'table'='inventory_placements'
   UNION SELECT jsonb_array_elements_text(coalesce(pending_row.context->'affectedEntities'->'slotIds','[]'))) touched WHERE id IS NOT NULL),
 'collectionIds',(SELECT coalesce(jsonb_agg(DISTINCT id ORDER BY id),'[]') FROM (
   SELECT coalesce(v->'after'->>'collection_id',v->'before'->>'collection_id',v->'after'->>'binder_id',v->'before'->>'binder_id',
     CASE WHEN v->>'table'='binders' THEN v->>'id' END) id FROM jsonb_array_elements(delta) v
   UNION SELECT jsonb_array_elements_text(coalesce(pending_row.context->'affectedEntities'->'collectionIds','[]'))) touched WHERE id IS NOT NULL)) INTO ids;
 IF jsonb_array_length(delta)=1 AND delta->0->>'table'='pokemon_collection' THEN legacy:=delta->0; END IF;
 ctx:=pending_row.context;
 INSERT INTO public.collection_activity(owner_user_id,pokemon_id,pokemon_name,recorded_at,before_state,after_state,
 format_version,actor_kind,actor_user_id,actor_job,source,client_id,operation_id,batch_id,client_occurred_at,action,affected_entities,changes,recovery_state,command_evidence)
 VALUES(NEW.owner_id,coalesce(legacy->'after'->>'pokemon_id',legacy->'before'->>'pokemon_id')::integer,
 coalesce(legacy->'after'->>'pokemon_name',legacy->'before'->>'pokemon_name'),clock_timestamp(),
 public.analytics_collection_state(nullif(legacy->'before','null')),public.analytics_collection_state(nullif(legacy->'after','null')),
 1,coalesce(ctx->'actor'->>'kind','unknown'),(ctx->'actor'->>'userId')::uuid,ctx->'actor'->>'job',coalesce(ctx->>'source','unknown'),ctx->>'clientId',ctx->>'operationId',ctx->>'batchId',
 (ctx->>'clientOccurredAt')::timestamptz,coalesce(ctx->>'action',CASE WHEN legacy IS NOT NULL THEN 'collection_item' ELSE 'collection_change' END),
 ids,collection_audit_private.redact(delta),delta,pending_row.command_evidence);
 RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS flush_audit ON collection_audit_private.pending;
CREATE CONSTRAINT TRIGGER flush_audit AFTER INSERT ON collection_audit_private.pending DEFERRABLE INITIALLY DEFERRED
 FOR EACH ROW EXECUTE FUNCTION collection_audit_private.flush();

CREATE OR REPLACE FUNCTION collection_audit_private.immutable() RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF TG_OP='DELETE' AND NOT EXISTS(SELECT 1 FROM auth.users WHERE id=OLD.owner_user_id) THEN RETURN OLD; END IF;
 RAISE EXCEPTION 'audit_immutable' USING ERRCODE='42501';
END $$;
DROP TRIGGER IF EXISTS audit_immutable ON public.collection_activity;
CREATE TRIGGER audit_immutable BEFORE UPDATE OR DELETE ON public.collection_activity FOR EACH ROW EXECUTE FUNCTION collection_audit_private.immutable();

-- Retain 032's indexed price observation and its trigger, replace only the old history insertion.
CREATE OR REPLACE FUNCTION public.record_collection_activity() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE before_row JSONB; after_row JSONB; row_data JSONB; price_row RECORD;
BEGIN
  IF TG_OP <> 'INSERT' THEN before_row := to_jsonb(OLD); END IF;
  IF TG_OP <> 'DELETE' THEN after_row := to_jsonb(NEW); END IF;
  row_data := COALESCE(after_row,before_row);
  IF after_row IS NOT NULL THEN
    FOR price_row IN
      SELECT p.* FROM public.card_prices p
      JOIN (
        SELECT after_row->>'card_id' AS card_id, COALESCE(after_row->>'card_language','en') AS language
        UNION
        SELECT w->>'card_id', COALESCE(w->>'card_language','en')
        FROM jsonb_array_elements(CASE WHEN jsonb_typeof(after_row->'wanted_cards')='array' THEN after_row->'wanted_cards' ELSE '[]'::jsonb END) w
      ) tracked ON p.card_id=tracked.card_id AND p.language=tracked.language
    LOOP PERFORM public.analytics_capture_price(to_jsonb(price_row)); END LOOP;
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END
$$;

CREATE OR REPLACE FUNCTION collection_audit_private.reject_truncate() RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $$ BEGIN
 RAISE EXCEPTION 'audit_requires_row_deletion' USING ERRCODE='42501';
END $$;
DO $$ DECLARE name text; BEGIN
 FOREACH name IN ARRAY ARRAY['pokemon_collection','binders','user_settings','binder_shares','binder_appearances',
 'inventory_owner_state','storage_collection_state','inventory_items','binder_slots','inventory_placements','binder_legacy_rows'] LOOP
   EXECUTE format('DROP TRIGGER IF EXISTS collection_audit_no_truncate ON public.%I',name);
   EXECUTE format('CREATE TRIGGER collection_audit_no_truncate BEFORE TRUNCATE ON public.%I FOR EACH STATEMENT EXECUTE FUNCTION collection_audit_private.reject_truncate()',name);
   EXECUTE format('DROP TRIGGER IF EXISTS collection_audit_capture ON public.%I',name);
   EXECUTE format('CREATE TRIGGER collection_audit_capture AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION collection_audit_private.capture()',name);
 END LOOP;
END $$;

-- Owner-only integration for the staged commands. Use final-root evidence, never intermediate afters.
CREATE OR REPLACE FUNCTION collection_audit_private.command_result(owner_id uuid,result jsonb,action text) RETURNS void
LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 UPDATE collection_audit_private.pending SET context=(result->'context')||jsonb_build_object('action',action),
 command_evidence=jsonb_build_object('before',(SELECT coalesce(jsonb_agg(v->'before'),'[]') FROM jsonb_array_elements(coalesce(result->'evidence','[]')) v),
 'after',result->'after','inventoryRevision',result->'inventoryRevision','acquiredItemIds',result->'acquiredItemIds','selectedItemIds',result->'selectedItemIds')
 WHERE transaction_id=txid_current() AND pending.owner_id=command_result.owner_id;
END $$;
DO $integration$
DECLARE body text; signature text; name text;
BEGIN
 FOREACH signature IN ARRAY ARRAY['public.slot_command_v1(uuid,uuid,jsonb,jsonb)','public.inventory_command_v1(uuid,uuid,jsonb,jsonb)'] LOOP
   SELECT pg_get_functiondef(signature::regprocedure) INTO body;
   name:=CASE WHEN signature LIKE '%inventory_command%' THEN 'inventory' ELSE 'slots' END;
   IF position('collection_audit_private.command_result' IN body)=0 THEN
     IF position(' INSERT INTO public.developer_idempotency(actor_id,operation,request_key,input_digest,result,expires_at)' IN body)=0 THEN
       RAISE EXCEPTION 'audit_integration_signature_changed: %',signature;
     END IF;
     body:=replace(body,' INSERT INTO public.developer_idempotency(actor_id,operation,request_key,input_digest,result,expires_at)',
       ' PERFORM collection_audit_private.command_result(owner_id,result,'||quote_literal(name)||'||''.''||CASE WHEN jsonb_array_length(request->''commands'')=1 THEN request->''commands''->0->>''kind'' ELSE ''bulk'' END);'||chr(10)||' INSERT INTO public.developer_idempotency(actor_id,operation,request_key,input_digest,result,expires_at)');
     EXECUTE body;
   END IF;
 END LOOP;
END $integration$;
-- All staged executor/helper ACLs remain exactly as 074/075. No grants here.
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA collection_audit_private FROM PUBLIC,anon,authenticated,holo_mcp,service_role;
NOTIFY pgrst,'reload schema';
COMMIT;

-- Apply separately: outside the DDL transaction, ONE statement, before admitting trusted writes.
-- Legacy operation_id is NULL; no historical rewrite or speculative backfill.
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS collection_activity_operation_once
 ON public.collection_activity(owner_user_id,operation_id) WHERE format_version=1;
