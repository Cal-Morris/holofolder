-- Invite a friend: each owner has a stable invite code; a genuinely new account that signs up through it is attributed
-- once, and when that invitee reaches 10 saved entries both sides get 30 days of server-owned Premium time.
-- Grants are read by billing_has_paid/get_billing_access like the 056 trial: no Stripe objects, they lapse to free.
-- Lifetime and active subscriptions still take precedence. Writes only through the service-role functions below.
-- Idempotent. See docs/billing.md "Invite a friend".
set lock_timeout = '3s';

create table if not exists public.referral_codes (
  owner_user_id uuid primary key references auth.users(id) on delete cascade,
  code text not null unique check (code ~ '^[a-z2-9]{10}$'),
  created_at timestamptz not null default now()
);
create table if not exists public.referrals (
  id uuid primary key default gen_random_uuid(),
  inviter_user_id uuid not null references auth.users(id) on delete cascade,
  invitee_user_id uuid not null unique references auth.users(id) on delete cascade,
  attributed_at timestamptz not null default now(),
  rewarded_at timestamptz,
  check (inviter_user_id <> invitee_user_id)
);
create index if not exists referrals_inviter on public.referrals(inviter_user_id);
create table if not exists public.premium_grants (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  reason text not null check (reason in ('referral_inviter','referral_invitee')),
  -- Kept (set null) when either account is deleted later: time already earned stays with the remaining owner.
  referral_id uuid references public.referrals(id) on delete set null,
  created_at timestamptz not null default now(),
  check (ends_at > starts_at),
  unique (referral_id, reason)
);
create index if not exists premium_grants_owner on public.premium_grants(owner_user_id, ends_at);

alter table public.referral_codes enable row level security;
alter table public.referrals enable row level security;
alter table public.premium_grants enable row level security;
revoke all on public.referral_codes, public.referrals, public.premium_grants from anon, authenticated;
grant select on public.referral_codes, public.referrals, public.premium_grants to authenticated;
grant all on public.referral_codes, public.referrals, public.premium_grants to service_role;
drop policy if exists referral_codes_own on public.referral_codes;
create policy referral_codes_own on public.referral_codes for select to authenticated
  using (owner_user_id = (select auth.uid()));
drop policy if exists referrals_own on public.referrals;
create policy referrals_own on public.referrals for select to authenticated
  using (inviter_user_id = (select auth.uid()) or invitee_user_id = (select auth.uid()));
drop policy if exists premium_grants_own on public.premium_grants;
create policy premium_grants_own on public.premium_grants for select to authenticated
  using (owner_user_id = (select auth.uid()));

