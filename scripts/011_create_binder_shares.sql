CREATE TABLE IF NOT EXISTS public.binder_shares (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE,
  is_enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  CONSTRAINT binder_shares_owner_unique UNIQUE (owner_user_id)
);

CREATE INDEX IF NOT EXISTS idx_binder_shares_token
  ON public.binder_shares (token);

CREATE INDEX IF NOT EXISTS idx_binder_shares_owner_user_id
  ON public.binder_shares (owner_user_id);

ALTER TABLE public.binder_shares ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own binder share" ON public.binder_shares;
CREATE POLICY "Users can view their own binder share"
  ON public.binder_shares FOR SELECT
  USING (auth.uid() = owner_user_id);

DROP POLICY IF EXISTS "Users can insert their own binder share" ON public.binder_shares;
CREATE POLICY "Users can insert their own binder share"
  ON public.binder_shares FOR INSERT
  WITH CHECK (auth.uid() = owner_user_id);

DROP POLICY IF EXISTS "Users can update their own binder share" ON public.binder_shares;
CREATE POLICY "Users can update their own binder share"
  ON public.binder_shares FOR UPDATE
  USING (auth.uid() = owner_user_id)
  WITH CHECK (auth.uid() = owner_user_id);

DROP POLICY IF EXISTS "Users can delete their own binder share" ON public.binder_shares;
CREATE POLICY "Users can delete their own binder share"
  ON public.binder_shares FOR DELETE
  USING (auth.uid() = owner_user_id);
