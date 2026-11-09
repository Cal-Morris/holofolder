-- Internal #396/#383 whole-event recovery. Requires installed, timezone-correct 080.
-- No conversion, runtime grant, history rewrite or hosted application by the worker.
BEGIN;
SET LOCAL lock_timeout='3s';
DO $$ BEGIN
 IF position('canonical_recovery_timestamps' IN pg_get_functiondef('collection_audit_private.recovery_plan_v1(uuid,uuid,bigint,text[])'::regprocedure))=0
   OR position('converted source locks' IN pg_get_functiondef('collection_audit_private.recovery_apply_v1(uuid,uuid,jsonb,jsonb)'::regprocedure))=0
   OR position('p.slot_id = slot_key' IN pg_get_functiondef('public.check_slot_placement_v1()'::regprocedure))=0 THEN
   RAISE EXCEPTION 'converted_cascade_requires_fixed_080';
 END IF;
END $$;

-- Reuse the denied, transaction-owned recorder context. No GUC or runtime-writable row
-- can admit a legacy INSERT. Cleared before flush, rolled back with any failed inverse.
ALTER TABLE collection_audit_private.pending ADD COLUMN IF NOT EXISTS frozen_restore_rows jsonb;
CREATE OR REPLACE FUNCTION collection_audit_private.frozen_restore_v1(row_value public.pokemon_collection) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' SET TimeZone='UTC' AS $$
 SELECT EXISTS(SELECT 1 FROM collection_audit_private.pending p
   JOIN public.collection_activity h ON h.id=p.recovery_of_event_id AND h.owner_user_id=p.owner_id
   WHERE p.transaction_id=txid_current() AND p.owner_id=row_value.user_id
     AND p.context->'actor'->>'kind'='user' AND p.context->>'source' IN ('app','rest','mcp','import')
     AND public.billing_partner_allowed(p.owner_id,(p.context->'actor'->>'userId')::uuid)
     AND p.frozen_restore_rows->row_value.id::text=to_jsonb(row_value))
$$;

-- Presence-only evidence for auxiliary cascades that 076 intentionally does not retain.
-- Never copy tokens, delivery payloads or old search projections into command history.
CREATE OR REPLACE FUNCTION collection_audit_private.deletion_dependencies_v1(collection uuid) RETURNS jsonb
LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT jsonb_build_object('version',1,'collectionId',collection,'unsupported',
   to_jsonb(array_remove(ARRAY[
     CASE WHEN EXISTS(SELECT 1 FROM public.binder_history_state WHERE binder_id=collection)
       OR EXISTS(SELECT 1 FROM public.binder_history_entries WHERE binder_id=collection)
       OR EXISTS(SELECT 1 FROM public.binder_history_clients WHERE binder_id=collection) THEN 'search_history_cascade' END,
     CASE WHEN EXISTS(SELECT 1 FROM public.partner_acquisitions WHERE binder_id=collection) THEN 'push_delivery_cascade' END,
     CASE WHEN EXISTS(SELECT 1 FROM public.binder_public_slugs WHERE binder_id=collection) THEN 'public_slug_cascade' END
   ],NULL)))
$$;

-- Validate the COMPLETE original receipt/source, not the current edited slot contents.
-- Missing mapped rows can be proved by the retained conversion event; row timestamps
-- must come from full 073 JSON, never ordinary 076 projections or clock defaults.
CREATE OR REPLACE FUNCTION collection_audit_private.converted_dependencies_v1(owner_id uuid,event_id bigint,inverse jsonb,collections uuid[])
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' SET TimeZone='UTC' AS $$
DECLARE provenance public.storage_collection_state; original public.collection_activity; conversion public.collection_activity;
 d jsonb; frozen_row jsonb; sources jsonb; source_map jsonb; restore_rows jsonb:='{}'; frozen jsonb:='[]'; rows_proof jsonb;
 source_evidence jsonb; copied_wants bigint; receipt jsonb; deleting boolean; problem boolean; key text;
 expected_slots text[]; restored_mappings jsonb; authoritative_source jsonb; restored_slots jsonb; retained_items jsonb; conflicts jsonb:='[]'; unsupported jsonb:='[]'; recognized text[]:='{}'; item_evidence jsonb; current_item jsonb;
