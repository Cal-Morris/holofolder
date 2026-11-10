-- Additive copied set evidence on the existing manifest. Requires 073-099 (100 independent).
-- No new dispatcher, grants, conversion, provider calls or ongoing membership constraint.
BEGIN;
SET LOCAL lock_timeout='3s';
CREATE OR REPLACE FUNCTION collection_audit_private.validate_set_creation_v1(manifest jsonb)
RETURNS void LANGUAGE plpgsql SET search_path='' AS $$
DECLARE scope jsonb:=manifest->'setScope'; evidence jsonb; card public.tcg_cards; set_row public.tcg_sets;
 expected jsonb:='[]'; warnings jsonb; ids jsonb; eligible integer; verified integer; missing integer; finishes jsonb; target jsonb; finish text; flag text; n integer:=0; resolved_ids text[]:='{}';
BEGIN
 IF NOT public.inventory_object_v1(scope,ARRAY['setId','setName','language','finishes','capturedAt','officialCardCount','cards','promoCardIds','excludedCardIds','warnings'])
   OR (SELECT count(*) FROM jsonb_object_keys(scope))<>10
   OR NOT public.inventory_id_v1(scope->'setId') OR NOT public.inventory_id_v1(scope->'setName')
   OR NOT coalesce(scope->>'language' IN ('en','fr','es','it','pt-br','de','ja','ko'),false)
   OR NOT public.inventory_id_v1(scope->'capturedAt')
   OR (scope->>'capturedAt') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,3})?(Z|[+-][0-9]{2}:[0-9]{2})$'
   OR NOT (scope->'officialCardCount'='null' OR public.inventory_revision_v1(scope->'officialCardCount'))
   OR jsonb_typeof(scope->'cards') IS DISTINCT FROM 'array' OR jsonb_array_length(scope->'cards')>4096
   OR jsonb_typeof(scope->'finishes') IS DISTINCT FROM 'array' OR jsonb_array_length(scope->'finishes')>4
   OR jsonb_typeof(scope->'promoCardIds') IS DISTINCT FROM 'array'
   OR jsonb_typeof(scope->'excludedCardIds') IS DISTINCT FROM 'array'
   OR jsonb_typeof(scope->'warnings') IS DISTINCT FROM 'array' OR jsonb_array_length(scope->'warnings')>10 THEN
   RAISE EXCEPTION 'invalid_set_checklist_scope' USING ERRCODE='22023'; END IF;
 BEGIN IF NOT isfinite((scope->>'capturedAt')::timestamptz) THEN RAISE EXCEPTION 'invalid_set_checklist_capture' USING ERRCODE='22023'; END IF;
 EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN RAISE EXCEPTION 'invalid_set_checklist_capture' USING ERRCODE='22023'; END;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(scope->'finishes') f WHERE NOT coalesce(f #>> '{}' IN ('normal','holo','reverse_holo','jumbo'),false) OR jsonb_typeof(f)<>'string')
   OR (SELECT count(DISTINCT f) FROM jsonb_array_elements(scope->'finishes') f)<>jsonb_array_length(scope->'finishes')
   OR EXISTS(SELECT 1 FROM jsonb_array_elements(scope->'warnings') w WHERE jsonb_typeof(w)<>'string' OR length(w #>> '{}')>1000)
   OR EXISTS(SELECT 1 FROM jsonb_array_elements((scope->'promoCardIds')||(scope->'excludedCardIds')) id WHERE NOT public.inventory_id_v1(id))
   OR (SELECT count(DISTINCT id) FROM jsonb_array_elements(scope->'promoCardIds') id)<>jsonb_array_length(scope->'promoCardIds')
   OR (SELECT count(DISTINCT id) FROM jsonb_array_elements(scope->'excludedCardIds') id)<>jsonb_array_length(scope->'excludedCardIds')
   OR (SELECT count(DISTINCT c->>'cardId') FROM jsonb_array_elements(scope->'cards') c)<>jsonb_array_length(scope->'cards')
   OR EXISTS(SELECT 1 FROM jsonb_array_elements((scope->'promoCardIds')||(scope->'excludedCardIds')) id
     WHERE NOT EXISTS(SELECT 1 FROM jsonb_array_elements(scope->'cards') c WHERE c->'cardId'=id)) THEN
   RAISE EXCEPTION 'invalid_set_checklist_scope' USING ERRCODE='22023'; END IF;
 -- Promos follow the base list; exclusions use canonical ID order, just like the copied generator.
 SELECT coalesce(jsonb_agg(c->'cardId' ORDER BY a.n),'[]') INTO ids
 FROM jsonb_array_elements(scope->'cards') WITH ORDINALITY a(c,n) WHERE scope->'promoCardIds' @> jsonb_build_array(c->'cardId');
 IF ids IS DISTINCT FROM scope->'promoCardIds'
   OR (SELECT coalesce(max(a.n) FILTER (WHERE NOT scope->'promoCardIds' @> jsonb_build_array(c->'cardId')),0)
     >coalesce(min(a.n) FILTER (WHERE scope->'promoCardIds' @> jsonb_build_array(c->'cardId')),4097)
     FROM jsonb_array_elements(scope->'cards') WITH ORDINALITY a(c,n)) THEN
   RAISE EXCEPTION 'invalid_set_checklist_order' USING ERRCODE='22023'; END IF;
 SELECT coalesce(jsonb_agg(id ORDER BY (id #>> '{}') COLLATE "C"),'[]') INTO ids FROM jsonb_array_elements(scope->'excludedCardIds') id;
 IF ids IS DISTINCT FROM scope->'excludedCardIds' THEN RAISE EXCEPTION 'invalid_set_checklist_exclusions' USING ERRCODE='22023'; END IF;
 warnings:=jsonb_build_array('Catalog coverage only. Secrets and subsets present in this list are included; missing cards, languages and variant families may exist. This is not a complete master-set claim.');
 IF scope->'officialCardCount'<>'null' THEN
   SELECT count(*) INTO eligible FROM jsonb_array_elements(scope->'cards') c WHERE NOT scope->'promoCardIds' @> jsonb_build_array(c->'cardId');
   warnings:=warnings||jsonb_build_array(format('%s catalog rows; printed base count %s is not a master-set denominator.',eligible,scope->>'officialCardCount'));
 END IF;
 SELECT count(*) INTO missing FROM jsonb_array_elements(scope->'cards') c WHERE c->'languageConfirmed'='false';
 IF missing>0 THEN warnings:=warnings||jsonb_build_array(format('%s cards unavailable: chosen language is not confirmed in this catalog snapshot.',missing)); END IF;
 IF jsonb_array_length(scope->'finishes')>0 THEN
   warnings:=warnings||jsonb_build_array('Only explicitly true variant flags are eligible. False, absent and unknown flags are unavailable; rarity, price and grade supply no evidence.');
 END IF;
 FOR finish IN SELECT jsonb_array_elements_text(scope->'finishes') LOOP
   SELECT count(*),count(*) FILTER(WHERE c->'verifiedFinishes' @> to_jsonb(finish)) INTO eligible,verified
   FROM jsonb_array_elements(scope->'cards') c WHERE c->'languageConfirmed'='true' AND NOT scope->'excludedCardIds' @> jsonb_build_array(c->'cardId');
   warnings:=warnings||jsonb_build_array(format('%s: %s verified targets of %s included language-confirmed cards; %s unavailable. Flags describe catalog evidence, not guaranteed regional distribution.',finish,verified,eligible,eligible-verified));
 END LOOP;
 IF scope->'warnings' IS DISTINCT FROM warnings THEN RAISE EXCEPTION 'invalid_set_checklist_warnings' USING ERRCODE='22023'; END IF;
 SELECT * INTO set_row FROM public.tcg_sets WHERE id=scope->>'setId' FOR SHARE;
 IF set_row.id IS NULL OR set_row.name_en IS DISTINCT FROM scope->>'setName'
   OR to_jsonb(set_row.official_card_count) IS DISTINCT FROM nullif(scope->'officialCardCount','null')
   OR manifest->'source' IS DISTINCT FROM jsonb_build_object('id','set:'||(scope->>'setId'),'version',scope->>'capturedAt')
   OR manifest->'name' IS DISTINCT FROM scope->'setName' THEN
   RAISE EXCEPTION 'collection_catalog_unavailable' USING ERRCODE='22023'; END IF;
 FOR evidence IN SELECT jsonb_array_elements(scope->'cards') LOOP
   n:=n+1;
   IF NOT public.inventory_object_v1(evidence,ARRAY['cardId','setId','localId','name','languageConfirmed','verifiedFinishes'])
     OR (SELECT count(*) FROM jsonb_object_keys(evidence))<>6
     OR NOT public.inventory_id_v1(evidence->'cardId') OR NOT public.inventory_id_v1(evidence->'setId')
     OR NOT public.inventory_id_v1(evidence->'localId') OR NOT public.inventory_id_v1(evidence->'name')
     OR jsonb_typeof(evidence->'languageConfirmed') IS DISTINCT FROM 'boolean'
     OR jsonb_typeof(evidence->'verifiedFinishes') IS DISTINCT FROM 'array' THEN
     RAISE EXCEPTION 'invalid_set_checklist_card' USING ERRCODE='22023'; END IF;
   card:=public.slot_catalog_card_v1(evidence->>'cardId');
   IF card.id=ANY(resolved_ids) THEN RAISE EXCEPTION 'duplicate_set_catalog_identity' USING ERRCODE='22023'; END IF;
   resolved_ids:=array_append(resolved_ids,card.id);
   -- Capture every row's evidence, including exclusions and unavailable-language rows.
   -- No names/images/rarity/price/grade can manufacture a language or a finish.
   IF card.id IS NULL OR card.set_id IS DISTINCT FROM evidence->>'setId' OR card.local_id IS DISTINCT FROM evidence->>'localId'
     OR NOT (scope->'promoCardIds' @> jsonb_build_array(evidence->'cardId')) AND card.set_id IS DISTINCT FROM scope->>'setId'
     OR evidence->'languageConfirmed' IS DISTINCT FROM to_jsonb(length(btrim(coalesce(card.name_json->>(scope->>'language'),'')))>0)
     OR evidence->'languageConfirmed'='true' AND card.name_json->(scope->>'language') IS DISTINCT FROM evidence->'name'
     OR NOT EXISTS(SELECT 1 FROM jsonb_each_text(card.name_json) name WHERE name.value=evidence->>'name') THEN
     RAISE EXCEPTION 'collection_catalog_unavailable' USING ERRCODE='22023'; END IF;
   SELECT coalesce(jsonb_agg(to_jsonb(v.finish) ORDER BY v.n),'[]') INTO finishes
     FROM (VALUES ('normal','normal',1),('holo','holo',2),('reverse_holo','reverse',3),('jumbo','jumbo',4)) v(finish,flag,n)
     WHERE card.variants_json->v.flag='true';
   IF finishes IS DISTINCT FROM evidence->'verifiedFinishes' THEN RAISE EXCEPTION 'collection_finish_unavailable' USING ERRCODE='22023'; END IF;
   IF evidence->'languageConfirmed'='false' OR scope->'excludedCardIds' @> jsonb_build_array(evidence->'cardId') THEN CONTINUE; END IF;
   target:=jsonb_build_object('kind','card','cardId',evidence->>'cardId','language',scope->>'language');
   IF jsonb_array_length(scope->'finishes')=0 THEN
     expected:=expected||jsonb_build_array(jsonb_build_object('id','target-'||n,'target',target));
   ELSE
     FOR finish IN SELECT jsonb_array_elements_text(scope->'finishes') LOOP
       flag:=CASE finish WHEN 'reverse_holo' THEN 'reverse' ELSE finish END;
       IF card.variants_json->flag='true' THEN expected:=expected||jsonb_build_array(jsonb_build_object('id','target-'||n||'-'||finish,'target',target||jsonb_build_object('finish',finish))); END IF;
     END LOOP;
   END IF;
 END LOOP;
 IF manifest->'entries' IS DISTINCT FROM expected THEN RAISE EXCEPTION 'set_scope_manifest_mismatch' USING ERRCODE='22023'; END IF;
END $$;
REVOKE ALL ON FUNCTION collection_audit_private.validate_set_creation_v1(jsonb) FROM PUBLIC,anon,authenticated,holo_mcp,service_role;

DO $creation$
DECLARE body text; anchor text;
BEGIN
 SELECT pg_get_functiondef('collection_audit_private.create_collection_v1(uuid,uuid,jsonb,jsonb)'::regprocedure) INTO body;
 IF position('-- copied_set_scope_101' IN body)=0 THEN
   anchor:='IF NOT public.inventory_object_v1(manifest,ARRAY[''source'',''name'',''entries''])';
   IF position(anchor IN body)=0 OR position('-- empty_owner_first_creation_098' IN body)=0
     OR position('FOR entry IN SELECT jsonb_array_elements(manifest->''entries'') LOOP' IN body)=0 THEN
     RAISE EXCEPTION 'set_creation_requires_098_signature'; END IF;
   body:=replace(body,anchor,'IF NOT public.inventory_object_v1(manifest-''setScope'',ARRAY[''source'',''name'',''entries''])');
   -- After accepted replay and revision predicates, before any writes. Old manifests unchanged.
   anchor:='FOR entry IN SELECT jsonb_array_elements(manifest->''entries'') LOOP';
   body:=replace(body,anchor,$new$-- copied_set_scope_101
 IF manifest ? 'setScope' THEN PERFORM collection_audit_private.validate_set_creation_v1(manifest); END IF;
 FOR entry IN SELECT jsonb_array_elements(manifest->'entries') LOOP$new$);
   EXECUTE body;
 END IF;
END $creation$;
NOTIFY pgrst,'reload schema';
COMMIT;
