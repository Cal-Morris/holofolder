-- Account deletion runs through Supabase Auth without public native-table access.
-- The deferred placement guard needs its trusted owner on PostgreSQL 17.
BEGIN;
SET LOCAL lock_timeout = '3s';
ALTER FUNCTION public.check_slot_placement_v1() SECURITY DEFINER;
COMMIT;
