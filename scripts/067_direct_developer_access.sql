-- Developer clients bypass Framer so OAuth discovery headers reach MCP clients.
-- Deploy the matching app resource and apply this migration before onboarding clients.
SET lock_timeout = '3s';
CREATE OR REPLACE FUNCTION public.developer_access_token_hook(event jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE claims jsonb:=event->'claims'; client text; grant_id uuid;
BEGIN
 client:=coalesce(claims->>'client_id',event->>'client_id');
 IF client IS NULL THEN RETURN jsonb_build_object('claims',claims); END IF;
 SELECT id INTO grant_id FROM public.developer_oauth_grants WHERE actor_id=(event->>'user_id')::uuid AND client_id=client::uuid AND revoked_at IS NULL;
 IF grant_id IS NULL THEN RAISE EXCEPTION 'MCP consent required'; END IF;
 claims:=jsonb_set(claims,'{aud}','"https://app.holofolder.com/app/mcp"'::jsonb);
 claims:=jsonb_set(claims,'{role}','"holo_mcp"'::jsonb);
 claims:=jsonb_set(claims,'{developer_grant_id}',to_jsonb(grant_id));
 RETURN jsonb_build_object('claims',claims);
END $$;
REVOKE ALL ON FUNCTION public.developer_access_token_hook(jsonb) FROM PUBLIC,anon,authenticated,service_role,holo_mcp;
GRANT EXECUTE ON FUNCTION public.developer_access_token_hook(jsonb) TO supabase_auth_admin;


CREATE OR REPLACE FUNCTION public.require_mcp_authorization_resource()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NEW.resource IS DISTINCT FROM 'https://app.holofolder.com/app/mcp'
 OR lower(NEW.code_challenge_method::text) IS DISTINCT FROM 's256'
 OR NEW.code_challenge IS NULL OR length(NEW.code_challenge)<43 THEN
  RAISE EXCEPTION 'MCP authorization requires its exact resource and S256 PKCE' USING ERRCODE='42501';
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.require_mcp_authorization_resource() FROM PUBLIC,anon,authenticated,service_role,holo_mcp;

CREATE OR REPLACE FUNCTION public.read_developer_oauth_request(authorization_id_input text,actor uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT jsonb_build_object('client_id',r.client_id,'grant_active',g.id IS NOT NULL AND g.revoked_at IS NULL)
 FROM auth.oauth_authorizations r
 JOIN auth.oauth_clients c ON c.id=r.client_id AND c.deleted_at IS NULL
 LEFT JOIN public.developer_oauth_grants g ON g.actor_id=actor AND g.client_id=r.client_id
 WHERE r.authorization_id=authorization_id_input AND r.user_id=actor AND r.expires_at>now()
 AND r.resource='https://app.holofolder.com/app/mcp' AND lower(r.code_challenge_method::text)='s256'
$$;
REVOKE ALL ON FUNCTION public.read_developer_oauth_request(text,uuid) FROM PUBLIC,anon,authenticated,holo_mcp;
GRANT EXECUTE ON FUNCTION public.read_developer_oauth_request(text,uuid) TO service_role;
NOTIFY pgrst,'reload schema';

CREATE OR REPLACE FUNCTION public.approve_developer_oauth_request(authorization_id_input text,actor uuid,granted_permissions text[])
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE request auth.oauth_authorizations; client auth.oauth_clients; grant_id uuid:=gen_random_uuid();
BEGIN
 SELECT * INTO request FROM auth.oauth_authorizations WHERE authorization_id=authorization_id_input AND expires_at>now() FOR UPDATE;
 IF NOT FOUND OR request.resource IS DISTINCT FROM 'https://app.holofolder.com/app/mcp' OR lower(request.code_challenge_method::text) IS DISTINCT FROM 's256' OR (request.user_id IS NOT NULL AND request.user_id<>actor) THEN RAISE EXCEPTION 'Invalid MCP authorization request'; END IF;
 SELECT * INTO client FROM auth.oauth_clients WHERE id=request.client_id AND deleted_at IS NULL;
 IF NOT FOUND THEN RAISE EXCEPTION 'OAuth client unavailable'; END IF;
 INSERT INTO public.developer_oauth_grants(id,actor_id,client_id,client_name,redirect_origin,permissions,created_at,revoked_at)
 VALUES(grant_id,actor,client.id,left(coalesce(client.client_name,'MCP client'),200),coalesce(substring(request.redirect_uri from '^https?://[^/]+'),'null'),granted_permissions,clock_timestamp(),NULL)
 ON CONFLICT(actor_id,client_id) DO UPDATE SET id=excluded.id,client_name=excluded.client_name,redirect_origin=excluded.redirect_origin,permissions=excluded.permissions,created_at=excluded.created_at,revoked_at=NULL,auth_revoked_at=NULL;
 RETURN grant_id;
END $$;
REVOKE ALL ON FUNCTION public.approve_developer_oauth_request(text,uuid,text[]) FROM PUBLIC,anon,authenticated,holo_mcp;
GRANT EXECUTE ON FUNCTION public.approve_developer_oauth_request(text,uuid,text[]) TO service_role;
NOTIFY pgrst,'reload schema';
