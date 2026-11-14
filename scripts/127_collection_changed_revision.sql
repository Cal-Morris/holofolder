-- 127: The collection_changed ping (122) carries the inventory revision the write produced, so the device that
-- made the edit (and already holds that revision) skips the full re-read. Every writer that bumps
-- inventory_owner_state.inventory_revision records that row's before/after in the activity's `changes`, so the
-- revision comes straight from NEW.changes. A write that did not bump it (a binder rename, settings) sends
-- {"revision": null} and clients re-read as before. realtime.send still swallows its own errors. Idempotent.

CREATE OR REPLACE FUNCTION collection_audit_private.broadcast_collection_changed()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
BEGIN
 PERFORM realtime.send(
   jsonb_build_object('revision', (
     SELECT (e->'after'->>'inventory_revision')::bigint FROM jsonb_array_elements(
       CASE jsonb_typeof(NEW.changes) WHEN 'array' THEN NEW.changes ELSE '[]' END) e
     WHERE e->>'table' = 'inventory_owner_state' LIMIT 1)),
   'collection_changed', 'collection:' || NEW.owner_user_id::text, true);
 RETURN NULL;
END $function$;
