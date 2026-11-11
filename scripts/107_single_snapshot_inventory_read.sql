-- 107: the inventory read is one SQL call over one MVCC snapshot.
--
-- GET /api/inventory used to page every table through PostgREST (~88 calls in ~43 serial waves) and then
-- re-count and re-read everything to prove nothing changed in between. One STABLE function call sees one
-- snapshot, so those counts, fences and retries go away. Legacy provenance (binder_legacy_rows,
-- inventory_items.legacy_source) is not read.
--
-- inventory_snapshot_v2   SECURITY INVOKER: the rows themselves, so RLS still decides what a caller sees.
-- inventory_read_scope_v2 SECURITY DEFINER: live session, user, partnership, billing and the owner's grid
--                         settings (a partner can't read the owner's user_settings under RLS).
-- inventory_read_v2       SECURITY INVOKER: scope + snapshot for the cookie (first-party) read.
-- developer_inventory_read_v1  SECURITY DEFINER, service_role only: the developer credential check
--                         (key or OAuth session, user state, partnership, billing) plus a scoped snapshot.
--
-- Additive and idempotent. The previous read path keeps working until the app that calls these deploys.

CREATE OR REPLACE FUNCTION public.inventory_snapshot_v2(
  owner_id uuid, part text DEFAULT 'all', only_collection uuid DEFAULT NULL, only_item text DEFAULT NULL)
