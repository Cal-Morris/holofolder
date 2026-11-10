-- #363/#379 prerequisite only. Install INACTIVE; activation belongs to a later cutover.
BEGIN;
SET LOCAL lock_timeout='3s';
-- Serialize installation with every pre-existing writer, including writers without this trigger.
LOCK TABLE public.pokemon_collection IN SHARE ROW EXCLUSIVE MODE;
DO $$ BEGIN
 IF to_regclass('collection_audit_private.legacy_write_fence') IS NULL THEN
   IF to_regprocedure('collection_audit_private.legacy_write_enforced()') IS NOT NULL THEN
     RAISE EXCEPTION 'legacy_collection_fence_state_missing' USING ERRCODE='HF961';
   END IF;
   CREATE TABLE collection_audit_private.legacy_write_fence (
     id boolean PRIMARY KEY DEFAULT true CHECK(id),
     enforced boolean NOT NULL DEFAULT false
   );
   INSERT INTO collection_audit_private.legacy_write_fence VALUES(true,false);
 END IF;
END $$;
REVOKE ALL ON collection_audit_private.legacy_write_fence FROM PUBLIC,anon,authenticated,holo_mcp,service_role;

-- Monotonic, including migration reapplication. Missing state is never reinitialized.
CREATE OR REPLACE FUNCTION collection_audit_private.keep_legacy_write_fence() RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $$ BEGIN
 IF TG_OP='UPDATE' AND OLD.id AND NEW.id AND (NOT OLD.enforced OR NEW.enforced) THEN RETURN NEW; END IF;
 RAISE EXCEPTION 'legacy_collection_fence_monotonic' USING ERRCODE='HF961';
END $$;
DROP TRIGGER IF EXISTS legacy_write_fence_monotonic ON collection_audit_private.legacy_write_fence;
CREATE TRIGGER legacy_write_fence_monotonic BEFORE UPDATE OR DELETE ON collection_audit_private.legacy_write_fence
 FOR EACH ROW EXECUTE FUNCTION collection_audit_private.keep_legacy_write_fence();
DROP TRIGGER IF EXISTS legacy_write_fence_no_truncate ON collection_audit_private.legacy_write_fence;
CREATE TRIGGER legacy_write_fence_no_truncate BEFORE TRUNCATE ON collection_audit_private.legacy_write_fence
 FOR EACH STATEMENT EXECUTE FUNCTION collection_audit_private.keep_legacy_write_fence();

-- FOR SHARE both drains existing writes and detects stale RR/serializable snapshots.
-- A shared advisory lock followed by an ordinary SELECT would NOT provide that guarantee.
CREATE OR REPLACE FUNCTION collection_audit_private.legacy_write_enforced() RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET lock_timeout='3s' AS $$
DECLARE active boolean;
BEGIN
 BEGIN
   SELECT enforced INTO active FROM collection_audit_private.legacy_write_fence WHERE id FOR SHARE;
 EXCEPTION WHEN serialization_failure OR lock_not_available THEN
   RAISE EXCEPTION 'legacy_collection_write_paused' USING ERRCODE='PT503',
     DETAIL='retainOnDevice=true; retry only through the coordinated sender';
 WHEN undefined_table OR undefined_column OR datatype_mismatch OR invalid_text_representation THEN
   RAISE EXCEPTION 'legacy_collection_write_paused' USING ERRCODE='PT503',
     DETAIL='retainOnDevice=true; fence state unavailable';
 END;
 IF active IS NULL THEN RAISE EXCEPTION 'legacy_collection_write_paused' USING ERRCODE='PT503',DETAIL='retainOnDevice=true; fence state unavailable'; END IF;
 RETURN active;
END $$;

CREATE OR REPLACE FUNCTION collection_audit_private.activate_legacy_write_fence() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET lock_timeout='3s' AS $$ BEGIN
 -- UPDATE conflicts with all shared writer locks until those transactions finish.
 UPDATE collection_audit_private.legacy_write_fence SET enforced=true WHERE id;
 IF NOT FOUND THEN RAISE EXCEPTION 'legacy_collection_fence_state_missing' USING ERRCODE='HF961'; END IF;
END $$;

CREATE OR REPLACE FUNCTION collection_audit_private.guard_legacy_write_statement() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN
 PERFORM collection_audit_private.legacy_write_enforced();
 RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION collection_audit_private.guard_legacy_write_row() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE target_owner uuid; ctx jsonb; raw_context jsonb; before_row jsonb; after_row jsonb;
