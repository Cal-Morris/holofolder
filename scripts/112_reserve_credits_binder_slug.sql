-- /app/credits is a real page (credits and attributions), so no binder may take "credits" as its address.
-- Mirrors RESERVED_BINDER_SLUGS in lib/binders/url.ts. Checked before applying: no binder_public_slugs row uses it.
SET lock_timeout = '3s';
CREATE OR REPLACE FUNCTION public.binder_slug_reserved(slug text) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT slug = ANY (ARRAY['api','app-shell','auth','docs','e2e-harness','home','mcp','oauth','share','studio','u',
    'settings','admin','new','login','logout','account','inventory','dex','offline','help','credits'])
$$;