BEGIN
 SELECT * INTO original FROM public.collection_activity WHERE id=event_id AND owner_user_id=owner_id;
 SELECT unsupported||coalesce(jsonb_agg(v),'[]') INTO unsupported
 FROM jsonb_array_elements(coalesce(original.command_evidence->'before','[]')) e
 CROSS JOIN LATERAL jsonb_array_elements(coalesce(e->'deletionDependencies'->'unsupported','[]')) v
 WHERE EXISTS(SELECT 1 FROM jsonb_array_elements(inverse) x WHERE x->>'table'='binders' AND x->'after'='null'
   AND x->>'id'=e->'deletionDependencies'->>'collectionId');

 -- Native plans retain their original material and avoid converted-source work entirely.
 IF NOT EXISTS(SELECT 1 FROM public.storage_collection_state s WHERE s.owner_user_id=owner_id
     AND s.collection_id=ANY(collections) AND s.conversion_receipt IS NOT NULL)
   AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(inverse) e WHERE e->>'table' IN ('pokemon_collection','binder_legacy_rows')
     OR e->>'table'='storage_collection_state' AND e->'before'->'conversion_receipt'<>'null') THEN
   RETURN jsonb_build_object('frozen',frozen,'restoreRows',restore_rows,'conflicts',conflicts,'unsupported',unsupported);
 END IF;
 SELECT coalesce(jsonb_object_agg(e->>'id',e->'before'->'collection_id'),'{}') INTO restored_slots
   FROM jsonb_array_elements(inverse) e WHERE e->>'table'='binder_slots' AND e->'after'='null';
 SELECT coalesce(jsonb_object_agg(e->'before'->>'slot_id',e->'before'->'collection_id'),'{}') INTO restored_mappings
   FROM jsonb_array_elements(inverse) e WHERE e->>'table'='binder_legacy_rows' AND e->'after'='null';
 SELECT coalesce(jsonb_object_agg(i->>'id',i),'{}') INTO retained_items
   FROM jsonb_array_elements(coalesce(original.command_evidence->'before','[]')) e
   CROSS JOIN LATERAL jsonb_array_elements(coalesce(e->'items','[]')) i;

 FOR provenance IN
   SELECT s.* FROM public.storage_collection_state s WHERE s.owner_user_id=owner_id
     AND s.collection_id=ANY(collections) AND s.conversion_receipt IS NOT NULL
   UNION ALL
   SELECT (jsonb_populate_record(NULL::public.storage_collection_state,e->'before')).*
     FROM jsonb_array_elements(inverse) e WHERE e->>'table'='storage_collection_state' AND e->'after'='null'
       AND e->'before'->'conversion_receipt'<>'null'
 LOOP
   receipt:=provenance.conversion_receipt; recognized:=array_append(recognized,provenance.collection_id::text);
   deleting:=EXISTS(SELECT 1 FROM jsonb_array_elements(inverse) e WHERE e->>'table'='storage_collection_state'
     AND e->>'id'=provenance.collection_id::text AND e->'after'='null');
   problem:=false;
   IF deleting THEN
     IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(coalesce(original.command_evidence->'before','[]')) e
       WHERE e->'deletionDependencies'->>'collectionId'=provenance.collection_id::text
         AND e->'deletionDependencies'->'version'='1') THEN
       unsupported:=unsupported||jsonb_build_array('missing_deletion_dependency_evidence');
     END IF;
     -- At most 1,025 source rows. The account-lifetime history is neither truncated nor sampled.
     SELECT h.* INTO conversion FROM public.collection_activity h
       WHERE h.owner_user_id=owner_id AND h.id<=event_id AND h.format_version=1 AND h.action='legacy_conversion'
       AND EXISTS(SELECT 1 FROM jsonb_array_elements(h.recovery_state) e WHERE e->>'table'='storage_collection_state'
         AND e->>'id'=provenance.collection_id::text AND e->'after'->'conversion_receipt'=receipt)
       ORDER BY h.id DESC LIMIT 1;
     WITH candidates AS (
       SELECT e->'before'->'source_row' row_value,1 priority FROM jsonb_array_elements(inverse) e
         WHERE e->>'table'='binder_legacy_rows' AND e->'before'->>'collection_id'=provenance.collection_id::text
       UNION ALL
       SELECT e->'after'->'source_row',2 FROM jsonb_array_elements(coalesce(conversion.recovery_state,'[]')) e
         WHERE e->>'table'='binder_legacy_rows' AND e->'after'->>'collection_id'=provenance.collection_id::text
     ), chosen AS (SELECT DISTINCT ON (row_value->>'id') row_value FROM candidates ORDER BY row_value->>'id',priority)
     SELECT coalesce(jsonb_agg(row_value ORDER BY row_value->>'id'),'[]') INTO sources FROM chosen;
   ELSE
     SELECT coalesce(jsonb_agg(to_jsonb(c) ORDER BY c.id),'[]') INTO sources FROM public.pokemon_collection c WHERE c.binder_id=provenance.collection_id;
   END IF;
   IF jsonb_array_length(sources)>1025 OR octet_length(sources::text)>16777216 THEN
     unsupported:=unsupported||jsonb_build_array('frozen_source_bounds'); CONTINUE;
   END IF;
   SELECT coalesce(jsonb_object_agg(r->>'id',r),'{}'),jsonb_build_object('rows',count(*),
     'owned',count(*) FILTER(WHERE r->>'status' IN ('collected','finalized')),
     'wantedEntries',coalesce(sum(jsonb_array_length(r->'wanted_cards')),0),
     'rowsDigest',md5(coalesce(string_agg(md5(r::text),'' ORDER BY r->>'id'),'')),
     'ownedDigest',md5(coalesce(string_agg(md5(r::text),'' ORDER BY r->>'id') FILTER(WHERE r->>'status' IN ('collected','finalized')),'')),
     'wantedDigest',md5(coalesce(string_agg(md5(r::text),'' ORDER BY r->>'id') FILTER(WHERE r->>'status'='wishlisted' OR r->'wanted_cards'<>'[]'),''))),
     coalesce(sum(jsonb_array_length(public.legacy_binder_wants_v1(jsonb_populate_record(NULL::public.pokemon_collection,r)))),0)
     INTO source_map,source_evidence,copied_wants FROM jsonb_array_elements(sources) r;
   IF provenance.owner_user_id<>owner_id OR provenance.authority<>'slots' OR provenance.conversion_version IS DISTINCT FROM 1 OR provenance.converted_at IS NULL
     OR receipt IS DISTINCT FROM jsonb_build_object('version',1,'collectionId',provenance.collection_id,'ownerUserId',owner_id,
       'source',source_evidence,'mappedRowsDigest',source_evidence->'rowsDigest','mappedOwnedDigest',source_evidence->'ownedDigest',
       'mappedWantedDigest',source_evidence->'wantedDigest','mappedWantedEntries',source_evidence->'wantedEntries',
       'items',source_evidence->'owned','placements',source_evidence->'owned','slots',1025,'copiedWantedEntries',copied_wants)
     OR EXISTS(SELECT 1 FROM jsonb_array_elements(sources) r WHERE r->>'user_id'<>owner_id::text OR r->>'binder_id'<>provenance.collection_id::text
       OR r IS DISTINCT FROM to_jsonb(jsonb_populate_record(NULL::public.pokemon_collection,r))) THEN problem:=true; END IF;
   SELECT coalesce(array_agg(public.legacy_binder_slot_id_v1(provenance.collection_id,(r->>'pokemon_id')::integer)),'{}')
     INTO expected_slots FROM jsonb_array_elements(sources) r;
   -- A source slot that existed before/after the event must have its complete mapping.
   IF EXISTS(SELECT 1 FROM unnest(expected_slots) k WHERE restored_slots->>k=provenance.collection_id::text
       AND restored_mappings->>k IS DISTINCT FROM provenance.collection_id::text)
     OR EXISTS(SELECT 1 FROM public.binder_slots s LEFT JOIN public.binder_legacy_rows m ON m.slot_id=s.id
       WHERE s.collection_id=provenance.collection_id AND s.id=ANY(expected_slots) AND m.legacy_row_id IS NULL) THEN problem:=true; END IF;
   -- Existing and inverse mappings must agree with their full frozen source and stable slot.
   FOR d IN SELECT jsonb_build_object('id',m.legacy_row_id,'before',to_jsonb(m),'after',NULL::jsonb) FROM public.binder_legacy_rows m WHERE m.collection_id=provenance.collection_id
     UNION ALL SELECT e FROM jsonb_array_elements(inverse) e WHERE e->>'table'='binder_legacy_rows'
       AND coalesce(e->'before'->>'collection_id',e->'after'->>'collection_id')=provenance.collection_id::text LOOP
     frozen_row:=d->'before'; key:=frozen_row->>'legacy_row_id';
     IF d->>'id' IS DISTINCT FROM key OR d->'after'<>'null' OR frozen_row='null' OR frozen_row->>'owner_user_id'<>owner_id::text
       OR frozen_row->'source_row' IS DISTINCT FROM source_map->key
       OR frozen_row->>'slot_id' IS DISTINCT FROM public.legacy_binder_slot_id_v1(provenance.collection_id,(source_map->key->>'pokemon_id')::integer)
       OR (restored_slots->>(frozen_row->>'slot_id') IS DISTINCT FROM provenance.collection_id::text
         AND NOT EXISTS(SELECT 1 FROM public.binder_slots s WHERE s.id=frozen_row->>'slot_id' AND s.collection_id=provenance.collection_id)) THEN problem:=true; END IF;
   END LOOP;
   FOR d IN SELECT e FROM jsonb_array_elements(inverse) e WHERE e->>'table'='pokemon_collection'
     AND coalesce(e->'before'->>'binder_id',e->'after'->>'binder_id')=provenance.collection_id::text LOOP
     frozen_row:=source_map->(d->>'id');
     IF NOT deleting OR d->'after'<>'null' OR frozen_row IS NULL
       OR collection_audit_private.state('pokemon_collection',to_jsonb(jsonb_populate_record(NULL::public.pokemon_collection,
         (d->'before')||jsonb_build_object('updated_at',frozen_row->'updated_at')))) IS DISTINCT FROM collection_audit_private.state('pokemon_collection',frozen_row) THEN
       problem:=true;
     END IF;
   END LOOP;
   -- Assemble full source rows once per collection, never copy a growing JSON object per row.
   SELECT restore_rows||coalesce(jsonb_object_agg(e->>'id',source_map->(e->>'id')),'{}') INTO restore_rows
   FROM jsonb_array_elements(inverse) e WHERE e->>'table'='pokemon_collection'
     AND e->'before'->>'binder_id'=provenance.collection_id::text AND source_map ? (e->>'id');
   IF deleting AND (SELECT count(*) FROM jsonb_array_elements(inverse) e WHERE e->>'table'='pokemon_collection'
       AND e->'before'->>'binder_id'=provenance.collection_id::text)<>jsonb_array_length(sources) THEN problem:=true; END IF;
   IF problem THEN conflicts:=conflicts||jsonb_build_array(jsonb_build_object('entity','storage_collection_state/'||provenance.collection_id::text,'reason','conversion_source_changed')); END IF;
   SELECT jsonb_build_object('rows',count(*),'digest',md5(coalesce(string_agg(md5(to_jsonb(m)::text),'' ORDER BY m.legacy_row_id),'')))
     INTO rows_proof FROM public.binder_legacy_rows m WHERE m.collection_id=provenance.collection_id;
   frozen:=frozen||jsonb_build_array(jsonb_build_object('collectionId',provenance.collection_id,'rows',rows_proof));
 END LOOP;
 FOR d IN SELECT e FROM jsonb_array_elements(inverse) e WHERE e->>'table' IN ('pokemon_collection','binder_legacy_rows') LOOP
   IF d->>'table'='binder_legacy_rows' AND (restored_slots->>(d->'before'->>'slot_id') IS DISTINCT FROM d->'before'->>'collection_id'
     OR original.action NOT IN ('slots.remove','slots.bulk','inventory.removeSlots','inventory.deleteCollection')) THEN
     unsupported:=unsupported||jsonb_build_array('missing_cascade_command_evidence');
   END IF;
   IF d->'after'<>'null' OR d->'before'='null' OR NOT coalesce(coalesce(d->'before'->>'collection_id',d->'before'->>'binder_id')=ANY(recognized),false) THEN
     unsupported:=unsupported||jsonb_build_array('unsupported_table:'||(d->>'table'));
   END IF;
 END LOOP;
 -- Cascades retain ownership. Require genuine command evidence for every released copy.
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(inverse) e WHERE e->>'table'='binder_legacy_rows')
   OR EXISTS(SELECT 1 FROM jsonb_array_elements(inverse) e WHERE e->>'table'='storage_collection_state' AND e->'after'='null' AND e->'before'->'conversion_receipt'<>'null') THEN
   FOR d IN SELECT jsonb_build_object('id',e->'id','evidence',retained_items->(e->>'id'),
       'currentItem',collection_audit_private.state('inventory_items',to_jsonb(i)))
     FROM jsonb_array_elements(inverse) e LEFT JOIN public.inventory_items i ON i.id=e->>'id' AND i.owner_user_id=owner_id
     WHERE e->>'table'='inventory_placements' AND e->'after'='null' AND e->'before'<>'null' LOOP
     key:=d->>'id'; item_evidence:=nullif(d->'evidence','null'); current_item:=nullif(d->'currentItem','null');
     authoritative_source:=restore_rows->key;
     IF authoritative_source IS NULL AND coalesce(current_item->'legacy_source','null')<>'null' THEN
       SELECT to_jsonb(c) INTO authoritative_source FROM public.pokemon_collection c WHERE c.id::text=key AND c.user_id=owner_id;
     END IF;
     IF (coalesce(current_item->'legacy_source','null')<>'null' OR authoritative_source->>'status' IN ('collected','finalized'))
       AND current_item->'legacy_source' IS DISTINCT FROM authoritative_source THEN
       conflicts:=conflicts||jsonb_build_array(jsonb_build_object('entity','inventory_items/'||key,'reason','conversion_source_changed'));
     END IF;
     IF item_evidence IS NULL THEN unsupported:=unsupported||jsonb_build_array('missing_retained_copy_evidence');
     ELSE
       IF item_evidence ? 'acquired_at' THEN
         item_evidence:=jsonb_set(item_evidence,'{acquired_at}',coalesce(to_jsonb((item_evidence->>'acquired_at')::timestamptz),'null'));
       END IF;
       IF current_item IS NULL OR current_item->'version' IS DISTINCT FROM item_evidence->'version'
         OR (item_evidence ? 'identity' AND current_item IS DISTINCT FROM collection_audit_private.state('inventory_items',item_evidence)) THEN
         conflicts:=conflicts||jsonb_build_array(jsonb_build_object('entity','inventory_items/'||key,'reason','retained_copy_changed'));
       END IF;
       IF coalesce(current_item->'grading'->'label'->'assetIds','[]')<>'[]' THEN unsupported:=unsupported||jsonb_build_array('private_assets_unverifiable'); END IF;
     END IF;
   END LOOP;
 END IF;
 RETURN jsonb_build_object('frozen',frozen,'restoreRows',restore_rows,'conflicts',conflicts,'unsupported',unsupported);