BEGIN
 IF NOT collection_audit_private.legacy_write_enforced() THEN
   IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
 END IF;
 -- Only a deleted FK parent permits lifecycle removal. No trigger-depth/role exemption.
 IF TG_OP='DELETE' THEN
   IF NOT EXISTS(SELECT 1 FROM public.binders WHERE id=OLD.binder_id)
     OR NOT EXISTS(SELECT 1 FROM auth.users WHERE id=OLD.user_id) THEN RETURN OLD; END IF;
 END IF;
 target_owner:=CASE WHEN TG_OP='DELETE' THEN OLD.user_id ELSE NEW.user_id END;
 -- Existing exact frozen-source recovery authority remains private and unchanged.
 IF TG_OP='INSERT' AND collection_audit_private.frozen_restore_v1(NEW) THEN RETURN NEW; END IF;
 IF TG_OP<>'INSERT' THEN before_row:=collection_audit_private.state('pokemon_collection',to_jsonb(OLD)); END IF;
 IF TG_OP<>'DELETE' THEN after_row:=collection_audit_private.state('pokemon_collection',to_jsonb(NEW)); END IF;
 -- 087 places its already validated, locked inverse here before DML. Only that exact inverse.
 IF EXISTS(SELECT 1 FROM collection_audit_private.pending p JOIN public.collection_activity e
   ON e.id=p.recovery_of_event_id AND e.owner_user_id=p.owner_id
   CROSS JOIN LATERAL jsonb_array_elements(e.recovery_state) d
   WHERE p.transaction_id=txid_current() AND p.owner_id=target_owner AND p.context->>'action'='recovery.apply'
   AND p.context->'actor'->>'kind'='user' AND p.context->>'source' IN ('app','rest','mcp')
   AND d->>'table'='pokemon_collection'
   AND nullif(d->'after','null') IS NOT DISTINCT FROM before_row
   AND nullif(d->'before','null') IS NOT DISTINCT FROM after_row) THEN
   IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
 END IF;
 IF current_setting('role',true)='service_role' THEN
   BEGIN
     ctx:=collection_audit_private.context(target_owner);
     raw_context:=((coalesce(nullif(current_setting('request.headers',true),''),'{}')::jsonb)->>'x-holo-audit-context')::jsonb;
   EXCEPTION WHEN OTHERS THEN
     RAISE EXCEPTION 'legacy_collection_write_paused' USING ERRCODE='PT503',DETAIL='retainOnDevice=true; invalid trusted context';
   END;
   IF ctx->'actor'->>'kind'='user' AND (
     (ctx->>'source' IN ('rest','mcp') AND length(ctx->>'clientId') BETWEEN 1 AND 200)
     OR (ctx->>'source'='app' AND raw_context->>'purpose'='legacy.queue' AND raw_context->'legacyQueueGeneration'='2'::jsonb)
   ) THEN
     IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
   END IF;
 END IF;
 RAISE EXCEPTION 'legacy_collection_write_paused' USING ERRCODE='PT503',
   DETAIL='retainOnDevice=true; unsupported legacy writer';
END $$;

-- Patch only the installed 087 facade, preserving all authorization, CAS, billing and ledger checks.
DO $integration$
DECLARE body text; anchor text:=' -- Free weight before restoring it elsewhere, so a final-state-neutral inverse fits at the cap.';
BEGIN
 SELECT pg_get_functiondef('public.collection_recovery_v1(text,uuid,jsonb)'::regprocedure) INTO body;
 IF position('096 exact inverse authority' IN body)=0 THEN
   IF position(anchor IN body)=0 OR position('recovery_requires_separate_transaction' IN body)=0 THEN
     RAISE EXCEPTION 'legacy_fence_recovery_integration_changed'; END IF;
   body:=replace(body,anchor,$patch$ -- 096 exact inverse authority, after all existing preview/token/lock checks.
 INSERT INTO collection_audit_private.pending(transaction_id,owner_id,context,recovery_of_event_id)
 VALUES(txid_current(),owner_id,ctx||jsonb_build_object('action','recovery.apply'),original.id);
$patch$||anchor);
   EXECUTE body;
 END IF;
END $integration$;
DROP TRIGGER IF EXISTS legacy_write_fence_statement ON public.pokemon_collection;
CREATE TRIGGER legacy_write_fence_statement BEFORE INSERT OR UPDATE OR DELETE ON public.pokemon_collection
 FOR EACH STATEMENT EXECUTE FUNCTION collection_audit_private.guard_legacy_write_statement();
DROP TRIGGER IF EXISTS pokemon_collection_guard_ingress ON public.pokemon_collection;
CREATE TRIGGER pokemon_collection_guard_ingress BEFORE INSERT OR UPDATE OR DELETE ON public.pokemon_collection
 FOR EACH ROW EXECUTE FUNCTION collection_audit_private.guard_legacy_write_row();
ALTER TABLE public.pokemon_collection ENABLE ALWAYS TRIGGER legacy_write_fence_statement;
ALTER TABLE public.pokemon_collection ENABLE ALWAYS TRIGGER pokemon_collection_guard_ingress;
REVOKE ALL ON FUNCTION collection_audit_private.keep_legacy_write_fence(),
 collection_audit_private.legacy_write_enforced(),collection_audit_private.activate_legacy_write_fence(),
 collection_audit_private.guard_legacy_write_statement(),collection_audit_private.guard_legacy_write_row()
 FROM PUBLIC,anon,authenticated,holo_mcp,service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
