-- Paid accounts are affiliates automatically. An active (or past_due) paid subscription or a lifetime licence makes an
-- owner an affiliate; the trial and free invite months don't. Their invite link uses their username, so the username is
-- their join code. Automatic affiliates are paused while unpaid (no new customers or earnings, the ledger stays).
-- Enrolled affiliates (140, `automatic = false`) are unchanged. After 133, 140 and 047. Idempotent.
-- See docs/billing.md "Commission programme".
set lock_timeout = '3s';

alter table public.affiliates add column if not exists automatic boolean not null default false;
grant select (automatic) on public.affiliates to authenticated;

-- billing_has_paid (133) without the trial and granted months: money actually paid.
create or replace function public.affiliate_paid_v1(owner uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.perpetual_licences where owner_user_id = owner)
    or exists(select 1 from public.billing_accounts where owner_user_id = owner
      and status in ('active', 'past_due') and paid_through > now());
$$;

-- Whether the owner earns commission right now. A paid owner without a row is enrolled here, with their account email
-- as the payout email (also used by the self-referral checks) and their username as the display name.
create or replace function public.affiliate_active_v1(owner uuid) returns boolean
language plpgsql security definer set search_path = '' as $$
declare paid boolean := public.affiliate_paid_v1(owner);
begin
  if paid then
    insert into public.affiliates(owner_user_id, display_name, payout_email, automatic)
    select u.id, left(coalesce(i.username, split_part(u.email, '@', 1)), 80), u.email, true
    from auth.users u left join public.account_identities i on i.user_id = u.id
    where u.id = owner and u.email ~ '^[^@[:space:]]+@[^@[:space:]]+$'
    on conflict (owner_user_id) do nothing;
  end if;
  return exists(select 1 from public.affiliates a
    where a.owner_user_id = owner and a.active and (paid or not a.automatic));
end $$;

-- 133 plus usernames: an invite code is the random referral code or any username the inviter has ever held
-- (reservations are never released, so a renamed account's old links still credit it).
create or replace function public.attribute_referral_v1(invitee uuid, invite_code text, clicked_at timestamptz)
returns text language plpgsql security definer set search_path = '' as $$
declare inviter uuid; created timestamptz;
begin
  select owner_user_id into inviter from public.referral_codes where code = invite_code;
  if inviter is null then
    select r.user_id into inviter from public.account_username_reservations r
      join auth.users u on u.id = r.user_id where r.username = invite_code;
  end if;
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

revoke all on function public.affiliate_paid_v1(uuid), public.affiliate_active_v1(uuid) from public, anon, authenticated;
grant execute on function public.affiliate_active_v1(uuid) to service_role;

notify pgrst, 'reload schema';
