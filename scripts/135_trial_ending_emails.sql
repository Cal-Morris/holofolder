-- 135: one "your Premium trial ends soon" email per owner, sent by the daily /api/trial-ending-emails cron.
-- trial_ending_emails is the idempotency record: a row is claimed before sending, so an owner is emailed once.
-- trial_ending_email_candidates_v1 returns the billing facts for accounts whose 056 trial ends in the window;
-- the app decides who to email (lib/trial-ending-email.ts). Service role only. Idempotent.

create table if not exists public.trial_ending_emails (
  owner_user_id uuid primary key references auth.users(id) on delete cascade,
  trial_ends_at timestamptz not null,
  claimed_at timestamptz not null default now(),
  message_id text
);

alter table public.trial_ending_emails enable row level security;
revoke all on public.trial_ending_emails from public, anon, authenticated;

create or replace function public.trial_ending_email_candidates_v1(window_start timestamptz, window_end timestamptz)
returns table (
  owner_user_id uuid,
  email text,
  trial_ends_at timestamptz,
  email_confirmed boolean,
  partner_member boolean,
  lifetime boolean,
  paid_through timestamptz,
  granted_until timestamptz,
  already_emailed boolean
)
language sql stable security definer set search_path = '' as $$
 SELECT u.id, u.email::text, u.created_at + interval '168 hours',
  u.email_confirmed_at IS NOT NULL,
  EXISTS(SELECT 1 FROM public.partnerships p
    WHERE (p.user1_id = u.id OR p.user2_id = u.id) AND p.owner_user_id <> u.id),
  EXISTS(SELECT 1 FROM public.perpetual_licences l WHERE l.owner_user_id = u.id),
  (SELECT b.paid_through FROM public.billing_accounts b
    WHERE b.owner_user_id = u.id AND b.status IN ('active', 'past_due')),
  (SELECT max(g.ends_at) FROM public.premium_grants g WHERE g.owner_user_id = u.id),
  EXISTS(SELECT 1 FROM public.trial_ending_emails e WHERE e.owner_user_id = u.id)
 FROM auth.users u
 WHERE u.created_at + interval '168 hours' >= window_start
  AND u.created_at + interval '168 hours' < window_end
  AND u.deleted_at IS NULL
  AND NOT coalesce(u.is_anonymous, false)
$$;

revoke all on function public.trial_ending_email_candidates_v1(timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.trial_ending_email_candidates_v1(timestamptz, timestamptz) to service_role;

notify pgrst, 'reload schema';
