-- 122: Ping open screens when a collection changes, so a partner's edit (app, REST API or MCP)
-- shows up without switching tabs. Every collection writer records exactly one
-- collection_activity row (108), so one AFTER INSERT trigger covers them all. It sends an
-- empty Broadcast on the private topic `collection:<owner id>`; clients re-read through the
-- normal API. realtime.send swallows its own errors, so a Realtime problem never fails a write.
-- Only the owner and their partner may join the topic. Developer OAuth tokens use their own
-- role, not `authenticated`, so they can't. Idempotent; skipped where there is no realtime
-- schema (the local fresh-schema check).

CREATE OR REPLACE FUNCTION collection_audit_private.broadcast_collection_changed()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
BEGIN
 PERFORM realtime.send('{}'::jsonb, 'collection_changed', 'collection:' || NEW.owner_user_id::text, true);
 RETURN NULL;
END $function$;

DO $$
BEGIN
 IF to_regclass('realtime.messages') IS NULL THEN RETURN; END IF;

 DROP TRIGGER IF EXISTS collection_changed_broadcast ON public.collection_activity;
 CREATE TRIGGER collection_changed_broadcast AFTER INSERT ON public.collection_activity
   FOR EACH ROW EXECUTE FUNCTION collection_audit_private.broadcast_collection_changed();

 DROP POLICY IF EXISTS "Owner or partner receive collection changes" ON realtime.messages;
 CREATE POLICY "Owner or partner receive collection changes" ON realtime.messages FOR SELECT TO authenticated
   USING (
     realtime.messages.extension = 'broadcast'
     AND (select realtime.topic()) IN (
       SELECT 'collection:' || (select auth.uid())::text
       UNION ALL
       SELECT 'collection:' || p.owner_user_id::text FROM public.partnerships p
       WHERE p.user1_id = (select auth.uid()) OR p.user2_id = (select auth.uid())
     )
   );
END $$;
