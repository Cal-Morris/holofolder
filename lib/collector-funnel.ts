export const FUNNEL_EVENTS = [
  'app_open',
  'first_save',
  'activated',
  'upgrade_viewed',
  'checkout_created',
  'first_paid',
  'paid_invoice',
  'renewed',
  'cancel_scheduled',
  'cancelled',
] as const;
export type FunnelEventName = (typeof FUNNEL_EVENTS)[number];
export const DURABLE_FUNNEL_EVENTS = ['first_save', 'activated', 'first_paid'] as const;
const approved = {
  source: new Set([
    'direct',
    'google',
    'bing',
    'duckduckgo',
    'instagram',
    'tiktok',
    'youtube',
    'reddit',
    'discord',
    'facebook',
    'threads',
    'bluesky',
    'creator',
    'shop',
    'newsletter',
    'community',
  ]),
  medium: new Set(['social', 'organic', 'cpc', 'referral', 'email', 'affiliate', 'qr', 'creator', 'shop']),
  campaign: new Set(['launch', 'collector-growth', 'free-plan', 'import', 'card-show', 'social', 'newsletter']),
};
export interface FunnelAttribution {
  source: string | null;
  medium: string | null;
  campaign: string | null;
}
export function sanitizeAttribution(raw: unknown): FunnelAttribution {
  const value = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const field = (key: keyof FunnelAttribution) => {
    const v = typeof value[key] === 'string' ? value[key].trim().toLowerCase() : '';
    return approved[key].has(v) ? v : null;
  };
  return { source: field('source'), medium: field('medium'), campaign: field('campaign') };
}
export function readClientFunnelEvent(raw: unknown) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Invalid event.');
  const body = raw as Record<string, unknown>;
  if (
    Object.keys(body).some((key) => key !== 'event' && key !== 'attribution') ||
    (body.event !== 'app_open' && body.event !== 'upgrade_viewed')
  )
    throw new Error('Unsupported client event.');
  return { event: body.event as 'app_open' | 'upgrade_viewed', attribution: sanitizeAttribution(body.attribution) };
}
export interface FunnelAccount extends FunnelAttribution {
  account_id: string;
  first_seen_at: string;
  owner_seen_at: string | null;
}
export interface FunnelEvent {
  owner_id: string;
  actor_id: string;
  name: string;
  occurred_at: string;
  event_key: string;
  origin: string | null;
  subscription_id: string | null;
  period_start: string | null;
  period_end: string | null;
}

/** Ordered observed-owner cohorts, never click totals or an accounting report. `to` is exclusive. */
export function funnelReport(accounts: FunnelAccount[], events: FunnelEvent[], from: string, to: string) {
  const start = Date.parse(from),
    end = Math.min(Date.parse(to), Date.now());
  if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end)
    throw new Error('Choose a valid observation window, from before to.');
  const byOwner = new Map<string, FunnelEvent[]>();
  for (const event of events) {
    const time = Date.parse(event.occurred_at);
    if (!Number.isFinite(time) || time >= end) continue;
    const list = byOwner.get(event.owner_id) ?? [];
    list.push(event);
    byOwner.set(event.owner_id, list);
  }
  const groups = new Map<
    string,
    {
      source: string;
      medium: string | null;
      campaign: string | null;
      owners: number;
      firstSaved: number;
      activated: number;
      importActivated: number;
      retentionEligible: number;
      returned: number;
      upgraded: number;
      checkout: number;
      paid: number;
      observedPaid: number;
      renewalEligible: number;
      renewed: number;
      cancellations: number;
    }
  >();
  for (const account of accounts) {
    const seen = Date.parse(account.owner_seen_at ?? '');
    if (!Number.isFinite(seen) || seen < start || seen >= end) continue;
    const source = sanitizeAttribution(account);
    const key = JSON.stringify(source);
    const group = groups.get(key) ?? {
      ...source,
      source: source.source ?? 'unknown',
      owners: 0,
      firstSaved: 0,
      activated: 0,
      importActivated: 0,
      retentionEligible: 0,
      returned: 0,
      upgraded: 0,
      checkout: 0,
      paid: 0,
      observedPaid: 0,
      renewalEligible: 0,
      renewed: 0,
      cancellations: 0,
    };
    group.owners++;
    const list = (byOwner.get(account.account_id) ?? []).sort(
      (a, b) => Date.parse(a.occurred_at) - Date.parse(b.occurred_at),
    );
    const after = (name: string, minimum: number) =>
      list.find((e) => e.name === name && Date.parse(e.occurred_at) >= minimum);
    const first = after('first_save', seen);
    if (first) group.firstSaved++;
    const activated = first && after('activated', Date.parse(first.occurred_at));
    if (activated) {
      group.activated++;
      if (activated.origin === 'import') group.importActivated++;
      const day = activated.occurred_at.slice(0, 10);
      if (day < new Date(end - 1).toISOString().slice(0, 10)) {
        group.retentionEligible++;
        if (
          list.some(
            (e) =>
              e.name === 'app_open' &&
              e.actor_id === account.account_id &&
              e.occurred_at.slice(0, 10) > day &&
              Date.parse(e.occurred_at) > Date.parse(activated.occurred_at),
          )
        )
          group.returned++;
      }
    }
    const upgrade = activated && after('upgrade_viewed', Date.parse(activated.occurred_at));
    if (upgrade) group.upgraded++;
    const checkout = upgrade && after('checkout_created', Date.parse(upgrade.occurred_at));
    if (checkout) group.checkout++;
    if (checkout && after('first_paid', Date.parse(checkout.occurred_at))) group.paid++;
    if (after('first_paid', seen)) group.observedPaid++;
    const paid = list.filter((e) => e.name === 'first_paid' || e.name === 'paid_invoice' || e.name === 'renewed');
    const eligible = paid.filter(
      (e) => e.subscription_id && e.period_end && Date.parse(e.period_end) >= start && Date.parse(e.period_end) < end,
    );
    if (eligible.length) group.renewalEligible++;
    if (
      eligible.some((previous) =>
        paid.some(
          (next) =>
            next.name === 'renewed' &&
            next.subscription_id === previous.subscription_id &&
            next.period_start === previous.period_end,
        ),
      )
    )
      group.renewed++;
    if (
      list.some((e) => (e.name === 'cancel_scheduled' || e.name === 'cancelled') && Date.parse(e.occurred_at) >= start)
    )
      group.cancellations++;
    groups.set(key, group);
  }
  return {
    from: new Date(start).toISOString(),
    toExclusive: new Date(end).toISOString(),
    groups: [...groups.values()].map((group) => ({
      ...group,
      activationRate: group.owners ? group.activated / group.owners : null,
      laterDayReturnRate: group.retentionEligible ? group.returned / group.retentionEligible : null,
      orderedPaidRate: group.owners ? group.paid / group.owners : null,
      renewalRate: group.renewalEligible ? group.renewed / group.renewalEligible : null,
    })),
    coverage:
      'Observed best-effort events only. Missing events and disabled/configuration periods undercount conversion. Owner return excludes partner opens. Cohort entry is first owner observation. Unknown attribution is retained. Granular history is limited to 90 days; durable milestones remain. Stripe is revenue truth.',
  };
}
