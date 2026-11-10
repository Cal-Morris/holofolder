-- Account deletion runs through Supabase Auth without public native-table access.
-- The deferred placement guard needs its trusted owner on PostgreSQL 17.
BEGIN;
SET LOCAL lock_timeout = '3s';
ALTER FUNCTION public.check_slot_placement_v1() SECURITY DEFINER;
DO $account_cascade$
DECLARE body text; anchor text;
BEGIN
 SELECT pg_get_functiondef('public.guard_legacy_binder_write_v1()'::regprocedure) INTO body;
 IF position('-- auth_account_cascade_099' IN body)=0 THEN
   anchor:=E'BEGIN\n IF TG_OP=''INSERT'' AND collection_audit_private.frozen_restore_v1(NEW) THEN RETURN NEW; END IF;';
   IF position(anchor IN body)=0 THEN RAISE EXCEPTION 'auth_account_cascade_guard_changed'; END IF;
   body:=replace(body,anchor,$replacement$BEGIN
 -- auth_account_cascade_099: the actual referenced account is gone, regardless of FK cascade order.
 IF TG_OP = 'DELETE' AND OLD.user_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM auth.users WHERE id=OLD.user_id) THEN
   RETURN OLD;
 END IF;
 IF TG_OP='INSERT' AND collection_audit_private.frozen_restore_v1(NEW) THEN RETURN NEW; END IF;$replacement$);
   EXECUTE body;
 END IF;
END $account_cascade$;
COMMIT;