RETURNS json LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  WITH
  collections AS (
    SELECT coalesce(b.id, st.collection_id) AS id, b.id AS binder_id, st.collection_id AS state_id,
      b.name, b.is_default, b.sort_order, b.binder_rows, b.binder_cols, b.updated_at,
      st.kind, st.default_presentation, st.version, st.layout_revision, st.preset_manifest, st.location
    FROM (SELECT * FROM public.binders WHERE owner_user_id = owner_id) b
    FULL JOIN (SELECT * FROM public.storage_collection_state WHERE owner_user_id = owner_id) st ON st.collection_id = b.id
    WHERE part <> 'item'
      AND (only_collection IS NULL OR coalesce(b.id, st.collection_id) = only_collection)),
  items AS MATERIALIZED (
    SELECT i.id, i.identity, i.grading, i.acquired_at, i.version
    FROM public.inventory_items i
    WHERE i.owner_user_id = owner_id AND (
      part = 'all'
      OR part = 'item' AND i.id = only_item
      OR part IN ('items', 'slots') AND (only_collection IS NULL OR i.id IN (
        SELECT p.inventory_item_id FROM public.inventory_placements p
        WHERE p.owner_user_id = owner_id AND p.collection_id = only_collection)))),
  placements AS (
    SELECT p.inventory_item_id, p.collection_id, p.slot_id, p.version
    FROM public.inventory_placements p
    WHERE p.owner_user_id = owner_id AND p.inventory_item_id IN (SELECT id FROM items)),
  card_ids AS MATERIALIZED (
    SELECT identity->>'cardId' AS id FROM items WHERE part = 'all' AND identity->>'kind' = 'card'
    UNION SELECT s.target->>'cardId' FROM public.binder_slots s
      WHERE part = 'all' AND s.owner_user_id = owner_id AND s.target->>'kind' = 'card'
    UNION SELECT w->>'card_id' FROM public.binder_slots s,
      jsonb_array_elements(CASE WHEN jsonb_typeof(s.wanted_cards) = 'array' THEN s.wanted_cards ELSE '[]' END) w
      WHERE part = 'all' AND s.owner_user_id = owner_id),
  direct AS MATERIALIZED (
    SELECT c.id, c.series_id, c.set_id, c.local_id, c.name_en, c.name_json, c.image_languages_json, c.external_ids_json
    FROM public.tcg_cards c WHERE c.id IN (SELECT id FROM card_ids)),
  -- Ids that aren't a mirror row may be a catalog canonical or alias id (indexed in 103).
  fallback AS (
    SELECT DISTINCT ON (c.id) c.id, c.series_id, c.set_id, c.local_id, c.name_en, c.name_json, c.image_languages_json, c.external_ids_json
    FROM (SELECT id FROM card_ids WHERE id IS NOT NULL EXCEPT SELECT id FROM direct) m
    CROSS JOIN LATERAL (
      SELECT c.* FROM public.tcg_cards c WHERE c.external_ids_json->'catalog'->>'canonicalId' = m.id
      UNION ALL
      SELECT c.* FROM public.tcg_cards c WHERE c.external_ids_json->'catalog'->'aliasIds' @> jsonb_build_array(m.id)) c
    WHERE NOT EXISTS (SELECT 1 FROM direct d WHERE d.id = c.id)
    ORDER BY c.id),
  cards AS MATERIALIZED (SELECT * FROM direct UNION ALL SELECT * FROM fallback)
  SELECT json_build_object(
    'revision', (SELECT o.inventory_revision FROM public.inventory_owner_state o WHERE o.owner_user_id = owner_id),
    'collections', coalesce((SELECT json_agg(json_build_object(
        'id', c.id, 'binder', c.binder_id IS NOT NULL, 'state', c.state_id IS NOT NULL,
        'name', c.name, 'is_default', c.is_default, 'sort_order', c.sort_order,
        'binder_rows', c.binder_rows, 'binder_cols', c.binder_cols, 'updated_at', c.updated_at,
        'kind', c.kind, 'default_presentation', c.default_presentation, 'version', c.version,
        'layout_revision', c.layout_revision, 'preset_manifest', c.preset_manifest, 'location', c.location,
        'slot_count', CASE WHEN part = 'collections' THEN (SELECT count(*) FROM public.binder_slots s
          WHERE s.owner_user_id = owner_id AND s.collection_id = c.id) END,
        'slots', CASE WHEN part IN ('all', 'slots') THEN coalesce((SELECT json_agg(s ORDER BY s.position) FROM (
            SELECT s.id, s.position, s.target, s.status, s.wanted_cards, s.preset_origin, s.version FROM public.binder_slots s
            WHERE s.owner_user_id = owner_id AND s.collection_id = c.id) s), '[]') END)
      ORDER BY c.id) FROM collections c), '[]'),
    'items', coalesce((SELECT json_agg(i ORDER BY i.id) FROM items i), '[]'),
    'placements', coalesce((SELECT json_agg(p ORDER BY p.inventory_item_id) FROM placements p), '[]'),
    'catalog', CASE WHEN part = 'all' THEN json_build_object(
      'cards', coalesce((SELECT json_agg(c ORDER BY c.id) FROM cards c), '[]'),
      'dex', coalesce((SELECT json_agg(json_build_object('card_id', d.card_id, 'dex_id', d.dex_id) ORDER BY d.card_id, d.dex_id)
        FROM public.tcg_card_dex_ids d WHERE d.card_id IN (SELECT id FROM cards)), '[]'),
      'sets', coalesce((SELECT json_agg(json_build_object('id', t.id, 'name_en', t.name_en) ORDER BY t.id)
        FROM public.tcg_sets t WHERE t.id IN (SELECT set_id FROM cards)), '[]')) END)
$$;

CREATE OR REPLACE FUNCTION public.inventory_read_scope_v2()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE actor uuid := (select auth.uid()); claims jsonb := (select auth.jwt());
 session_id uuid; membership public.partnerships; memberships integer; owner_id uuid; paused boolean := false; settings jsonb;
