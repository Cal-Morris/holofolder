-- Additive original-intent semantics on reviewed 088. Apply after pending 089 in
-- integration; standalone 088+090 proof does not establish combined 089 behavior.
-- No grants, admission changes, new ledger or private read API.
BEGIN;
SET LOCAL lock_timeout='3s';
DO $integration$
DECLARE body text; anchor text;
BEGIN
 SELECT pg_get_functiondef('public.inventory_command_v1(uuid,uuid,jsonb,jsonb)'::regprocedure) INTO body;
 IF to_regprocedure('collection_audit_private.import_arrangement_v1(uuid,uuid,jsonb,jsonb)') IS NULL
   OR position('collection_audit_private.command_result' IN body)=0
   OR position('RETURN prior.result;' IN body)=0 THEN RAISE EXCEPTION 'private_patch_requires_reviewed_088'; END IF;
 IF position('-- private_preserving_intent_090' IN body)=0 THEN
   anchor:=$old$ELSIF kind IN ('edit','removeOwned','unassign','move') THEN$old$;
   IF position(anchor IN body)=0 THEN RAISE EXCEPTION 'private_patch_command_anchor_changed'; END IF;
   body:=replace(body,anchor,$new$ELSIF kind IN ('edit','patchGrading','removeOwned','unassign','move') THEN$new$);
   anchor:=$old$CASE kind WHEN 'edit' THEN ARRAY['kind','item','grading']$old$;
   IF position(anchor IN body)=0 THEN RAISE EXCEPTION 'private_patch_shape_anchor_changed'; END IF;
   body:=replace(body,anchor,$new$CASE kind WHEN 'patchGrading' THEN ARRAY['kind','item','patch'] WHEN 'edit' THEN ARRAY['kind','item','grading']$new$);
   anchor:=$old$     IF kind='edit' THEN$old$;
   IF position(anchor IN body)=0 THEN RAISE EXCEPTION 'private_patch_lock_anchor_changed'; END IF;
   body:=replace(body,anchor,$new$     -- private_preserving_intent_090: original request remains immutable. This
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
     IF kind='edit' THEN$new$);
   anchor:=$old$       IF NOT public.inventory_object_v1(want,ARRAY['index','expected'])$old$;
   IF position(anchor IN body)=0 THEN RAISE EXCEPTION 'private_patch_want_anchor_changed'; END IF;
   body:=replace(body,anchor,$new$       -- The exact locked destination slot/version and bounded index identify
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
       IF NOT public.inventory_object_v1(want,ARRAY['index','expected'])$new$);
   EXECUTE body;
 END IF;
END $integration$;
-- Existing executor ACL and 10s deadline are preserved by CREATE OR REPLACE.
NOTIFY pgrst,'reload schema';
COMMIT;
