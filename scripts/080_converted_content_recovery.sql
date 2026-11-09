-- Internal #396/#383 ordinary-edit recovery after genuine 073 conversion.
-- Apply after installed 079, as one transaction. No conversion, grants or data rewrite.
BEGIN;
SET LOCAL lock_timeout='3s';
DO $integration$
DECLARE body text; old_gate text; new_gate text; anchor text;
BEGIN
 SELECT pg_get_functiondef('collection_audit_private.recovery_plan_v1(uuid,uuid,bigint,text[])'::regprocedure) INTO body;
 IF position('inverse_rows:=array_append(inverse_rows,d);' IN body)=0
   OR position('INTO layout_collections' IN body)=0
   OR position('p.slot_id = slot_key' IN pg_get_functiondef('public.check_slot_placement_v1()'::regprocedure))=0
   OR position('whole_collection_delete boolean' IN pg_get_functiondef('public.inventory_command_v1(uuid,uuid,jsonb,jsonb)'::regprocedure))=0 THEN
   RAISE EXCEPTION 'converted_recovery_requires_installed_079';
 END IF;
 old_gate:=$old$OR coalesce(b->'conversion_receipt',a->'conversion_receipt','null')<>'null' THEN$old$;
 new_gate:=$new$OR ((b IS NULL OR a IS NULL) AND coalesce(b->'conversion_receipt',a->'conversion_receipt','null')<>'null') THEN$new$;
 IF position('converted_frozen_dependencies' IN body)=0 THEN
   IF position(old_gate IN body)=0 OR position(' -- Include current item/placement dependencies' IN body)=0
     OR position(' -- Layout/collection metadata' IN body)=0 THEN
     RAISE EXCEPTION 'converted_recovery_planner_integration_changed';
   END IF;
   body:=replace(body,old_gate,new_gate);
   -- Frozen source timestamps were serialized by 073 in UTC, regardless of the caller.
   body:=replace(body,$old$ SET search_path TO ''$old$,$new$ SET search_path TO ''
 SET "TimeZone" TO 'UTC'$new$);
   body:=replace(body,' deps jsonb;', ' canonical_rows jsonb[]:=''{}''; frozen jsonb; frozen_rows jsonb; source_evidence jsonb; copied_wants bigint; provenance public.storage_collection_state; deps jsonb;');
   -- 076 stores typed timestamps in the recording caller's timezone. Normalize only
   -- those two supported timestamp fields on this local evidence copy, never history
   -- or JSON metadata, so UTC current rows and cross-timezone fingerprints agree.
   body:=replace(body,' -- Unassigned is a deliberate alternative', $timestamps$ -- canonical_recovery_timestamps: preserve every original persisted event.
 FOR d IN SELECT jsonb_array_elements(original.recovery_state) LOOP
   col:=CASE d->>'table' WHEN 'inventory_items' THEN 'acquired_at' WHEN 'storage_collection_state' THEN 'converted_at' END;
   IF col IS NOT NULL THEN
     FOREACH key IN ARRAY ARRAY['before','after'] LOOP
       IF d->key->>col IS NOT NULL THEN
         d:=jsonb_set(d,ARRAY[key,col],to_jsonb((d->key->>col)::timestamptz));
       END IF;
     END LOOP;
   END IF;
   canonical_rows:=array_append(canonical_rows,d);
 END LOOP;
 original.recovery_state:=to_jsonb(canonical_rows);
 -- Unassigned is a deliberate alternative$timestamps$);
   -- Include origin collections even when an edited/removed legacy copy is Unassigned.
   body:=replace(body,' -- Include current item/placement dependencies', $origins$ SELECT coalesce(array_agg(DISTINCT id),'{}') INTO collection_ids FROM (
   SELECT unnest(collection_ids) id UNION
   SELECT m.collection_id FROM public.binder_legacy_rows m WHERE m.owner_user_id=owner_id AND m.legacy_row_id::text=ANY(item_ids)
 ) origins;
 -- Include current item/placement dependencies$origins$);
   anchor:=' -- Layout/collection metadata';
   body:=replace(body,anchor,$proof$ -- converted_frozen_dependencies: provenance is a dependency, never an inverse to rewrite.
 -- A live mapping/source cascade or a real transition still rejects the WHOLE event above.
 frozen:='[]';
 FOR provenance IN SELECT s.* FROM public.storage_collection_state s
   WHERE s.owner_user_id=owner_id AND s.collection_id=ANY(collection_ids) AND s.conversion_receipt IS NOT NULL
   ORDER BY s.collection_id LOOP
   SELECT jsonb_build_object('rows',count(*),'digest',md5(coalesce(string_agg(md5(to_jsonb(m)::text),'' ORDER BY m.legacy_row_id),'')))
   INTO frozen_rows FROM public.binder_legacy_rows m WHERE m.collection_id=provenance.collection_id;
   source_evidence:=public.legacy_binder_evidence_v1(provenance.collection_id);
   SELECT coalesce(sum(jsonb_array_length(public.legacy_binder_wants_v1(c))),0) INTO copied_wants
     FROM public.pokemon_collection c WHERE c.binder_id=provenance.collection_id;
   IF provenance.authority<>'slots' OR provenance.conversion_version IS DISTINCT FROM 1 OR provenance.converted_at IS NULL
     OR provenance.conversion_receipt->'version' IS DISTINCT FROM '1'::jsonb
     OR provenance.conversion_receipt->>'collectionId' IS DISTINCT FROM provenance.collection_id::text
     OR provenance.conversion_receipt->>'ownerUserId' IS DISTINCT FROM owner_id::text
     OR provenance.conversion_receipt IS DISTINCT FROM jsonb_build_object('version',1,'collectionId',provenance.collection_id,'ownerUserId',owner_id,
       'source',source_evidence,'mappedRowsDigest',source_evidence->'rowsDigest','mappedOwnedDigest',source_evidence->'ownedDigest',
       'mappedWantedDigest',source_evidence->'wantedDigest','mappedWantedEntries',source_evidence->'wantedEntries',
       'items',source_evidence->'owned','placements',source_evidence->'owned','slots',1025,'copiedWantedEntries',copied_wants)
     OR frozen_rows->'rows' IS DISTINCT FROM provenance.conversion_receipt->'source'->'rows'
     OR EXISTS(SELECT 1 FROM public.binder_legacy_rows m LEFT JOIN public.pokemon_collection c ON c.id=m.legacy_row_id
       WHERE m.collection_id=provenance.collection_id AND (m.owner_user_id<>owner_id OR c.id IS NULL
         OR c.binder_id<>provenance.collection_id OR c.user_id<>owner_id OR m.source_row IS DISTINCT FROM to_jsonb(c)
         OR m.slot_id IS DISTINCT FROM public.legacy_binder_slot_id_v1(provenance.collection_id,c.pokemon_id))) THEN
     conflicts:=conflicts||jsonb_build_array(jsonb_build_object('entity','storage_collection_state/'||provenance.collection_id::text,'reason','conversion_source_changed'));
   END IF;
   frozen:=frozen||jsonb_build_array(jsonb_build_object('collectionId',provenance.collection_id,'rows',frozen_rows));
 END LOOP;
 FOR d IN SELECT e FROM jsonb_array_elements(inverse) e WHERE e->>'table'='inventory_items' LOOP
   b:=nullif(d->'before','null'); a:=nullif(d->'after','null');
   IF b IS NOT NULL AND a IS NOT NULL AND b->'legacy_source' IS DISTINCT FROM a->'legacy_source' THEN
     unsupported:=unsupported||jsonb_build_array('item_provenance_transition');
   END IF;
   IF coalesce(b->'legacy_source',a->'legacy_source','null')<>'null' AND NOT EXISTS(
     SELECT 1 FROM public.binder_legacy_rows m JOIN public.storage_collection_state s ON s.collection_id=m.collection_id
     WHERE m.owner_user_id=owner_id AND m.legacy_row_id::text=d->>'id' AND s.authority='slots' AND s.conversion_receipt IS NOT NULL
       AND m.source_row=coalesce(nullif(b->'legacy_source','null'),a->'legacy_source')) THEN
     conflicts:=conflicts||jsonb_build_array(jsonb_build_object('entity','inventory_items/'||(d->>'id'),'reason','conversion_source_changed'));
   END IF;
 END LOOP;
 -- Root config/source ABA must conflict even if the current value matches again.
 SELECT conflicts||coalesce(jsonb_agg(DISTINCT jsonb_build_object('entity',(e->>'table')||'/'||(e->>'id'),'reason','later_conversion_dependency_change')),'[]') INTO conflicts
 FROM public.collection_activity h CROSS JOIN LATERAL jsonb_array_elements(h.recovery_state) e
 WHERE h.owner_user_id=owner_id AND h.id>event_id AND h.format_version=1 AND frozen<>'[]' AND (
   (e->>'table'='storage_collection_state' AND EXISTS(SELECT 1 FROM jsonb_array_elements(frozen) f WHERE f->>'collectionId'=e->>'id')
     AND (e->'before')-ARRAY['version','layout_revision'] IS DISTINCT FROM (e->'after')-ARRAY['version','layout_revision'])
   OR (e->>'table' IN ('binder_legacy_rows','pokemon_collection')
     AND coalesce(e->'before'->>'collection_id',e->'after'->>'collection_id',e->'before'->>'binder_id',e->'after'->>'binder_id')=ANY(collection_ids::text[])));
 -- Layout/collection metadata$proof$);
   body:=replace(body,' deps:=public.inventory_evidence_v1(owner_id,item_ids,slot_ids,collection_ids);',
     ' deps:=public.inventory_evidence_v1(owner_id,item_ids,slot_ids,collection_ids); IF frozen<>''[]'' THEN deps:=deps||jsonb_build_object(''convertedSources'',frozen); END IF;');
   EXECUTE body;
 END IF;
 IF position(new_gate IN body)=0 OR position('converted_frozen_dependencies' IN body)=0
   OR position('jsonb_build_object(''convertedSources'',frozen)' IN body)=0
   OR position('canonical_recovery_timestamps' IN body)=0 THEN
   RAISE EXCEPTION 'converted_recovery_planner_integration_changed';
 END IF;
 SELECT pg_get_functiondef('collection_audit_private.recovery_apply_v1(uuid,uuid,jsonb,jsonb)'::regprocedure) INTO body;
 IF position('converted source locks' IN body)=0 THEN
   anchor:=' reviewed:=collection_audit_private.recovery_preview_v1(actor,owner_id,original_id,choices);';
   IF position(anchor IN body)=0 OR position('PERFORM 1 FROM public.partnerships WHERE owner_user_id=owner_id FOR KEY SHARE;' IN body)=0 THEN
     RAISE EXCEPTION 'converted_recovery_executor_integration_changed';
   END IF;
   body:=replace(body,anchor,$locks$ -- converted source locks, after existing dependency locks, before BOTH fresh plan reads.
 FOR lock_row IN SELECT legacy_row_id FROM public.binder_legacy_rows WHERE owner_user_id=owner_id
   AND collection_id IN (SELECT v::uuid FROM jsonb_array_elements_text(plan->'collectionIds') v) ORDER BY legacy_row_id FOR SHARE LOOP END LOOP;
 FOR lock_row IN SELECT id FROM public.pokemon_collection WHERE user_id=owner_id
   AND binder_id IN (SELECT v::uuid FROM jsonb_array_elements_text(plan->'collectionIds') v) ORDER BY id FOR SHARE LOOP END LOOP;
 reviewed:=collection_audit_private.recovery_preview_v1(actor,owner_id,original_id,choices);$locks$);
   EXECUTE body;
 END IF;
END $integration$;
-- CREATE OR REPLACE preserves installed ownership/ACLs. No other private function changes.
NOTIFY pgrst,'reload schema';
COMMIT;
