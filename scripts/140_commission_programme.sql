-- Commission programme: enrolled affiliates (creators and partners Cal enrols) earn 30% of what customers they bring in
-- actually pay. Attribution is decided once per customer at Checkout (first touch, before their first payment); the
-- ledger is written only from verified Stripe webhooks, idempotent on the Stripe object, and payouts stay manual.
-- Writes are service-role only; affiliates can read their own row and their own entries. Idempotent.
-- See docs/billing.md "Commission programme".
set lock_timeout = '3s';

create table if not exists public.affiliates (
  owner_user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (length(display_name) between 1 and 80),
  -- Private: where Cal sends payouts. Not readable by any client role (column grants below).
  payout_email text not null check (payout_email ~ '^[^@[:space:]]+@[^@[:space:]]+$'),
  -- The affiliate's audience promotion code, if they have one. Invite-link-only partners have none.
  stripe_promotion_code_id text unique check (stripe_promotion_code_id ~ '^promo_[A-Za-z0-9]+$'),
  promotion_code text check (promotion_code ~ '^[A-Z0-9-]{1,40}$'),
  -- Inactive affiliates get no new customers and no new earnings; their existing ledger stays.
  active boolean not null default true,
  enrolled_at timestamptz not null default now()
);

-- One affiliate per customer, ever: the primary key is the customer.
create table if not exists public.affiliate_customers (
  customer_owner_id uuid primary key references auth.users(id) on delete cascade,
  affiliate_owner_id uuid not null references public.affiliates(owner_user_id) on delete cascade,
  source text not null check (source in ('invite', 'promotion_code')),
  stripe_checkout_session_id text not null,
  attributed_at timestamptz not null,
  check (customer_owner_id <> affiliate_owner_id)
);
create index if not exists affiliate_customers_affiliate on public.affiliate_customers(affiliate_owner_id);

create table if not exists public.commission_entries (
  id uuid primary key default gen_random_uuid(),
  affiliate_owner_id uuid not null references public.affiliates(owner_user_id) on delete cascade,
  -- Kept (set null) if the customer deletes their account: the affiliate still earned it.
  customer_owner_id uuid references auth.users(id) on delete set null,
  kind text not null check (kind in ('subscription', 'lifetime', 'adjustment')),
  -- Idempotency: the invoice id, the lifetime Checkout session id, or `adjust:<Stripe event id>`.
  stripe_object_id text not null unique,
  -- The PaymentIntent (or charge) that refunds and disputes point back to.
  stripe_payment_ref text,
  earning_id uuid references public.commission_entries(id) on delete cascade,
  -- GBP pence actually paid after discounts (for an adjustment: what is left after refunds and disputes).
  amount_paid_pence integer not null check (amount_paid_pence >= 0),
  rate_bps integer not null check (rate_bps between 1 and 10000),
  -- Negative for an adjustment that takes commission back.
  commission_pence integer not null,
  occurred_at timestamptz not null,
  -- Pending until hold_until (30 days after payment for earnings), then payable, then paid when Cal pays out.
  hold_until timestamptz not null,
  status text not null default 'pending' check (status in ('pending', 'paid')),
  paid_out_at timestamptz,
  created_at timestamptz not null default now(),
  check ((kind = 'adjustment') = (earning_id is not null)),
  check ((status = 'paid') = (paid_out_at is not null))
);
create index if not exists commission_entries_affiliate on public.commission_entries(affiliate_owner_id, status, hold_until);
create index if not exists commission_entries_customer on public.commission_entries(customer_owner_id);
create index if not exists commission_entries_earning on public.commission_entries(earning_id);
create unique index if not exists commission_entries_payment
  on public.commission_entries(stripe_payment_ref) where kind <> 'adjustment';

alter table public.affiliates enable row level security;
alter table public.affiliate_customers enable row level security;
alter table public.commission_entries enable row level security;
revoke all on public.affiliates, public.affiliate_customers, public.commission_entries from anon, authenticated;
grant all on public.affiliates, public.affiliate_customers, public.commission_entries to service_role;
-- Affiliates see their own row without the payout email, and their own entries without customer or Stripe ids.
-- affiliate_customers has no client access at all: the app shows a count, computed on the server.
grant select (owner_user_id, display_name, promotion_code, active, enrolled_at) on public.affiliates to authenticated;
grant select (id, affiliate_owner_id, kind, amount_paid_pence, rate_bps, commission_pence, occurred_at, hold_until,
  status, paid_out_at, created_at) on public.commission_entries to authenticated;
drop policy if exists affiliates_own on public.affiliates;
create policy affiliates_own on public.affiliates for select to authenticated
  using (owner_user_id = (select auth.uid()));
drop policy if exists commission_entries_own on public.commission_entries;
create policy commission_entries_own on public.commission_entries for select to authenticated
  using (affiliate_owner_id = (select auth.uid()));

-- Moves an earning's commission to match what the customer has kept paid after refunds and disputes. The earning is
-- row-locked so concurrent refund and dispute webhooks can't both take the same money back. remaining_paid comes from
-- Stripe's current state (charge amount minus refunded, 0 while a dispute holds the money), so the target is absolute:
-- out-of-order events and a won dispute (money restored) converge, and adjustment_key (the Stripe event id) makes a
-- replay a no-op. Returns the change in pence, or null when the payment earned no commission (not ours, £0).
create or replace function public.commission_adjust_v1(payment_ref text, adjustment_key text, remaining_paid integer,
  adjusted_at timestamptz) returns integer
language plpgsql security definer set search_path = '' as $$
declare e public.commission_entries; current_total integer; target integer; delta integer;
begin
  select * into e from public.commission_entries where stripe_payment_ref = payment_ref and kind <> 'adjustment'
    for update;
  if e.id is null then return null; end if;
  if exists(select 1 from public.commission_entries where stripe_object_id = adjustment_key) then return 0; end if;
  select e.commission_pence + coalesce(sum(a.commission_pence), 0) into current_total
    from public.commission_entries a where a.earning_id = e.id;
  remaining_paid := greatest(0, least(remaining_paid, e.amount_paid_pence));
  target := floor(remaining_paid::numeric * e.rate_bps / 10000)::integer;
  delta := target - current_total;
  if delta = 0 then return 0; end if;
  insert into public.commission_entries(affiliate_owner_id, customer_owner_id, kind, stripe_object_id,
    stripe_payment_ref, earning_id, amount_paid_pence, rate_bps, commission_pence, occurred_at, hold_until)
  values (e.affiliate_owner_id, e.customer_owner_id, 'adjustment', adjustment_key, payment_ref, e.id, remaining_paid,
    -- Shares the earning's hold, so a refund inside the hold cancels out before anything is payable.
    e.rate_bps, delta, adjusted_at, greatest(adjusted_at, e.hold_until))
  on conflict (stripe_object_id) do nothing;
  return delta;
end $$;
revoke all on function public.commission_adjust_v1(text, text, integer, timestamptz) from public, anon, authenticated;
grant execute on function public.commission_adjust_v1(text, text, integer, timestamptz) to service_role;

notify pgrst, 'reload schema';