END $$;

DO $integration$
DECLARE body text; anchor text; start_at integer; end_at integer; signature text;
BEGIN
 -- 076's generic collection_id fallback precedes legacy_row_id. Correct only the
 -- mapping entity key for future capture; never rewrite/conjure older collapsed deltas.
 SELECT pg_get_functiondef('collection_audit_private.capture()'::regprocedure) INTO body;
 IF position('mapping_entity_identity' IN body)=0 THEN
   anchor:=$old$entity:=TG_TABLE_NAME||'/'||coalesce(row_data->>'id',row_data->>'inventory_item_id',row_data->>'collection_id',row_data->>'legacy_row_id',owner_id::text);$old$;
   IF position(anchor IN body)=0 THEN RAISE EXCEPTION 'converted_cascade_capture_integration_changed'; END IF;
   body:=replace(body,anchor,$new$-- mapping_entity_identity: distinct frozen rows are distinct audited entities.
 entity:=TG_TABLE_NAME||'/'||CASE WHEN TG_TABLE_NAME='binder_legacy_rows' THEN row_data->>'legacy_row_id'
   ELSE coalesce(row_data->>'id',row_data->>'inventory_item_id',row_data->>'collection_id',owner_id::text) END;$new$);
   EXECUTE body;
 END IF;
 SELECT pg_get_functiondef('collection_audit_private.recovery_plan_v1(uuid,uuid,bigint,text[])'::regprocedure) INTO body;
 IF position('converted_cascade_dependencies' IN body)=0 THEN
   IF position(' -- converted_frozen_dependencies' IN body)=0 OR position(' FOR d IN SELECT e FROM jsonb_array_elements(inverse) e WHERE e->>''table''=''inventory_items''' IN body)=0 THEN
     RAISE EXCEPTION 'converted_cascade_planner_integration_changed'; END IF;
   body:=replace(body,' provenance public.storage_collection_state;', ' inverse_positions jsonb; inverse_slot_ids text[]; cascade_proof jsonb; provenance public.storage_collection_state;');
   body:=replace(body,$old$'inventory_placements','binders') THEN$old$,$new$'inventory_placements','binders','pokemon_collection','binder_legacy_rows') THEN$new$);
   body:=replace(body,$old$OR ((b IS NULL OR a IS NULL) AND coalesce(b->'conversion_receipt',a->'conversion_receipt','null')<>'null') THEN$old$,'THEN');
   body:=replace(body,$old$WHEN 'storage_collection_state' THEN 'collection_id' ELSE 'id' END;$old$,$new$WHEN 'storage_collection_state' THEN 'collection_id' WHEN 'binder_legacy_rows' THEN 'legacy_row_id' ELSE 'id' END;$new$);
   body:=replace(body,$old$tbl IN ('binders','storage_collection_state') THEN '::uuid'$old$,$new$tbl IN ('binders','storage_collection_state','pokemon_collection','binder_legacy_rows') THEN '::uuid'$new$);
   start_at:=position(' -- converted_frozen_dependencies' IN body);
   end_at:=position(' FOR d IN SELECT e FROM jsonb_array_elements(inverse) e WHERE e->>''table''=''inventory_items''' IN body);
   body:=substr(body,1,start_at-1)||$proof$ -- converted_cascade_dependencies: full receipt and authoritative frozen source, whole event only.
 cascade_proof:=collection_audit_private.converted_dependencies_v1(owner_id,event_id,inverse,collection_ids);
 frozen:=cascade_proof->'frozen'; conflicts:=conflicts||(cascade_proof->'conflicts'); unsupported:=unsupported||(cascade_proof->'unsupported');
