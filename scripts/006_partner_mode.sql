CREATE TABLE IF NOT EXISTS public.partner_invites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  inviter_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  inviter_email TEXT,
  invitee_email TEXT NOT NULL,
  status TEXT DEFAULT 'pending',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.partnerships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user1_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  user2_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  CONSTRAINT partnerships_pair_unique UNIQUE (user1_id, user2_id)
);

ALTER TABLE public.partner_invites
ADD COLUMN IF NOT EXISTS inviter_email TEXT;

ALTER TABLE public.partner_invites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.partnerships ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can create invites" ON public.partner_invites;
CREATE POLICY "Users can create invites"
  ON public.partner_invites FOR INSERT
  WITH CHECK (auth.uid() = inviter_id);

DROP POLICY IF EXISTS "Users can view invites they sent or received" ON public.partner_invites;
CREATE POLICY "Users can view invites they sent or received"
  ON public.partner_invites FOR SELECT
  USING (
    auth.uid() = inviter_id
    OR invitee_email = COALESCE(auth.jwt() ->> 'email', '')
  );

DROP POLICY IF EXISTS "Users can update invites they received" ON public.partner_invites;
CREATE POLICY "Users can update invites they received"
  ON public.partner_invites FOR UPDATE
  USING (
    invitee_email = COALESCE(auth.jwt() ->> 'email', '')
  );

DROP POLICY IF EXISTS "Users can create partnerships" ON public.partnerships;
CREATE POLICY "Users can create partnerships"
  ON public.partnerships FOR INSERT
  WITH CHECK (auth.uid() = user1_id OR auth.uid() = user2_id);

DROP POLICY IF EXISTS "Users can view their partnerships" ON public.partnerships;
CREATE POLICY "Users can view their partnerships"
  ON public.partnerships FOR SELECT
  USING (auth.uid() = user1_id OR auth.uid() = user2_id);

DROP POLICY IF EXISTS "Users can delete their partnerships" ON public.partnerships;
CREATE POLICY "Users can delete their partnerships"
  ON public.partnerships FOR DELETE
  USING (auth.uid() = user1_id OR auth.uid() = user2_id);

CREATE INDEX IF NOT EXISTS idx_partner_invites_inviter_id
  ON public.partner_invites(inviter_id);

CREATE INDEX IF NOT EXISTS idx_partner_invites_invitee_email
  ON public.partner_invites(invitee_email);

CREATE INDEX IF NOT EXISTS idx_partner_invites_status
  ON public.partner_invites(status);

CREATE INDEX IF NOT EXISTS idx_partnerships_user1_id
  ON public.partnerships(user1_id);

CREATE INDEX IF NOT EXISTS idx_partnerships_user2_id
  ON public.partnerships(user2_id);
