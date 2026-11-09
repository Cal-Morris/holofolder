-- Internal version-2 opt-in to 075's explicit default replacement policy.
-- Version 1 and its receipts/plans remain unchanged. No runtime grants or route enablement.
BEGIN;
SET LOCAL lock_timeout='3s';

CREATE OR REPLACE FUNCTION collection_audit_private.default_recovery_request_v2(request jsonb,applying boolean)
RETURNS void LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE keys text[]:=ARRAY['eventId','restoreUnassignedItemIds','planVersion','replacementDefaultCollectionId','inventoryRevision','collections']; token jsonb;
BEGIN
 IF applying THEN keys:=keys||ARRAY['operationId','planToken','confirmed']; END IF;
 IF NOT public.inventory_object_v1(request,keys) OR (SELECT count(*) FROM jsonb_object_keys(request))<>cardinality(keys)
   OR request->'planVersion' IS DISTINCT FROM '2' OR jsonb_typeof(request->'eventId') IS DISTINCT FROM 'string'
   OR (request->>'eventId')!~'^[1-9][0-9]{0,18}$' OR (request->>'eventId')::numeric>9223372036854775807
   OR request->'restoreUnassignedItemIds' IS DISTINCT FROM '[]' OR NOT public.inventory_revision_v1(request->'inventoryRevision')
   OR jsonb_typeof(request->'replacementDefaultCollectionId') IS DISTINCT FROM 'string'
   OR (request->>'replacementDefaultCollectionId')!~'^[0-9a-fA-F]{8}(-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}$'
   OR jsonb_typeof(request->'collections') IS DISTINCT FROM 'array' OR jsonb_array_length(request->'collections')<>1
   OR octet_length(request::text)>1048576 THEN RAISE EXCEPTION 'invalid_recovery_request' USING ERRCODE='22023'; END IF;
 token:=request->'collections'->0;
 IF NOT public.inventory_object_v1(token,ARRAY['collectionId','version','layoutRevision'])
   OR (SELECT count(*) FROM jsonb_object_keys(token))<>3
   OR token->'collectionId' IS DISTINCT FROM request->'replacementDefaultCollectionId'
   OR NOT public.inventory_revision_v1(token->'version') OR NOT public.inventory_revision_v1(token->'layoutRevision') THEN
   RAISE EXCEPTION 'invalid_recovery_request' USING ERRCODE='22023'; END IF;
 IF applying AND (request->'confirmed' IS DISTINCT FROM 'true' OR NOT public.inventory_id_v1(request->'operationId')
   OR length(request->>'operationId') NOT BETWEEN 8 AND 100 OR jsonb_typeof(request->'planToken') IS DISTINCT FROM 'string'
   OR (request->>'planToken')!~'^[a-f0-9]{64}$') THEN RAISE EXCEPTION 'invalid_recovery_request' USING ERRCODE='22023'; END IF;
END $$;