$proof$||substr(body,end_at);
   body:=replace(body,$old$SELECT 1 FROM public.binder_legacy_rows m JOIN public.storage_collection_state s ON s.collection_id=m.collection_id
     WHERE m.owner_user_id=owner_id AND m.legacy_row_id::text=d->>'id' AND s.authority='slots' AND s.conversion_receipt IS NOT NULL
       AND m.source_row=coalesce(nullif(b->'legacy_source','null'),a->'legacy_source')$old$,$new$SELECT 1 FROM public.pokemon_collection c JOIN public.storage_collection_state s ON s.collection_id=c.binder_id
     WHERE c.user_id=owner_id AND c.id::text=d->>'id' AND s.authority='slots' AND s.conversion_receipt IS NOT NULL
       AND to_jsonb(c)=coalesce(nullif(b->'legacy_source','null'),a->'legacy_source')$new$);
   body:=replace(body,$old$(e->'before')-ARRAY['version','layout_revision'] IS DISTINCT FROM (e->'after')-ARRAY['version','layout_revision']$old$,
     $new$nullif(e->'before','null')-ARRAY['version','layout_revision'] IS DISTINCT FROM nullif(e->'after','null')-ARRAY['version','layout_revision']$new$);
   body:=replace(body,$old$SELECT m.collection_id FROM public.binder_legacy_rows m WHERE m.owner_user_id=owner_id AND m.legacy_row_id::text=ANY(item_ids)$old$,
     $new$SELECT m.collection_id FROM public.binder_legacy_rows m WHERE m.owner_user_id=owner_id AND m.legacy_row_id::text=ANY(item_ids)
   UNION SELECT c.binder_id FROM public.pokemon_collection c JOIN public.storage_collection_state s ON s.collection_id=c.binder_id
     WHERE c.user_id=owner_id AND c.id::text=ANY(item_ids) AND s.conversion_receipt IS NOT NULL$new$);
   body:=replace(body,$old$IF frozen<>'[]' THEN deps:=deps||jsonb_build_object('convertedSources',frozen); END IF;$old$,
     $new$IF frozen<>'[]' THEN deps:=deps||jsonb_build_object('convertedSources',frozen); END IF;
 IF cascade_proof->'restoreRows'<>'{}' THEN deps:=deps||jsonb_build_object('frozenRestoreRows',cascade_proof->'restoreRows'); END IF;$new$);
   anchor:=' -- Current values/absence';
   IF position(anchor IN body)=0 THEN RAISE EXCEPTION 'converted_cascade_position_integration_changed'; END IF;
   body:=replace(body,anchor,$positions$ -- Check every occupied old position once, without a per-slot full inverse scan.
 SELECT coalesce(array_agg(e->>'id'),'{}') INTO inverse_slot_ids FROM jsonb_array_elements(inverse) e WHERE e->>'table'='binder_slots';
 SELECT coalesce(jsonb_object_agg((e->'before'->>'collection_id')||'/'||(e->'before'->>'position'),e->'id'),'{}') INTO inverse_positions
 FROM jsonb_array_elements(inverse) e WHERE e->>'table'='binder_slots' AND e->'before'<>'null';
 SELECT conflicts||coalesce(jsonb_agg(jsonb_build_object('entity','binder_slots/'||(inverse_positions->>(s.collection_id::text||'/'||s.position::text)),
   'reason','previous_position_occupied')),'[]') INTO conflicts
 FROM public.binder_slots s WHERE s.owner_user_id=owner_id AND s.collection_id=ANY(collection_ids)
   AND inverse_positions ? (s.collection_id::text||'/'||s.position::text)
   AND s.id IS DISTINCT FROM inverse_positions->>(s.collection_id::text||'/'||s.position::text) AND NOT s.id=ANY(inverse_slot_ids);
 -- Current values/absence$positions$);
   anchor:='   IF tbl=''binders'' AND b IS NOT NULL AND b->''is_default''=''true''';
   IF position(anchor IN body)=0 THEN RAISE EXCEPTION 'converted_cascade_name_integration_changed'; END IF;
   body:=replace(body,anchor,$names$   IF tbl='binders' AND b IS NOT NULL AND a IS NULL AND EXISTS(SELECT 1 FROM public.binders t
     WHERE t.owner_user_id=owner_id AND t.id::text<>key AND lower(btrim(t.name))=lower(btrim(b->>'name'))) THEN
     conflicts:=conflicts||jsonb_build_array(jsonb_build_object('entity',tbl||'/'||key,'reason','collection_name_occupied'));
   END IF;
   IF tbl='binders' AND b IS NOT NULL AND b->'is_default'='true'$names$);
   EXECUTE body;
 END IF;

 SELECT pg_get_functiondef('collection_audit_private.recovery_apply_v1(uuid,uuid,jsonb,jsonb)'::regprocedure) INTO body;
 IF position('frozen_restore_rows' IN body)=0 THEN
   anchor:=' saved_before:=public.slot_saved_count_v1(owner_id);';
   IF position(anchor IN body)=0 OR position('   col:=CASE tbl WHEN ''inventory_placements''' IN body)=0 THEN
     RAISE EXCEPTION 'converted_cascade_executor_integration_changed'; END IF;
   body:=replace(body,'DECLARE plan jsonb;', 'DECLARE validation_slot_ids text[]; validation_item_ids text[]; plan jsonb;');
   IF position($old$(p.slot_id IN (SELECT e->>'id' FROM jsonb_array_elements(plan->'inverse') e WHERE e->>'table'='binder_slots')
     OR p.inventory_item_id IN (SELECT e->>'id' FROM jsonb_array_elements(plan->'inverse') e WHERE e->>'table' IN ('inventory_items','inventory_placements')))$old$ IN body)=0 THEN
     RAISE EXCEPTION 'converted_cascade_validation_integration_changed'; END IF;
   body:=replace(body,$old$(p.slot_id IN (SELECT e->>'id' FROM jsonb_array_elements(plan->'inverse') e WHERE e->>'table'='binder_slots')
     OR p.inventory_item_id IN (SELECT e->>'id' FROM jsonb_array_elements(plan->'inverse') e WHERE e->>'table' IN ('inventory_items','inventory_placements')))$old$,
     '(p.slot_id=ANY(validation_slot_ids) OR p.inventory_item_id=ANY(validation_item_ids))');
   body:=replace(body,' -- Revalidate targets',$validation$ -- Retain the exact original validation sets once, without rescanning full frozen JSON per placement.
 SELECT coalesce(array_agg(e->>'id') FILTER(WHERE e->>'table'='binder_slots'),'{}'),
   coalesce(array_agg(e->>'id') FILTER(WHERE e->>'table' IN ('inventory_items','inventory_placements')),'{}')
 INTO validation_slot_ids,validation_item_ids FROM jsonb_array_elements(plan->'inverse') e;
 -- Revalidate targets$validation$);
   body:=replace(body,anchor,$context$ -- A reviewed, currently authorized, locked plan is the only writer of this protected context.
 IF plan->'dependencies'->'frozenRestoreRows' IS NOT NULL THEN
   INSERT INTO collection_audit_private.pending(transaction_id,owner_id,context,recovery_of_event_id,frozen_restore_rows)
   VALUES(txid_current(),owner_id,jsonb_build_object('actor',jsonb_build_object('kind','user','userId',actor),
     'source',trusted_intent->'source','operationId',request->'operationId','action','recovery.apply'),original_id,'{}');
 END IF;
 saved_before:=public.slot_saved_count_v1(owner_id);$context$);
   body:=replace(body,$old$   col:=CASE tbl WHEN 'inventory_placements'$old$,$new$   IF tbl='pokemon_collection' THEN
     b:=plan->'dependencies'->'frozenRestoreRows'->(d->>'id');
     IF b IS NULL OR a IS NOT NULL THEN RAISE EXCEPTION 'recovery_frozen_source_missing' USING ERRCODE='40001'; END IF;
     -- Authorize just this exact INSERT, avoiding repeated detoasting of a whole collection.
     UPDATE collection_audit_private.pending SET frozen_restore_rows=jsonb_build_object(d->>'id',b)
       WHERE transaction_id=txid_current() AND pending.owner_id=recovery_apply_v1.owner_id AND recovery_of_event_id=original_id;
     IF NOT FOUND THEN RAISE EXCEPTION 'recovery_frozen_context_missing'; END IF;
   END IF;
   col:=CASE tbl WHEN 'inventory_placements'$new$);
   body:=replace(body,$old$WHEN 'storage_collection_state' THEN 'collection_id' ELSE 'id' END;$old$,$new$WHEN 'storage_collection_state' THEN 'collection_id' WHEN 'binder_legacy_rows' THEN 'legacy_row_id' ELSE 'id' END;$new$);
   body:=replace(body,'SET context=ctx,recovery_of_event_id=original_id','SET context=ctx,recovery_of_event_id=original_id,frozen_restore_rows=NULL');
   EXECUTE body;
 END IF;

 -- Preserve all ordinary legacy behavior. Only an exact authorized frozen INSERT is exceptional.
 FOREACH signature IN ARRAY ARRAY['public.guard_legacy_binder_write_v1()','public.set_pokemon_collection_updated_at()','public.record_collection_activity()','public.enforce_collection_billing()'] LOOP
   SELECT pg_get_functiondef(signature::regprocedure) INTO body;
   IF position('collection_audit_private.frozen_restore_v1' IN body)=0 THEN
     IF position('BEGIN' IN body)=0 THEN RAISE EXCEPTION 'converted_cascade_trigger_integration_changed'; END IF;
     body:=replace(body,'BEGIN',E'BEGIN\n IF TG_OP=''INSERT'' AND collection_audit_private.frozen_restore_v1(NEW) THEN RETURN NEW; END IF;');
     IF signature='public.set_pokemon_collection_updated_at()' THEN
       body:=replace(body,' LANGUAGE plpgsql',E' LANGUAGE plpgsql SECURITY DEFINER');
     END IF;
     EXECUTE body;
   END IF;
 END LOOP;
 ALTER FUNCTION public.set_pokemon_collection_updated_at() SECURITY DEFINER;

 SELECT pg_get_functiondef('public.inventory_command_v1(uuid,uuid,jsonb,jsonb)'::regprocedure) INTO body;
 IF position('deletion_dependencies_v1' IN body)=0 THEN
   anchor:='   before_value:=public.inventory_evidence_v1(owner_id,items,slots,collections);';
   IF position(anchor IN body)=0 OR position('whole_collection_delete boolean' IN body)=0 OR position('collection_audit_private.command_result' IN body)=0 THEN
     RAISE EXCEPTION 'converted_cascade_command_integration_changed'; END IF;
   body:=replace(body,anchor,anchor||$evidence$
   IF kind='deleteCollection' THEN before_value:=before_value||jsonb_build_object('deletionDependencies',
     collection_audit_private.deletion_dependencies_v1((command->>'collectionId')::uuid)); END IF;$evidence$);
   EXECUTE body;
 END IF;
 SELECT pg_get_functiondef('public.slot_command_v1(uuid,uuid,jsonb,jsonb)'::regprocedure) INTO body;
 IF position('retained_copy_versions' IN body)=0 THEN
   IF position(' saved_before bigint;' IN body)=0 OR position('         -- Placement FK cascade' IN body)=0
     OR position($old$   'acquisition',false$old$ IN body)=0 OR position('collection_audit_private.command_result' IN body)=0 THEN
     RAISE EXCEPTION 'converted_cascade_slot_integration_changed'; END IF;
   body:=replace(body,' saved_before bigint;', ' retained_copy_versions jsonb:=''[]''; saved_before bigint;');
   body:=replace(body,'         -- Placement FK cascade',$evidence$         IF ref->'inventoryItemId'<>'null' THEN
           retained_copy_versions:=retained_copy_versions||jsonb_build_array(jsonb_build_object('id',ref->'inventoryItemId','version',ref->'itemVersion'));
         END IF;
         -- Placement FK cascade$evidence$);
   body:=replace(body,$old$   'acquisition',false$old$,$new$   'evidence',jsonb_build_array(jsonb_build_object('before',jsonb_build_object('items',retained_copy_versions))),
   'acquisition',false$new$);
   EXECUTE body;
 END IF;
END $integration$;
REVOKE ALL ON FUNCTION collection_audit_private.frozen_restore_v1(public.pokemon_collection),
 collection_audit_private.deletion_dependencies_v1(uuid),collection_audit_private.converted_dependencies_v1(uuid,bigint,jsonb,uuid[])
 FROM PUBLIC,anon,authenticated,holo_mcp,service_role;
-- Existing ownership, function ACLs, trigger definitions, 076 recorder/guard and 079 lookup stay installed.
NOTIFY pgrst,'reload schema';
COMMIT;
