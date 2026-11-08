-- Install the OAuth boundary before enabling hosted OAuth or dynamic registration.
SET lock_timeout = '3s';
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='holo_mcp') THEN CREATE ROLE holo_mcp NOLOGIN NOINHERIT; END IF;
END $$;
-- Deliberately do not grant holo_mcp to authenticator: MCP JWTs cannot impersonate a DB role.
CREATE TABLE IF NOT EXISTS public.developer_oauth_grants (
 id uuid NOT NULL DEFAULT gen_random_uuid(),
 actor_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 client_id uuid NOT NULL,
 client_name text NOT NULL CHECK(length(client_name)<=200),
 redirect_origin text NOT NULL,
 permissions text[] NOT NULL CHECK(permissions <@ ARRAY['catalog:read','prices:read','prices:refresh','binders:read','binders:write','collection:read','collection:write','settings:read','settings:write','sharing:manage','partners:manage']::text[]),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 revoked_at timestamptz,
 PRIMARY KEY(actor_id,client_id)
);
ALTER TABLE public.developer_oauth_grants ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.developer_oauth_grants FROM PUBLIC,anon,authenticated,holo_mcp;
GRANT ALL ON public.developer_oauth_grants TO service_role;

CREATE OR REPLACE FUNCTION public.developer_access_token_hook(event jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE claims jsonb:=event->'claims'; client text; grant_id uuid;
BEGIN
 client:=coalesce(claims->>'client_id',event->>'client_id');
 IF client IS NULL THEN RETURN jsonb_build_object('claims',claims); END IF;
 SELECT id INTO grant_id FROM public.developer_oauth_grants WHERE actor_id=(event->>'user_id')::uuid AND client_id=client::uuid AND revoked_at IS NULL;
 IF grant_id IS NULL THEN RAISE EXCEPTION 'MCP consent required'; END IF;
 claims:=jsonb_set(claims,'{aud}','"https://holofolder.com/app/mcp"'::jsonb);
 claims:=jsonb_set(claims,'{role}','"holo_mcp"'::jsonb);
 claims:=jsonb_set(claims,'{developer_grant_id}',to_jsonb(grant_id));
 RETURN jsonb_build_object('claims',claims);
END $$;
REVOKE ALL ON FUNCTION public.developer_access_token_hook(jsonb) FROM PUBLIC,anon,authenticated,service_role,holo_mcp;
GRANT EXECUTE ON FUNCTION public.developer_access_token_hook(jsonb) TO supabase_auth_admin;

CREATE OR REPLACE FUNCTION public.verify_developer_oauth_session(session uuid,actor uuid,client uuid,grant_version uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT jsonb_build_object('id',g.id,'permissions',g.permissions,'redirect_origin',g.redirect_origin) FROM public.developer_oauth_grants g
 JOIN auth.sessions s ON s.id=session AND s.user_id=g.actor_id AND s.oauth_client_id=g.client_id
 JOIN auth.oauth_clients c ON c.id=g.client_id AND c.deleted_at IS NULL
 WHERE g.actor_id=actor AND g.client_id=client AND g.id=grant_version AND g.revoked_at IS NULL
 AND s.created_at>=g.created_at AND (s.not_after IS NULL OR s.not_after>now())
$$;
REVOKE ALL ON FUNCTION public.verify_developer_oauth_session(uuid,uuid,uuid,uuid) FROM PUBLIC,anon,authenticated,holo_mcp;
GRANT EXECUTE ON FUNCTION public.verify_developer_oauth_session(uuid,uuid,uuid,uuid) TO service_role;
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
 ON CONFLICT(actor_id,client_id) DO UPDATE SET id=excluded.id,client_name=excluded.client_name,redirect_origin=excluded.redirect_origin,permissions=excluded.permissions,created_at=excluded.created_at,revoked_at=NULL;
 RETURN grant_id;
END $$;
REVOKE ALL ON FUNCTION public.approve_developer_oauth_request(text,uuid,text[]) FROM PUBLIC,anon,authenticated,holo_mcp;
GRANT EXECUTE ON FUNCTION public.approve_developer_oauth_request(text,uuid,text[]) TO service_role;
NOTIFY pgrst,'reload schema';
