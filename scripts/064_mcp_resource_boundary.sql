-- Supabase OAuth consent can auto-approve subsequent requests without our consent RPC.
-- This project's OAuth server serves MCP only: enforce resource + S256 at the authorization
-- source, including auto-approval. Normal first-party login and refresh do not insert here.
SET lock_timeout = '3s';
CREATE OR REPLACE FUNCTION public.require_mcp_authorization_resource()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NEW.resource IS DISTINCT FROM 'https://holofolder.com/app/mcp'
 OR lower(NEW.code_challenge_method::text) IS DISTINCT FROM 's256'
 OR NEW.code_challenge IS NULL OR length(NEW.code_challenge)<43 THEN
  RAISE EXCEPTION 'MCP authorization requires its exact resource and S256 PKCE' USING ERRCODE='42501';
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.require_mcp_authorization_resource() FROM PUBLIC,anon,authenticated,service_role,holo_mcp;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='auth.oauth_authorizations'::regclass AND tgname='require_holo_mcp_resource' AND NOT tgisinternal) THEN
  CREATE TRIGGER require_holo_mcp_resource BEFORE INSERT OR UPDATE OF resource,code_challenge,code_challenge_method ON auth.oauth_authorizations FOR EACH ROW EXECUTE FUNCTION public.require_mcp_authorization_resource();
 END IF;
END $$;
NOTIFY pgrst,'reload schema';