BEGIN
 BEGIN session_id := (claims->>'session_id')::uuid;
 EXCEPTION WHEN invalid_text_representation THEN RAISE EXCEPTION 'inventory_sign_in_required' USING ERRCODE = '42501';
 END;
 -- Same gate as inventory_grid_read_v1, plus the user-state check the read used to make through Auth getUser.
 IF current_setting('role', true) IS DISTINCT FROM 'authenticated'
   OR (select auth.role()) IS DISTINCT FROM 'authenticated' OR actor IS NULL
   OR claims->>'sub' IS DISTINCT FROM actor::text OR coalesce(claims->>'client_id', '') <> ''
   OR NOT EXISTS (SELECT 1 FROM auth.sessions s WHERE s.id = session_id
     AND s.user_id = actor AND s.oauth_client_id IS NULL AND (s.not_after IS NULL OR s.not_after > now()))
   OR NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = actor AND u.deleted_at IS NULL
     AND (u.banned_until IS NULL OR u.banned_until <= now())) THEN
   RAISE EXCEPTION 'inventory_sign_in_required' USING ERRCODE = '42501';
 END IF;
 SELECT count(*) INTO memberships FROM public.partnerships p WHERE actor IN (p.user1_id, p.user2_id);
 IF memberships > 1 THEN RAISE EXCEPTION 'inventory_read_unavailable' USING ERRCODE = '55000'; END IF;
 SELECT p.* INTO membership FROM public.partnerships p WHERE actor IN (p.user1_id, p.user2_id);
 IF memberships = 1 AND (membership.owner_user_id IS NULL OR membership.user1_id IS NULL OR membership.user2_id IS NULL
   OR membership.owner_user_id NOT IN (membership.user1_id, membership.user2_id)) THEN
   RAISE EXCEPTION 'inventory_read_forbidden' USING ERRCODE = '42501';
 END IF;
 owner_id := CASE WHEN memberships = 1 THEN membership.owner_user_id ELSE actor END;
 IF NOT coalesce(public.billing_partner_allowed(owner_id, actor), false) THEN
   IF owner_id = actor THEN RAISE EXCEPTION 'inventory_read_forbidden' USING ERRCODE = '42501'; END IF;
   -- A billing-paused partner reads their own collection, matching storage_execute_v1's owner selection.
   owner_id := actor; memberships := 0; paused := true;
 END IF;
 SELECT jsonb_build_object('binder_rows', s.binder_rows, 'binder_cols', s.binder_cols, 'updated_at', s.updated_at)
 INTO settings FROM public.user_settings s WHERE s.user_id = owner_id;
 RETURN jsonb_build_object('actor', actor, 'owner', owner_id, 'session_id', session_id, 'partner_paused', paused,
   'partnership', CASE WHEN memberships = 1 THEN jsonb_build_object('id', membership.id, 'owner_user_id', membership.owner_user_id,
     'user1_id', membership.user1_id, 'user2_id', membership.user2_id) END,
   'settings', settings);
END $$;

CREATE OR REPLACE FUNCTION public.inventory_read_v2()
RETURNS json LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = '' AS $$
DECLARE scope jsonb := public.inventory_read_scope_v2();
BEGIN
 RETURN json_build_object('scope', scope, 'snapshot', public.inventory_snapshot_v2((scope->>'owner')::uuid, 'all', NULL, NULL));
END $$;

-- part: 'scope' (no rows), 'collections', 'slots' (one collection), 'items' (optionally placed in one collection) or 'item'.
-- Collection metadata comes with every part except 'item'; slots only with 'slots'.
CREATE OR REPLACE FUNCTION public.developer_inventory_read_v1(
  transport text, credential uuid, actor uuid, oauth_session uuid DEFAULT NULL, oauth_client uuid DEFAULT NULL,
  part text DEFAULT 'scope', only_collection uuid DEFAULT NULL, only_item text DEFAULT NULL)
