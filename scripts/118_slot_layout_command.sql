-- 118: `layout` slot command. Changes a native binder's page grid (rows × columns) through slot_command_v1,
-- so it gets the same revision preconditions, idempotency ledger, offline queue and Activity/Undo as every
-- other slot edit. Pockets are an ordered list paged by rows × columns, so a grid change never touches a
-- slot, a placement or a want: cards keep their pockets and their order, only page breaks move. It always
-- advances layout_revision. Custom (non-preset) grids stay premium through the existing
-- enforce_custom_binder_layout trigger (057, 'upgrade_required'). Patches the 108 definition; idempotent via the marker.
BEGIN;
SET LOCAL lock_timeout='3s';
DO $slot_layout$
DECLARE body text; anchor text;
BEGIN
 SELECT pg_get_functiondef('public.slot_command_v1(uuid,uuid,jsonb,jsonb)'::regprocedure) INTO body;
 IF position('-- binder_layout_118' IN body)>0 THEN RETURN; END IF;

 anchor:=$old$ changes jsonb[]:='{}'; hit boolean;$old$;
 IF position(anchor IN body)=0 THEN RAISE EXCEPTION 'slot_layout_declare_anchor_changed'; END IF;
 body:=replace(body,anchor,$new$ changes jsonb[]:='{}'; hit boolean; layout_seen boolean:=false;$new$);

 anchor:=$old$   IF jsonb_typeof(command)<>'object' OR NOT coalesce(kind IN ('create','update','clear','remove','move'),false) THEN RAISE EXCEPTION 'invalid_slot_command' USING ERRCODE='22023'; END IF;
   IF kind='create' THEN$old$;
 IF position(anchor IN body)=0 THEN RAISE EXCEPTION 'slot_layout_validate_anchor_changed'; END IF;
 body:=replace(body,anchor,$new$   IF jsonb_typeof(command)<>'object' OR NOT coalesce(kind IN ('create','update','clear','remove','move','layout'),false) THEN RAISE EXCEPTION 'invalid_slot_command' USING ERRCODE='22023'; END IF;
   -- binder_layout_118: one whole-binder grid per request. It names no slot, so it adds no slot work.
   IF kind='layout' THEN
     IF layout_seen OR command-ARRAY['kind','rows','cols']<>'{}' OR jsonb_typeof(command->'rows') IS DISTINCT FROM 'number'
       OR jsonb_typeof(command->'cols') IS DISTINCT FROM 'number' OR (command->>'rows')!~'^[1-8]$' OR (command->>'cols')!~'^[1-8]$' THEN
       RAISE EXCEPTION 'invalid_slot_command' USING ERRCODE='22023'; END IF;
     layout_seen:=true; CONTINUE;
   END IF;
   IF kind='create' THEN$new$);

 anchor:=$old$   kind:=command->>'kind';
   IF kind IN ('create','move') THEN$old$;
 IF position(anchor IN body)=0 THEN RAISE EXCEPTION 'slot_layout_apply_anchor_changed'; END IF;
 body:=replace(body,anchor,$new$   kind:=command->>'kind';
   IF kind='layout' THEN
     -- The trigger from 057 raises upgrade_required for a custom grid without Premium.
     WITH u AS (UPDATE public.binders SET binder_rows=(command->>'rows')::integer,binder_cols=(command->>'cols')::integer
       WHERE id=collection AND owner_user_id=owner_id
       AND (binder_rows IS DISTINCT FROM (command->>'rows')::integer OR binder_cols IS DISTINCT FROM (command->>'cols')::integer) RETURNING *)
     SELECT changes||array_agg(collection_audit_private.delta('binders',to_jsonb(o),to_jsonb(u))) INTO changes FROM u JOIN public.binders o ON o.id=u.id;
     -- Always a new layout revision, so a queued projection and the server agree without knowing the stored grid.
     structural:=true; changed:=true;
   ELSIF kind IN ('create','move') THEN$new$);

 EXECUTE body;
END $slot_layout$;
NOTIFY pgrst,'reload schema';
COMMIT;
