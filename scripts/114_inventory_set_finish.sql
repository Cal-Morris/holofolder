-- 114: `setFinish` inventory command. Corrects a card copy's recorded finish in place, keeping the same
-- copy, grading, acquired date and placement. A placed copy must still match its pocket's target, so a pocket
-- that pins a finish can't be changed this way. Recorded in collection_activity like every other edit, so
-- Activity can undo it. Patches the 111 definition of inventory_command_v1; idempotent via the marker.
BEGIN;
SET LOCAL lock_timeout='3s';
DO $set_finish$
DECLARE body text; anchor text;
BEGIN
 SELECT pg_get_functiondef('public.inventory_command_v1(uuid,uuid,jsonb,jsonb)'::regprocedure) INTO body;
 IF position('-- set_finish_114' IN body)>0 THEN RETURN; END IF;

 anchor:=$old$ELSIF kind IN ('edit','patchGrading','removeOwned','unassign','move') THEN$old$;
 IF position(anchor IN body)=0 THEN RAISE EXCEPTION 'set_finish_kind_anchor_changed'; END IF;
 body:=replace(body,anchor,$new$ELSIF kind IN ('edit','setFinish','patchGrading','removeOwned','unassign','move') THEN$new$);

 anchor:=$old$CASE kind WHEN 'patchGrading' THEN ARRAY['kind','item','patch']$old$;
 IF position(anchor IN body)=0 THEN RAISE EXCEPTION 'set_finish_shape_anchor_changed'; END IF;
 body:=replace(body,anchor,$new$CASE kind WHEN 'setFinish' THEN ARRAY['kind','item','finish'] WHEN 'patchGrading' THEN ARRAY['kind','item','patch']$new$);

 anchor:=$old$     ELSIF kind='unassign' THEN effective:=placement.slot_id IS NOT NULL;$old$;
 IF position(anchor IN body)=0 THEN RAISE EXCEPTION 'set_finish_validate_anchor_changed'; END IF;
 body:=replace(body,anchor,$new$     -- set_finish_114: only the finish changes; the copy must still match its pocket.
     ELSIF kind='setFinish' THEN
       identity_value:=jsonb_set(chosen.identity,'{finish}',command->'finish');
       IF chosen.identity->>'kind'<>'card' OR jsonb_typeof(command->'finish') IS DISTINCT FROM 'string'
         OR NOT public.valid_inventory_identity_v1(identity_value) THEN RAISE EXCEPTION 'invalid_inventory_command' USING ERRCODE='22023'; END IF;
       IF placement.slot_id IS NOT NULL THEN
         PERFORM public.inventory_match_v1(identity_value,(SELECT target FROM public.binder_slots WHERE id=placement.slot_id AND owner_user_id=owner_id));
       END IF;
       effective:=chosen.identity IS DISTINCT FROM identity_value;
$new$||anchor);

 anchor:=$old$   IF kind='edit' AND effective THEN$old$;
 IF position(anchor IN body)=0 THEN RAISE EXCEPTION 'set_finish_write_anchor_changed'; END IF;
 body:=replace(body,anchor,$new$   IF kind='setFinish' AND effective THEN
     WITH u AS (UPDATE public.inventory_items SET identity=identity_value,version=version+1,updated_at=now() WHERE id=chosen.id AND owner_user_id=owner_id RETURNING *)
     SELECT changes||array_agg(collection_audit_private.delta('inventory_items',to_jsonb(o),to_jsonb(u))) INTO changes FROM u JOIN public.inventory_items o ON o.id=u.id;
   END IF;
$new$||anchor);

 EXECUTE body;
END $set_finish$;
COMMIT;
