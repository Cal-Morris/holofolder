-- Minimal isolated schema for the real billing migration and simultaneous-client cap test.
CREATE ROLE anon;
CREATE ROLE authenticated;
CREATE ROLE service_role BYPASSRLS;
CREATE SCHEMA auth;
CREATE TABLE auth.users(id uuid PRIMARY KEY,created_at timestamptz DEFAULT clock_timestamp());
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql AS $$ SELECT coalesce(nullif(current_setting('request.jwt.claim.role',true),''),'service_role') $$;
CREATE TABLE public.partnerships(id uuid DEFAULT gen_random_uuid(),owner_user_id uuid,user1_id uuid,user2_id uuid);
CREATE TABLE public.pokemon_collection(user_id uuid,binder_id uuid,pokemon_id integer,pokemon_name text,status text DEFAULT 'collected',wanted_cards jsonb DEFAULT '[]',PRIMARY KEY(binder_id,pokemon_id));
CREATE TABLE public.user_settings(user_id uuid);
CREATE TABLE public.binders(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),owner_user_id uuid);
CREATE TABLE public.binder_appearances(owner_user_id uuid);
CREATE TABLE public.collection_activity(owner_user_id uuid);
CREATE TABLE public.show_purchases(owner_user_id uuid);
CREATE TABLE public.binder_shares(owner_user_id uuid,is_enabled boolean);
CREATE TABLE public.partner_invites(inviter_id uuid);
CREATE FUNCTION public.sync_binder_history(uuid,uuid,uuid,uuid,jsonb) RETURNS jsonb LANGUAGE plpgsql AS $$
BEGIN
 RETURN '{}';
END $$;
CREATE FUNCTION public.save_collection_with_acquisition(uuid,uuid,uuid,integer,jsonb,jsonb,jsonb,text) RETURNS jsonb LANGUAGE plpgsql AS $$
BEGIN
 RETURN '{}';
END $$;
