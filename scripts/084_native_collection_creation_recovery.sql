-- Internal #396 inverse for genuine 083 creation, never a force-cleanup operation.
-- Default creation requires a separate explicit replacement contract. Keep owner authority.
BEGIN;
SET LOCAL lock_timeout='3s';

CREATE OR REPLACE FUNCTION collection_audit_private.creation_recovery_proof_v1(owner_id uuid,event_id bigint)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' SET TimeZone='UTC' AS $$
DECLARE original public.collection_activity; binder_delta jsonb; state_delta jsonb; root_delta jsonb;
 collection uuid; state_value jsonb; slot_keys text[]; defaults jsonb; conflicts jsonb:='[]'; references_proof jsonb:='[]';
 fk record; join_columns text; occupied boolean;
BEGIN
 SELECT * INTO original FROM public.collection_activity WHERE id=event_id AND owner_user_id=owner_id;
 IF original.action IS DISTINCT FROM 'collection.create' OR original.format_version<>1
   OR jsonb_typeof(original.recovery_state) IS DISTINCT FROM 'array' THEN RETURN jsonb_build_object('eligible',false); END IF;
 SELECT e INTO binder_delta FROM jsonb_array_elements(original.recovery_state) e WHERE e->>'table'='binders';
 SELECT e INTO state_delta FROM jsonb_array_elements(original.recovery_state) e WHERE e->>'table'='storage_collection_state';
 SELECT e INTO root_delta FROM jsonb_array_elements(original.recovery_state) e WHERE e->>'table'='inventory_owner_state';
 state_value:=state_delta->'after';
 -- Require the whole, bounded 083 event, including copied manifest and every initial slot.
 IF binder_delta IS NULL OR state_delta IS NULL OR root_delta IS NULL
   OR binder_delta->'before' IS DISTINCT FROM 'null'::jsonb OR state_delta->'before' IS DISTINCT FROM 'null'::jsonb
   OR binder_delta->'after'->>'id' IS DISTINCT FROM binder_delta->>'id'
   OR state_delta->>'id' IS DISTINCT FROM binder_delta->>'id'
   OR state_value->>'collection_id' IS DISTINCT FROM binder_delta->>'id'
   OR binder_delta->'after'->>'owner_user_id' IS DISTINCT FROM owner_id::text
   OR state_value->>'owner_user_id' IS DISTINCT FROM owner_id::text
   OR state_value->>'authority' IS DISTINCT FROM 'slots' OR state_value->'version' IS DISTINCT FROM '0'::jsonb
   OR state_value->'layout_revision' IS DISTINCT FROM '0'::jsonb
   OR state_value->'conversion_receipt' IS DISTINCT FROM 'null'::jsonb
   OR state_value->'conversion_version' IS DISTINCT FROM 'null'::jsonb
   OR state_value->'converted_at' IS DISTINCT FROM 'null'::jsonb
   OR root_delta->>'id' IS DISTINCT FROM owner_id::text
   OR root_delta->'after'->>'owner_user_id' IS DISTINCT FROM owner_id::text
   OR (root_delta->'before'<>'null' AND root_delta->'before'->>'owner_user_id' IS DISTINCT FROM owner_id::text)
   OR (root_delta->'after'->>'inventory_revision')::numeric IS DISTINCT FROM coalesce((root_delta->'before'->>'inventory_revision')::numeric,0)+1
   OR jsonb_typeof(state_value->'preset_manifest'->'entries') IS DISTINCT FROM 'array'
   OR jsonb_array_length(state_value->'preset_manifest'->'entries')>4096
   OR EXISTS(SELECT 1 FROM jsonb_array_elements(original.recovery_state) e
     WHERE e->>'table' NOT IN ('binders','storage_collection_state','inventory_owner_state','binder_slots'))
   OR (SELECT count(*) FROM jsonb_array_elements(original.recovery_state) e WHERE e->>'table'<>'binder_slots')<>3
   OR (SELECT count(*) FROM jsonb_array_elements(original.recovery_state) e WHERE e->>'table'='binder_slots')
     <>jsonb_array_length(state_value->'preset_manifest'->'entries') THEN
   RETURN jsonb_build_object('eligible',false);
 END IF;
 collection:=(binder_delta->>'id')::uuid;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(original.recovery_state) e WHERE e->>'table'='binder_slots' AND (
     e->'before' IS DISTINCT FROM 'null'::jsonb OR e->'after'->>'id' IS DISTINCT FROM e->>'id'
     OR e->'after'->>'owner_user_id' IS DISTINCT FROM owner_id::text
     OR e->'after'->>'collection_id' IS DISTINCT FROM collection::text
     OR e->'after'->'version' IS DISTINCT FROM '0'::jsonb OR e->'after'->'status' IS DISTINCT FROM 'null'::jsonb
     OR e->'after'->'wanted_cards' IS DISTINCT FROM '[]'::jsonb
     OR (e->'after'->>'position')::integer NOT BETWEEN 0 AND jsonb_array_length(state_value->'preset_manifest'->'entries')-1
     OR e->'after'->'target' IS DISTINCT FROM state_value->'preset_manifest'->'entries'->((e->'after'->>'position')::integer)->'target'
     OR e->'after'->'preset_origin' IS DISTINCT FROM jsonb_build_object('source',state_value->'preset_manifest'->'source',
       'entryId',state_value->'preset_manifest'->'entries'->((e->'after'->>'position')::integer)->'id')))
   OR (SELECT count(DISTINCT e->'after'->'position') FROM jsonb_array_elements(original.recovery_state) e WHERE e->>'table'='binder_slots')
     <>jsonb_array_length(state_value->'preset_manifest'->'entries') THEN
   RETURN jsonb_build_object('eligible',false);
 END IF;
 SELECT coalesce(array_agg(e->>'id'),'{}') INTO slot_keys FROM jsonb_array_elements(original.recovery_state) e WHERE e->>'table'='binder_slots';
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
 -- may be removed. Never silently cascade shares, wants, legacy rows, deliveries or config.
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
   AND (h.format_version<>1 OR jsonb_typeof(h.recovery_state) IS DISTINCT FROM 'array' OR h.recovery_state='[]')) THEN
   conflicts:=conflicts||jsonb_build_array(jsonb_build_object('entity','binders/'||collection,'reason','creation_history_incomplete'));
 END IF;
 IF EXISTS(SELECT 1 FROM public.collection_activity h CROSS JOIN LATERAL jsonb_array_elements(h.recovery_state) e
   WHERE h.owner_user_id=owner_id AND h.id>event_id AND h.format_version=1 AND (
     e->>'id'=collection::text OR e->>'id'=ANY(slot_keys)
     OR coalesce(e->'before'->>'collection_id',e->'before'->>'binder_id')=collection::text
     OR coalesce(e->'after'->>'collection_id',e->'after'->>'binder_id')=collection::text
     OR e->'before'->>'slot_id'=ANY(slot_keys) OR e->'after'->>'slot_id'=ANY(slot_keys))) THEN
   conflicts:=conflicts||jsonb_build_array(jsonb_build_object('entity','binders/'||collection,'reason','creation_later_dependency_change'));
 END IF;
 RETURN jsonb_build_object('eligible',true,'conflicts',conflicts,'dependencies',jsonb_build_object('defaults',defaults,'references',references_proof));