create or replace function public.referral_code_v1(owner uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare found_code text;
begin
  loop
    select code into found_code from public.referral_codes where owner_user_id = owner;
    if found_code is not null then return found_code; end if;
    -- Not a secret: a guessed code only credits a random inviter, which the activation rule still gates.
    insert into public.referral_codes(owner_user_id, code)
    select owner, string_agg(substr('abcdefghijkmnpqrstuvwxyz23456789', 1 + floor(random() * 32)::int, 1), '')
    from generate_series(1, 10)
    on conflict do nothing;
  end loop;
end $$;

create or replace function public.referral_partners_v1(a uuid, b uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.partnerships p
    where (p.user1_id = a and p.user2_id = b) or (p.user1_id = b and p.user2_id = a));
$$;

-- clicked_at comes from the server-signed invite cookie, so "created after clicking" is the server's own clock.
create or replace function public.attribute_referral_v1(invitee uuid, invite_code text, clicked_at timestamptz)
returns text language plpgsql security definer set search_path = '' as $$
declare inviter uuid; created timestamptz;
begin
  select owner_user_id into inviter from public.referral_codes where code = invite_code;
  if inviter is null then return 'unknown_code'; end if;
  if inviter = invitee then return 'self'; end if;
  select u.created_at into created from auth.users u where u.id = invitee;
  if created is null or clicked_at is null or created < clicked_at or created < now() - interval '7 days' then
    return 'not_new';
  end if;
  if public.referral_partners_v1(inviter, invitee) then return 'partner'; end if;
  insert into public.referrals(inviter_user_id, invitee_user_id) values (inviter, invitee)
  on conflict (invitee_user_id) do nothing;
  return case when found then 'attributed' else 'already_attributed' end;
end $$;

-- One 30-day grant, chained after the owner's trial and existing grants so nothing overlaps. Serialized per owner.
create or replace function public.premium_grant_add_v1(owner uuid, grant_reason text, referral uuid) returns boolean
language plpgsql security definer set search_path = '' as $$
declare start_at timestamptz;
begin
  perform pg_advisory_xact_lock(hashtextextended('premium_grants:' || owner::text, 0));
  -- Inviter cap: at most 12 rewarded invites (360 days) per owner, ever.
  if grant_reason = 'referral_inviter' and (select count(*) from public.premium_grants
      where owner_user_id = owner and reason = 'referral_inviter') >= 12 then
    return false;
  end if;
  select greatest(now(),
    (select u.created_at + interval '168 hours' from auth.users u where u.id = owner),
    (select max(g.ends_at) from public.premium_grants g where g.owner_user_id = owner))
  into start_at;
  insert into public.premium_grants(owner_user_id, starts_at, ends_at, reason, referral_id)
  values (owner, start_at, start_at + interval '30 days', grant_reason, referral)
  on conflict (referral_id, reason) do nothing;
  return found;
end $$;

create or replace function public.claim_referral_reward_v1(invitee uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare r public.referrals;
begin
  select * into r from public.referrals where invitee_user_id = invitee for update;
  if r.id is null then return 'none'; end if;
  if r.rewarded_at is not null then return 'already_rewarded'; end if;
  -- Activation: 10 saved entries persisted on the server (queued offline edits count once they sync).
  if public.slot_saved_count_v1(invitee) < 10 then return 'not_activated'; end if;
  if public.referral_partners_v1(r.inviter_user_id, invitee) then return 'partner'; end if;
  perform public.premium_grant_add_v1(invitee, 'referral_invitee', r.id);
  perform public.premium_grant_add_v1(r.inviter_user_id, 'referral_inviter', r.id);
  update public.referrals set rewarded_at = now() where id = r.id;
  return 'rewarded';
end $$;

revoke all on function public.referral_code_v1(uuid), public.referral_partners_v1(uuid, uuid),
  public.attribute_referral_v1(uuid, text, timestamptz), public.premium_grant_add_v1(uuid, text, uuid),
  public.claim_referral_reward_v1(uuid) from public, anon, authenticated;
grant execute on function public.referral_code_v1(uuid), public.attribute_referral_v1(uuid, text, timestamptz),
  public.claim_referral_reward_v1(uuid) to service_role;

-- 056 plus active grants.
create or replace function public.billing_has_paid(owner_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
 SELECT EXISTS(SELECT 1 FROM public.perpetual_licences WHERE owner_user_id=owner_id)
 OR EXISTS(SELECT 1 FROM public.billing_accounts WHERE owner_user_id=owner_id
   AND status IN ('active','past_due') AND paid_through>now())
 OR EXISTS(SELECT 1 FROM auth.users WHERE id=owner_id
   AND created_at<=now() AND created_at+interval '168 hours'>now())
 OR EXISTS(SELECT 1 FROM public.premium_grants WHERE owner_user_id=owner_id
   AND starts_at<=now() AND ends_at>now())
$$;

-- 056 plus granted_until (end of the contiguous grant chain) and referral_pending (an unrewarded invitee).
create or replace function public.get_billing_access(owner_id uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
 SELECT jsonb_build_object('enforced',c.enforced,
  'perpetual',EXISTS(SELECT 1 FROM public.perpetual_licences WHERE owner_user_id=owner_id),
  'status',(SELECT status FROM public.billing_accounts WHERE owner_user_id=owner_id),
  'paid_through',(SELECT paid_through FROM public.billing_accounts WHERE owner_user_id=owner_id),
  'trial_ends_at',(SELECT created_at+interval '168 hours' FROM auth.users WHERE id=owner_id AND created_at<=now()),
  'granted_until',(SELECT max(ends_at) FROM public.premium_grants WHERE owner_user_id=owner_id AND ends_at>now()),
  'referral_pending',EXISTS(SELECT 1 FROM public.referrals WHERE invitee_user_id=owner_id AND rewarded_at IS NULL),
  'saved_card_count',public.slot_saved_count_v1(owner_id),'free_card_limit',c.free_card_limit,'free_binder_limit',c.free_binder_limit)
 FROM public.billing_configuration c WHERE c.id
 AND ((select auth.role())='service_role' OR public.billing_partner_allowed(owner_id,(select auth.uid())))
$$;

notify pgrst, 'reload schema';