RETURNS json LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE permissions jsonb; membership public.partnerships; memberships integer; owner_id uuid; access jsonb;
BEGIN
 IF part NOT IN ('scope', 'collections', 'slots', 'items', 'item') OR part = 'slots' AND only_collection IS NULL
   OR part = 'item' AND only_item IS NULL THEN
   RAISE EXCEPTION 'invalid_native_read' USING ERRCODE = '22023';
 END IF;
 IF transport = 'rest' THEN
   SELECT to_jsonb(k.permissions) INTO permissions FROM public.developer_api_keys k
   WHERE k.id = credential AND k.actor_id = actor AND k.revoked_at IS NULL AND k.expires_at > now();
 ELSIF transport = 'mcp' THEN
   -- Live OAuth session for this client and grant version; the grant id is the credential.
   permissions := public.verify_developer_oauth_session(oauth_session, actor, oauth_client, credential)->'permissions';
 END IF;
 IF permissions IS NULL OR NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = actor AND u.deleted_at IS NULL
   AND (u.banned_until IS NULL OR u.banned_until <= now())) THEN
   RAISE EXCEPTION 'native_read_forbidden' USING ERRCODE = '42501';
 END IF;
 SELECT count(*) INTO memberships FROM public.partnerships p WHERE actor IN (p.user1_id, p.user2_id);
 IF memberships > 1 THEN RAISE EXCEPTION 'native_read_unavailable' USING ERRCODE = '55000'; END IF;
 SELECT p.* INTO membership FROM public.partnerships p WHERE actor IN (p.user1_id, p.user2_id);
 IF memberships = 1 AND (membership.owner_user_id IS NULL OR membership.user1_id IS NULL OR membership.user2_id IS NULL
   OR membership.owner_user_id NOT IN (membership.user1_id, membership.user2_id)) THEN
   RAISE EXCEPTION 'native_read_forbidden' USING ERRCODE = '42501';
 END IF;
 owner_id := CASE WHEN memberships = 1 THEN membership.owner_user_id ELSE actor END;
 IF NOT coalesce(public.billing_partner_allowed(owner_id, actor), false) THEN
   RAISE EXCEPTION 'native_read_forbidden' USING ERRCODE = '42501';
 END IF;
 -- resolve_developer_access's billing projection, read in this snapshot. The app decides entitlement.
 SELECT jsonb_build_object('perpetual', EXISTS (SELECT 1 FROM public.perpetual_licences WHERE owner_user_id = owner_id),
   'status', billing.status, 'paid_through', billing.paid_through) INTO access
 FROM public.billing_configuration config LEFT JOIN public.billing_accounts billing ON billing.owner_user_id = owner_id
 WHERE config.id;
 IF access IS NULL THEN RAISE EXCEPTION 'native_read_unavailable' USING ERRCODE = '55000'; END IF;
 RETURN json_build_object('scope', jsonb_build_object('permissions', permissions, 'owner', owner_id,
     'members', CASE WHEN memberships = 1 THEN jsonb_build_array(membership.user1_id, membership.user2_id) ELSE jsonb_build_array(actor) END,
     'partnership', CASE WHEN memberships = 1 THEN jsonb_build_object('id', membership.id, 'owner_user_id', membership.owner_user_id,
       'user1_id', membership.user1_id, 'user2_id', membership.user2_id) END,
     'billing_access', access),
   'snapshot', CASE WHEN part <> 'scope' THEN public.inventory_snapshot_v2(owner_id, part, only_collection, only_item) END,
   'settings', CASE WHEN part = 'collections' THEN (SELECT json_build_object('binder_rows', s.binder_rows, 'binder_cols', s.binder_cols)
     FROM public.user_settings s WHERE s.user_id = owner_id) END);
END $$;

REVOKE ALL ON FUNCTION public.inventory_snapshot_v2(uuid, text, uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.inventory_read_scope_v2() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.inventory_read_v2() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.developer_inventory_read_v1(text, uuid, uuid, uuid, uuid, text, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.inventory_snapshot_v2(uuid, text, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.inventory_read_scope_v2() TO authenticated;
GRANT EXECUTE ON FUNCTION public.inventory_read_v2() TO authenticated;
GRANT EXECUTE ON FUNCTION public.developer_inventory_read_v1(text, uuid, uuid, uuid, uuid, text, uuid, text) TO service_role;
