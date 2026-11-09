-- Internal #383 follow-up. Apply AFTER 077, in one transaction; no runtime grants.
-- Patch the installed 076-wrapped executor, never replace it with the original 075 body.
BEGIN;
SET LOCAL lock_timeout='3s';
DO $integration$
DECLARE body text;
BEGIN
 SELECT pg_get_functiondef('public.inventory_command_v1(uuid,uuid,jsonb,jsonb)'::regprocedure) INTO body;
 IF to_regprocedure('collection_audit_private.recovery_apply_v1(uuid,uuid,jsonb,jsonb)') IS NULL THEN
   RAISE EXCEPTION 'collection_delete_requires_077_recovery';
 END IF;
 IF position('collection_audit_private.command_result' IN body)=0 THEN
   RAISE EXCEPTION 'collection_delete_requires_076_recorder';
 END IF;
 IF position('whole_collection_delete boolean' IN body)=0 THEN
   IF position('BEGIN' IN body)=0 OR position('octet_length(request::text)>262144' IN body)=0
     OR position('IF affected>256 THEN' IN body)=0 OR position('octet_length(result::text)>1048576' IN body)=0
     OR position('jsonb_array_length(request->''collections'')>32' IN body)=0
     OR position('BEGIN'||chr(10)||' IF actor IS NULL' IN body)=0
     OR position('ELSIF kind=''deleteCollection'' THEN'||chr(10)||'     IF NOT' IN body)=0 THEN
     RAISE EXCEPTION 'collection_delete_integration_changed';
   END IF;
   body:=replace(body,'BEGIN'||chr(10)||' IF actor IS NULL',
     ' whole_collection_delete boolean;'||chr(10)||'BEGIN'||chr(10)||
     ' whole_collection_delete:=CASE WHEN jsonb_typeof(request->''commands'')=''array'' THEN jsonb_array_length(request->''commands'')=1 AND request->''commands''->0->>''kind''=''deleteCollection'' ELSE false END;'||chr(10)||' IF actor IS NULL');
   body:=replace(body,'octet_length(request::text)>262144',
     'octet_length(request::text)>(CASE WHEN whole_collection_delete THEN 8388608 ELSE 262144 END)');
   body:=replace(body,'jsonb_array_length(request->''collections'')>32',
     'jsonb_array_length(request->''collections'')>(CASE WHEN whole_collection_delete THEN 2 ELSE 32 END)');
   body:=replace(body,'IF affected>256 THEN',
     'IF affected>(CASE WHEN whole_collection_delete THEN 8192 ELSE 256 END) THEN');
   body:=replace(body,'octet_length(result::text)>1048576',
     'octet_length(result::text)>(CASE WHEN whole_collection_delete THEN 16777216 ELSE 1048576 END)');
   -- Only the exact full-collection command can use these limits, including native default replacement.
   body:=replace(body,'ELSIF kind=''deleteCollection'' THEN'||chr(10)||'     IF NOT',
     'ELSIF kind=''deleteCollection'' THEN'||chr(10)||
     '     IF jsonb_typeof(command->''slots'')=''array'' AND jsonb_array_length(command->''slots'')>4096 THEN RAISE EXCEPTION ''inventory_collection_capacity_exceeded'' USING ERRCODE=''22023''; END IF;'||chr(10)||'     IF NOT');
   IF position('whole_collection_delete boolean' IN body)=0 OR position('inventory_collection_capacity_exceeded' IN body)=0 THEN
     RAISE EXCEPTION 'collection_delete_integration_changed';
   END IF;
   EXECUTE body;
 END IF;
 IF position('octet_length(request::text)>(CASE WHEN whole_collection_delete THEN 8388608 ELSE 262144 END)' IN body)=0
   OR position('jsonb_array_length(request->''collections'')>(CASE WHEN whole_collection_delete THEN 2 ELSE 32 END)' IN body)=0
   OR position('IF affected>(CASE WHEN whole_collection_delete THEN 8192 ELSE 256 END)' IN body)=0
   OR position('octet_length(result::text)>(CASE WHEN whole_collection_delete THEN 16777216 ELSE 1048576 END)' IN body)=0
   OR position('inventory_collection_capacity_exceeded' IN body)=0 THEN
   RAISE EXCEPTION 'collection_delete_integration_changed';
 END IF;
END $integration$;
-- 076 capture/immutable/flush and 077 recovery, including partnership-before-owner locks,
-- stay installed unchanged. Their 16,384-entity / 16 MiB evidence bound still aborts atomically.
NOTIFY pgrst,'reload schema';
COMMIT;
