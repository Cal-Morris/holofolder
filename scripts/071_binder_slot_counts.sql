-- Group once per owner instead of issuing one HEAD request for every binder.
SET lock_timeout = '3s';
CREATE OR REPLACE FUNCTION public.get_binder_slot_counts(owner_id uuid)
RETURNS TABLE(binder_id uuid,slot_count bigint)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
 SELECT c.binder_id,count(*) FROM public.pokemon_collection c
 WHERE c.user_id=owner_id AND c.binder_id IS NOT NULL GROUP BY c.binder_id
$$;
REVOKE ALL ON FUNCTION public.get_binder_slot_counts(uuid) FROM PUBLIC,anon,authenticated,holo_mcp;
GRANT EXECUTE ON FUNCTION public.get_binder_slot_counts(uuid) TO service_role;
NOTIFY pgrst,'reload schema';
