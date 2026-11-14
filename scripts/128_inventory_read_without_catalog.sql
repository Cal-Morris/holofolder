-- 128: the cookie inventory read stops building the mirror catalog per user.
--
-- inventory_read_v2 resolves every card the collection names (canonical/alias fallback, whole tcg_cards rows,
-- dex links, sets) inside the per-user snapshot: about two thirds of its DB time, for public data that is the
-- same for everyone. inventory_read_v3 returns the same scope and snapshot without the catalog ('slots' with no
-- collection is 'all' minus the catalog: revision, every collection with its slots, items and placements). The
-- app resolves the catalog from a shared cache instead (lib/server/inventory-catalog-cache.ts).
--
-- Additive and idempotent. The app falls back to inventory_read_v2 until this is applied; v2 stays for that.

CREATE OR REPLACE FUNCTION public.inventory_read_v3()
RETURNS json LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = '' AS $$
DECLARE scope jsonb := public.inventory_read_scope_v2();
BEGIN
 RETURN json_build_object('scope', scope, 'snapshot', public.inventory_snapshot_v2((scope->>'owner')::uuid, 'slots', NULL, NULL));
END $$;

REVOKE ALL ON FUNCTION public.inventory_read_v3() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.inventory_read_v3() TO authenticated;
