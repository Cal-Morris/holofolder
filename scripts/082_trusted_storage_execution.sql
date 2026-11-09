-- Internal bridge only. App/REST/MCP exposure remains hard gated by #379.
-- Only this entrypoint is granted; owner-only prototypes and private helpers remain denied.
BEGIN;
SET LOCAL lock_timeout='3s';
DO $$ BEGIN
 IF to_regprocedure('collection_audit_private.frozen_restore_v1(public.pokemon_collection)') IS NULL THEN
   RAISE EXCEPTION 'storage_bridge_requires_081';
 END IF;
END $$;
CREATE OR REPLACE FUNCTION public.storage_execute_v1(operation text,owner_id uuid,request jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET lock_timeout='3s' SET statement_timeout='10s' AS $$
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
 IF operation NOT IN ('inventory','slots','recovery.preview','recovery.apply') OR operation IS NULL
   OR request IS NULL OR jsonb_typeof(request)<>'object' OR octet_length(request::text)>8388608 THEN
   RAISE EXCEPTION 'invalid_storage_request' USING ERRCODE='22023';
 END IF;
 -- The server binds the parsed original ID; the header's retry-stable intent is never caller JSON.
 IF operation<>'recovery.preview' AND ctx->>'operationId' IS DISTINCT FROM request->>'operationId' THEN
   RAISE EXCEPTION 'storage_operation_mismatch' USING ERRCODE='42501';
 END IF;
 intent:=jsonb_build_object('source',ctx->'source','clientId',ctx->'clientId','batchId',ctx->'batchId','clientOccurredAt',NULL);
 CASE operation
 WHEN 'inventory' THEN
   result:=public.inventory_command_v1(actor,owner_id,request,intent);
   result:=jsonb_build_object('inventoryRevision',result->'inventoryRevision','changed',result->'changed',
     'selectedItemIds',result->'selectedItemIds','acquiredItemIds',result->'acquiredItemIds');
 WHEN 'slots' THEN
   result:=public.slot_command_v1(actor,owner_id,request,jsonb_build_object('source',ctx->'source','clientId',ctx->'clientId'));
   result:=jsonb_build_object('inventoryRevision',result->'inventoryRevision','changed',result->'changed',
     'collectionVersion',result->'collectionVersion','layoutRevision',result->'layoutRevision','removedSlotIds',result->'removedSlotIds');
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
 WHEN 'recovery.apply' THEN result:=collection_audit_private.recovery_apply_v1(actor,owner_id,request,intent);
 END CASE;
 IF result IS NULL OR octet_length(result::text)>16777216 THEN RAISE EXCEPTION 'storage_result_unavailable' USING ERRCODE='55000'; END IF;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.storage_execute_v1(text,uuid,jsonb) FROM PUBLIC,anon,authenticated,holo_mcp,service_role;
GRANT EXECUTE ON FUNCTION public.storage_execute_v1(text,uuid,jsonb) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
