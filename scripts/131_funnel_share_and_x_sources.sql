-- Adds funnel attribution slugs: source `share` (public binder share CTA), source `x` (X/Twitter posts) and
-- campaign `share-link`. Must match `approved` in lib/collector-funnel.ts. Widening only, so existing rows
-- always satisfy the new checks. Idempotent.
set lock_timeout = '3s';
alter table public.collector_accounts drop constraint if exists collector_accounts_source_check;
alter table public.collector_accounts add constraint collector_accounts_source_check check (source is null or source in ('direct','google','bing','duckduckgo','instagram','tiktok','youtube','reddit','discord','facebook','threads','bluesky','creator','shop','newsletter','community','share','x'));
alter table public.collector_accounts drop constraint if exists collector_accounts_campaign_check;
alter table public.collector_accounts add constraint collector_accounts_campaign_check check (campaign is null or campaign in ('launch','collector-growth','free-plan','import','card-show','social','newsletter','share-link'));
