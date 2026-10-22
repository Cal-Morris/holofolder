-- Security: pin search_path on the functions the Supabase security advisor flags as function_search_path_mutable
-- (the job queue's helper functions and public.infer_card_finish_from_tcg_metadata). Their bodies already
-- schema-qualify every table and type, so an empty search_path changes nothing except that a caller can no longer
-- shadow built-ins with objects in their own schema.
-- Live-safe (ALTER FUNCTION ... SET only touches the function's settings) and idempotent. Functions that don't
-- exist in an environment are skipped. If a job queue upgrade recreates its functions, re-run this script.

DO $$
DECLARE fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'graphile_worker.add_job(text, json, text, timestamp with time zone, integer, text, integer, text[], text)',
    'graphile_worker.add_jobs(graphile_worker.job_spec[], boolean)',
    'graphile_worker.complete_jobs(bigint[])',
    'graphile_worker.force_unlock_workers(text[])',
    'graphile_worker.permanently_fail_jobs(bigint[], text)',
    'graphile_worker.remove_job(text)',
    'graphile_worker.reschedule_jobs(bigint[], timestamp with time zone, integer, integer, integer)',
    'public.infer_card_finish_from_tcg_metadata(text, text, integer, jsonb)'
  ] LOOP
    -- Skip functions that don't exist in this environment (for example, no job queue schema).
    IF to_regprocedure(fn) IS NOT NULL THEN
      EXECUTE format('ALTER FUNCTION %s SET search_path = %L', to_regprocedure(fn), '');
    END IF;
  END LOOP;
END $$;
