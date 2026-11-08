-- Server-only best-effort telemetry, disabled until the privacy notice is published.
set lock_timeout = '3s';
create table if not exists public.collector_accounts (
  account_id uuid primary key references auth.users(id) on delete cascade,
  first_seen_at timestamptz not null default now(),
  owner_seen_at timestamptz,
  source text check (source is null or source in ('direct','google','bing','duckduckgo','instagram','tiktok','youtube','reddit','discord','facebook','threads','bluesky','creator','shop','newsletter','community')),
  medium text check (medium is null or medium in ('social','organic','cpc','referral','email','affiliate','qr','creator','shop')),
  campaign text check (campaign is null or campaign in ('launch','collector-growth','free-plan','import','card-show','social','newsletter'))
);
create table if not exists public.collector_events (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  actor_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (name in ('app_open','first_save','activated','upgrade_viewed','checkout_created','first_paid','paid_invoice','renewed','cancel_scheduled','cancelled')),
  occurred_at timestamptz not null,
  event_key text not null check (length(event_key) between 1 and 160),
  origin text check (origin in ('manual','import')),
  subscription_id text check (subscription_id ~ '^sub_[A-Za-z0-9]{1,100}$'),
  period_start timestamptz,
  period_end timestamptz,
  unique(owner_id,event_key)
);
create index if not exists collector_events_actor on public.collector_events(actor_id);
create index if not exists collector_events_retention on public.collector_events(occurred_at,id) where name not in ('first_save','activated','first_paid');
alter table public.collector_accounts enable row level security;
alter table public.collector_events enable row level security;
revoke all on public.collector_accounts,public.collector_events from anon,authenticated;
grant all on public.collector_accounts,public.collector_events to service_role;

create or replace function public.observe_collector_account(account uuid, observed_at timestamptz, as_owner boolean, acquisition_source text default null, acquisition_medium text default null, acquisition_campaign text default null)
returns void language sql security definer set search_path = '' as $$
  insert into public.collector_accounts(account_id,first_seen_at,owner_seen_at,source,medium,campaign)
  values(account,observed_at,case when as_owner then observed_at else null end,acquisition_source,acquisition_medium,acquisition_campaign)
  on conflict(account_id) do update set owner_seen_at = coalesce(collector_accounts.owner_seen_at, excluded.owner_seen_at);
$$;
revoke all on function public.observe_collector_account(uuid,timestamptz,boolean,text,text,text) from public,anon,authenticated;
grant execute on function public.observe_collector_account(uuid,timestamptz,boolean,text,text,text) to service_role;
