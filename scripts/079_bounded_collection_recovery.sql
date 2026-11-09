-- Internal #396/#383 plan computation only. Apply after 078, as one transaction.
-- Preserve the installed 076 recorder, 077 executor and every runtime denial.
BEGIN;
SET LOCAL lock_timeout='3s';
DO $performance$
DECLARE body text; old_layout text; new_layout text;
BEGIN
 IF position('whole_collection_delete boolean' IN pg_get_functiondef('public.inventory_command_v1(uuid,uuid,jsonb,jsonb)'::regprocedure))=0 THEN
   RAISE EXCEPTION 'recovery_performance_requires_078';
 END IF;
 SELECT pg_get_functiondef('collection_audit_private.recovery_plan_v1(uuid,uuid,bigint,text[])'::regprocedure) INTO body;
 old_layout:=$old$AND NOT EXISTS(
     SELECT 1 FROM jsonb_array_elements(inverse) e WHERE e->>'table'='storage_collection_state' AND e->>'id'=coalesce(a,b)->>'collection_id'
       AND (e->'after'='null' OR e->'before'->'layout_revision' IS DISTINCT FROM e->'after'->'layout_revision')) THEN$old$;
 new_layout:=$new$AND NOT coalesce((coalesce(a,b)->>'collection_id')=ANY(layout_collections),false) THEN$new$;
 IF position('inverse_rows jsonb[]' IN body)=0 THEN
   IF position(' inverse jsonb:=''[]'';' IN body)=0
     OR position('inverse:=inverse||jsonb_build_array(d);' IN body)=0
     OR position(' -- An explicit Unassigned restore' IN body)=0
     OR position(' -- Current values/absence' IN body)=0
     OR position(old_layout IN body)=0 THEN
     RAISE EXCEPTION 'recovery_performance_integration_changed';
   END IF;
   -- Expanded SQL arrays append without repeatedly copying the growing JSONB document.
   -- Convert once, preserving exact inverse order and all existing skip/validation decisions.
   body:=replace(body,' inverse jsonb:=''[]'';', ' layout_collections text[]; inverse_rows jsonb[]:=''{}''; inverse jsonb:=''[]'';');
   body:=replace(body,'inverse:=inverse||jsonb_build_array(d);','inverse_rows:=array_append(inverse_rows,d);');
   body:=replace(body,' -- An explicit Unassigned restore', E' inverse:=to_jsonb(inverse_rows);\n -- An explicit Unassigned restore');
   -- Use the final inverse AFTER explicit Unassigned filtering, never the original event.
   -- A deleted root or a recorded layout revision delta is the same evidence as before.
   body:=replace(body,' -- Current values/absence', $layout$ SELECT coalesce(array_agg(e->>'id'),'{}') INTO layout_collections
 FROM jsonb_array_elements(inverse) e WHERE e->>'table'='storage_collection_state'
   AND (e->'after'='null' OR e->'before'->'layout_revision' IS DISTINCT FROM e->'after'->'layout_revision');
 -- Current values/absence$layout$);
   body:=replace(body,old_layout,new_layout);
   EXECUTE body;
 END IF;
 IF position('inverse_rows:=array_append(inverse_rows,d);' IN body)=0
   OR position('inverse:=to_jsonb(inverse_rows);' IN body)=0
   OR position('INTO layout_collections' IN body)=0
   OR position(new_layout IN body)=0
   OR position('inverse:=inverse||jsonb_build_array(d);' IN body)>0 THEN
   RAISE EXCEPTION 'recovery_performance_integration_changed';
 END IF;
 -- The outer query already requires s.id=slot_key. Bind the inner existence lookup
 -- to that same key so PostgreSQL cannot hash every placement for each deferred row check.
 SELECT pg_get_functiondef('public.check_slot_placement_v1()'::regprocedure) INTO body;
 IF position('p.slot_id = s.id' IN body)>0 THEN
   body:=replace(body,'p.slot_id = s.id','p.slot_id = slot_key');
   EXECUTE body;
 END IF;
 IF position('p.slot_id = slot_key' IN body)=0 THEN
   RAISE EXCEPTION 'recovery_placement_check_integration_changed';
 END IF;
END $performance$;
-- No helper, grant, persistent plan/history structure, index or retention change.
NOTIFY pgrst,'reload schema';
COMMIT;