END $$;
REVOKE ALL ON FUNCTION collection_audit_private.creation_recovery_proof_v1(uuid,bigint) FROM PUBLIC,anon,authenticated,holo_mcp,service_role;

DO $integration$
DECLARE body text; anchor text;
BEGIN
 IF position('collection_audit_private.create_collection_v1' IN pg_get_functiondef('public.storage_execute_v1(text,uuid,jsonb)'::regprocedure))=0 THEN
   RAISE EXCEPTION 'creation_recovery_requires_083'; END IF;
 SELECT pg_get_functiondef('collection_audit_private.recovery_plan_v1(uuid,uuid,bigint,text[])'::regprocedure) INTO body;
 IF position('native_creation_proof' IN body)=0 THEN
   IF position('converted_cascade_dependencies' IN body)=0 OR position('canonical_recovery_timestamps' IN body)=0 THEN
     RAISE EXCEPTION 'creation_recovery_requires_081'; END IF;
   body:=replace(body,'DECLARE original public.collection_activity;', 'DECLARE native_creation_proof jsonb; original public.collection_activity;');
   anchor:=' -- Unassigned is a deliberate alternative';
   IF position(anchor IN body)=0 THEN RAISE EXCEPTION 'creation_recovery_planner_changed'; END IF;
   body:=replace(body,anchor,$proof$ -- native_creation_proof admits only complete genuine creation events.
 native_creation_proof:=jsonb_build_object('eligible',false);
 IF original.action='collection.create' THEN
   native_creation_proof:=collection_audit_private.creation_recovery_proof_v1(owner_id,event_id);
 END IF;
 IF original.action='collection.create' AND NOT (native_creation_proof->>'eligible')::boolean THEN
   unsupported:=unsupported||jsonb_build_array('missing_native_creation_evidence');
 END IF;
 IF (native_creation_proof->>'eligible')::boolean THEN conflicts:=conflicts||(native_creation_proof->'conflicts'); END IF;
 -- Unassigned is a deliberate alternative$proof$);
   body:=replace(body,$old$IF tbl IN ('binders','storage_collection_state') AND b IS NULL THEN$old$,
     $new$IF tbl IN ('binders','storage_collection_state') AND b IS NULL AND NOT (native_creation_proof->>'eligible')::boolean THEN$new$);
   body:=replace(body,$old$IF a IS NULL OR b IS NULL THEN unsupported:=unsupported||jsonb_build_array('owner_authority_transition'); END IF;$old$,
     $new$IF (a IS NULL OR b IS NULL) AND NOT (native_creation_proof->>'eligible')::boolean THEN unsupported:=unsupported||jsonb_build_array('owner_authority_transition'); END IF;$new$);
   anchor:=' SELECT collection_audit_private.state(''inventory_owner_state'',to_jsonb(s)) INTO root';
   IF position(anchor IN body)=0 THEN RAISE EXCEPTION 'creation_recovery_dependencies_changed'; END IF;
   body:=replace(body,anchor,$deps$ IF (native_creation_proof->>'eligible')::boolean THEN deps:=deps||jsonb_build_object('nativeCreation',native_creation_proof->'dependencies'); END IF;
 SELECT collection_audit_private.state('inventory_owner_state',to_jsonb(s)) INTO root$deps$);
   EXECUTE body;
 END IF;
 SELECT pg_get_functiondef('collection_audit_private.recovery_apply_v1(uuid,uuid,jsonb,jsonb)'::regprocedure) INTO body;
 IF position('native creation management lock' IN body)=0 THEN
   anchor:=' PERFORM pg_advisory_xact_lock(hashtextextended(owner_id::text,4701));';
   IF position(anchor IN body)=0 OR position('converted source locks' IN body)=0 THEN RAISE EXCEPTION 'creation_recovery_executor_changed'; END IF;
   -- FOR SHARE blocks non-key membership changes too, before either owner lock.
   body:=replace(body,'WHERE owner_user_id=owner_id FOR KEY SHARE;', 'WHERE owner_user_id=owner_id FOR SHARE;');
   body:=replace(body,anchor,$locks$ -- native creation management lock matches legacy/083 ordering, after membership.
 IF EXISTS(SELECT 1 FROM public.collection_activity WHERE id=(request->>'eventId')::bigint AND owner_user_id=owner_id AND action='collection.create') THEN
   PERFORM pg_advisory_xact_lock(hashtextextended(owner_id::text,6102));
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(owner_id::text,4701));$locks$);
   body:=replace(body,$old$AND id IN (SELECT v::uuid FROM jsonb_array_elements_text(plan->'collectionIds') v) ORDER BY id FOR UPDATE$old$,
     $new$AND (plan->'dependencies' ? 'nativeCreation' OR id IN (SELECT v::uuid FROM jsonb_array_elements_text(plan->'collectionIds') v)) ORDER BY id FOR UPDATE$new$);
   anchor:=$old$   IF tbl IN ('storage_collection_state','binders') THEN RAISE EXCEPTION 'recovery_unsupported_creation' USING ERRCODE='0A000'; END IF;$old$;
   IF position(anchor IN body)=0 THEN RAISE EXCEPTION 'creation_recovery_delete_changed'; END IF;
   body:=replace(body,anchor,$delete$   IF tbl IN ('storage_collection_state','binders') THEN
     IF NOT plan->'dependencies' ? 'nativeCreation' THEN RAISE EXCEPTION 'recovery_unsupported_creation' USING ERRCODE='0A000'; END IF;
     -- The unchanged authority guard permits state removal only through binder cascade.
     IF tbl='binders' THEN
       DELETE FROM public.binders WHERE id=(d->>'id')::uuid AND owner_user_id=owner_id;
     END IF;
     CONTINUE;
   END IF;$delete$);
   EXECUTE body;
 END IF;
END $integration$;
-- Recorder 076, immutable originals, 079 behavior and all three fresh plan reads remain.
NOTIFY pgrst,'reload schema';
COMMIT;
