-- Retain interrupted OAuth revocations for retry and validate existing-consent redirects.
SET lock_timeout = '3s';
ALTER TABLE public.developer_oauth_grants ADD COLUMN IF NOT EXISTS auth_revoked_at timestamptz;
CREATE OR REPLACE FUNCTION public.read_developer_oauth_request(authorization_id_input text,actor uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT jsonb_build_object('client_id',r.client_id,'grant_active',g.id IS NOT NULL AND g.revoked_at IS NULL)
 FROM auth.oauth_authorizations r
 JOIN auth.oauth_clients c ON c.id=r.client_id AND c.deleted_at IS NULL
 LEFT JOIN public.developer_oauth_grants g ON g.actor_id=actor AND g.client_id=r.client_id
 WHERE r.authorization_id=authorization_id_input AND r.user_id=actor AND r.expires_at>now()
 AND r.resource='https://holofolder.com/app/mcp' AND lower(r.code_challenge_method::text)='s256'
$$;
REVOKE ALL ON FUNCTION public.read_developer_oauth_request(text,uuid) FROM PUBLIC,anon,authenticated,holo_mcp;
GRANT EXECUTE ON FUNCTION public.read_developer_oauth_request(text,uuid) TO service_role;
NOTIFY pgrst,'reload schema';

CREATE OR REPLACE FUNCTION public.approve_developer_oauth_request(authorization_id_input text,actor uuid,granted_permissions text[])
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE request auth.oauth_authorizations; client auth.oauth_clients; grant_id uuid:=gen_random_uuid();
BEGIN
 SELECT * INTO request FROM auth.oauth_authorizations WHERE authorization_id=authorization_id_input AND expires_at>now() FOR UPDATE;
 IF NOT FOUND OR request.resource IS DISTINCT FROM 'https://holofolder.com/app/mcp' OR lower(request.code_challenge_method::text) IS DISTINCT FROM 's256' OR (request.user_id IS NOT NULL AND request.user_id<>actor) THEN RAISE EXCEPTION 'Invalid MCP authorization request'; END IF;
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
