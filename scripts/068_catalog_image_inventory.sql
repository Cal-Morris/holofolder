-- Record confirmed public mirror objects, so API responses never probe R2 per image.
SET lock_timeout = '3s';
CREATE TABLE IF NOT EXISTS public.card_image_inventory (
 bucket text NOT NULL,
 object_key text NOT NULL CHECK (object_key LIKE 'cards/%'),
 observed_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (bucket,object_key)
);
ALTER TABLE public.card_image_inventory ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.card_image_inventory FROM PUBLIC,anon,authenticated,holo_mcp;
GRANT ALL ON public.card_image_inventory TO service_role;
NOTIFY pgrst,'reload schema';
