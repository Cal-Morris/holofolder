-- 115: Drop collection_activity.command_evidence. It held a second copy of each command's before/after
-- state next to `changes`, and nothing reads it: Undo and Activity work from `changes`. record_v1 keeps
-- its signature so its many callers are unchanged; the `evidence` argument is now ignored.
-- Space is reclaimed only by a table rewrite: run `VACUUM FULL public.collection_activity` afterwards.
BEGIN;
SET LOCAL lock_timeout='3s';

CREATE OR REPLACE FUNCTION collection_audit_private.record_v1(owner_id uuid, ctx jsonb, action text, changes jsonb[], evidence jsonb, recovery_of bigint)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
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
   client_occurred_at,action,affected_entities,changes,recovery_of_event_id)
 VALUES(owner_id,clock_timestamp(),1,coalesce(ctx->'actor'->>'kind','unknown'),(ctx->'actor'->>'userId')::uuid,ctx->'actor'->>'job',coalesce(ctx->>'source','unknown'),
   ctx->>'clientId',ctx->>'operationId',ctx->>'batchId',(ctx->>'clientOccurredAt')::timestamptz,coalesce(action,'collection_change'),ids,delta,recovery_of)
 RETURNING id INTO event_id;
 RETURN event_id;
END $function$;

ALTER TABLE public.collection_activity DROP COLUMN IF EXISTS command_evidence;
COMMIT;