CREATE OR REPLACE FUNCTION collection_audit_private.recovery_plan_v2(actor uuid,owner_id uuid,event_id bigint,unassigned text[],request jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' SET TimeZone='UTC' AS $$
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
 -- Match 075: an accessible declared collection must have current native slot authority.
 SELECT collection_audit_private.state('storage_collection_state',to_jsonb(s)) INTO state_value FROM public.storage_collection_state s
 WHERE s.collection_id=replacement_id AND s.owner_user_id=owner_id AND s.authority='slots';
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
   SELECT 1 FROM jsonb_array_elements(h.recovery_state) e WHERE e->>'id'=replacement_id::text
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
END $$;

CREATE OR REPLACE FUNCTION collection_audit_private.recovery_preview_v2(actor uuid,owner_id uuid,request jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE plan jsonb; token text;
BEGIN
 PERFORM collection_audit_private.default_recovery_request_v2(request,false);
 plan:=collection_audit_private.recovery_plan_v2(actor,owner_id,(request->>'eventId')::bigint,'{}',request);
 IF (plan->>'supported')::boolean AND plan->'conflicts'='[]' THEN
   token:=encode(sha256(convert_to(jsonb_build_object('planVersion',2,'actor',actor,'owner',owner_id,'plan',plan)::text,'UTF8')),'hex');
 END IF;
 RETURN jsonb_build_object('planVersion',2,'eventId',request->>'eventId','supported',plan->'supported','unsupported',plan->'unsupported',
   'conflicts',plan->'conflicts','planToken',token,'restoreUnassignedItemIds','[]'::jsonb,
   'changes',collection_audit_private.redact((SELECT coalesce(jsonb_agg(jsonb_build_object('table',e->'table','id',e->'id',
     'before',nullif(e->'after','null')-ARRAY['version','inventory_revision','layout_revision'],
     'after',nullif(e->'before','null')-ARRAY['version','inventory_revision','layout_revision'])),'[]') FROM jsonb_array_elements(coalesce(plan->'inverse','[]')) e)),
   'rootRevisionsAdvance',true);
END $$;

-- Derive the opt-in executor from installed 084/081, keeping all locking, fresh reads,
-- frozen restoration, current counters, recorder, cancellation and lifetime replay behavior.
DO $integration$
DECLARE body text; anchor text;
BEGIN
 SELECT pg_get_functiondef('collection_audit_private.recovery_apply_v1(uuid,uuid,jsonb,jsonb)'::regprocedure) INTO body;
 IF position('native creation management lock' IN body)=0 OR position('converted source locks' IN body)=0
   OR (length(body)-length(replace(body,'plan:=collection_audit_private.recovery_plan_v1','')))/length('plan:=collection_audit_private.recovery_plan_v1')<>2 THEN
   RAISE EXCEPTION 'default_creation_recovery_requires_084'; END IF;
 body:=replace(body,'recovery_apply_v1','recovery_apply_v2');
 anchor:=' IF NOT public.inventory_object_v1(trusted_intent';
 IF position(anchor IN body)=0 THEN RAISE EXCEPTION 'default_creation_recovery_validation_changed'; END IF;
 -- Replace only the request validation block with the strict v2 parser.
 body:=substring(body FROM 1 FOR position(' IF NOT public.inventory_object_v1(request' IN body)-1)
   ||' PERFORM collection_audit_private.default_recovery_request_v2(request,true);'||chr(10)
   ||substring(body FROM position(anchor IN body));
 body:=replace(body,'recovery_plan_v1(actor,owner_id,original_id,choices)','recovery_plan_v2(actor,owner_id,original_id,choices,request)');
 body:=replace(body,'recovery_preview_v1(actor,owner_id,original_id,choices)',
   'recovery_preview_v2(actor,owner_id,request-ARRAY[''operationId'',''planToken'',''confirmed''])');
 EXECUTE body;
 -- Extend only the existing service gateway's dispatch. No role/grant/transport bypass.
 SELECT pg_get_functiondef('public.storage_execute_v1(text,uuid,jsonb)'::regprocedure) INTO body;
 IF position('recovery.preview.v2' IN body)=0 THEN
   body:=replace(body,'''recovery.preview'',''recovery.apply''','''recovery.preview'',''recovery.apply'',''recovery.preview.v2'',''recovery.apply.v2''');
   body:=replace(body,'IF operation<>''recovery.preview'' AND','IF operation NOT IN (''recovery.preview'',''recovery.preview.v2'') AND');
   anchor:=' WHEN ''recovery.apply'' THEN result:=collection_audit_private.recovery_apply_v1(actor,owner_id,request,intent);';
   IF position(anchor IN body)=0 THEN RAISE EXCEPTION 'default_creation_recovery_gateway_changed'; END IF;
   body:=replace(body,anchor,anchor||chr(10)||$dispatch$ WHEN 'recovery.preview.v2' THEN result:=collection_audit_private.recovery_preview_v2(actor,owner_id,request);
 WHEN 'recovery.apply.v2' THEN result:=collection_audit_private.recovery_apply_v2(actor,owner_id,request,intent);$dispatch$);
   EXECUTE body;
 END IF;
END $integration$;
REVOKE ALL ON FUNCTION collection_audit_private.default_recovery_request_v2(jsonb,boolean),
 collection_audit_private.recovery_plan_v2(uuid,uuid,bigint,text[],jsonb),
 collection_audit_private.recovery_preview_v2(uuid,uuid,jsonb),
 collection_audit_private.recovery_apply_v2(uuid,uuid,jsonb,jsonb) FROM PUBLIC,anon,authenticated,holo_mcp,service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
