-- Narrow first-party grid projection. Existing user_settings RLS/ACLs remain owner-only.
BEGIN;
SET LOCAL lock_timeout='3s';
CREATE OR REPLACE FUNCTION public.inventory_grid_read_v1()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid := (select auth.uid()); claims jsonb := (select auth.jwt());
 owner_id uuid; session_id uuid; membership public.partnerships; memberships integer; settings jsonb;
BEGIN
 BEGIN session_id:=(claims->>'session_id')::uuid;
 EXCEPTION WHEN invalid_text_representation THEN
   RAISE EXCEPTION 'inventory_sign_in_required' USING ERRCODE='42501';
 END;
 -- Active PostgREST role and a live first-party session, never caller-supplied scope.
 IF current_setting('role',true) IS DISTINCT FROM 'authenticated'
   OR (select auth.role()) IS DISTINCT FROM 'authenticated' OR actor IS NULL
   OR claims->>'sub' IS DISTINCT FROM actor::text OR coalesce(claims->>'client_id','')<>''
   OR NOT EXISTS (SELECT 1 FROM auth.sessions s WHERE s.id=session_id
     AND s.user_id=actor AND s.oauth_client_id IS NULL AND (s.not_after IS NULL OR s.not_after>now())) THEN
   RAISE EXCEPTION 'inventory_sign_in_required' USING ERRCODE='42501';
 END IF;
 SELECT count(*) INTO memberships FROM public.partnerships p WHERE actor IN(p.user1_id,p.user2_id);
 IF memberships>1 THEN RAISE EXCEPTION 'inventory_read_unavailable' USING ERRCODE='55000'; END IF;
 SELECT p.* INTO membership FROM public.partnerships p WHERE actor IN(p.user1_id,p.user2_id);
 IF memberships=1 AND (membership.owner_user_id IS NULL OR membership.user1_id IS NULL OR membership.user2_id IS NULL
   OR membership.owner_user_id NOT IN(membership.user1_id,membership.user2_id)) THEN
   RAISE EXCEPTION 'inventory_read_forbidden' USING ERRCODE='42501';
 END IF;
 owner_id:=CASE WHEN memberships=1 THEN membership.owner_user_id ELSE actor END;
 IF NOT coalesce(public.billing_partner_allowed(owner_id,actor),false) THEN
   RAISE EXCEPTION 'inventory_read_forbidden' USING ERRCODE='42501';
 END IF;
 SELECT jsonb_build_object('binder_rows',s.binder_rows,'binder_cols',s.binder_cols,'updated_at',s.updated_at)
 INTO settings FROM public.user_settings s WHERE s.user_id=owner_id;
 RETURN jsonb_build_object('owner_user_id',owner_id,
   'partnership',CASE WHEN memberships=1 THEN jsonb_build_object('id',membership.id,'owner_user_id',membership.owner_user_id,
     'user1_id',membership.user1_id,'user2_id',membership.user2_id) ELSE NULL END,
   'settings',settings);
END $$;
REVOKE ALL ON FUNCTION public.inventory_grid_read_v1() FROM PUBLIC,anon,authenticated,holo_mcp,service_role;
GRANT EXECUTE ON FUNCTION public.inventory_grid_read_v1() TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
