import { BILLING_LIFETIME_PRICE, BILLING_PRICES, billingAmount } from '@/lib/billing';

const HOUR = 60 * 60 * 1000;
/** Trials ending 40 to 64 hours from the daily run, so every owner falls in exactly one run, around day 5. */
export const TRIAL_EMAIL_WINDOW_HOURS = { start: 40, end: 64 } as const;

/** One row of `trial_ending_email_candidates_v1` (migration 135). */
export interface TrialEmailCandidate {
  owner_user_id: string;
  email: string | null;
  trial_ends_at: string;
  email_confirmed: boolean;
  partner_member: boolean;
  lifetime: boolean;
  paid_through: string | null;
  granted_until: string | null;
  already_emailed: boolean;
}

export interface TrialEmailRecipient {
  ownerUserId: string;
  email: string;
  trialEndsAt: Date;
}

export function trialEmailWindow(now: Date) {
  return {
    start: new Date(now.getTime() + TRIAL_EMAIL_WINDOW_HOURS.start * HOUR),
    end: new Date(now.getTime() + TRIAL_EMAIL_WINDOW_HOURS.end * HOUR),
  };
}

const coversTrialEnd = (until: string | null, trialEnd: number) => until !== null && Date.parse(until) > trialEnd;

/**
 * Owners who will actually drop to the free plan when their trial ends: confirmed email, not a partner
 * member (partners follow the owner's plan), no lifetime, no paid time or invite grant past the trial
 * end, and not emailed before.
 */
export function selectTrialEmailRecipients(rows: TrialEmailCandidate[], now: Date): TrialEmailRecipient[] {
  const window = trialEmailWindow(now);
  return rows.flatMap((row) => {
    const trialEnd = Date.parse(row.trial_ends_at);
    const email = row.email?.trim();
    if (!email || !email.includes('@') || !row.email_confirmed) return [];
    if (row.partner_member || row.lifetime || row.already_emailed) return [];
    if (!(trialEnd >= window.start.getTime() && trialEnd < window.end.getTime())) return [];
    if (coversTrialEnd(row.paid_through, trialEnd) || coversTrialEnd(row.granted_until, trialEnd)) return [];
    return [{ ownerUserId: row.owner_user_id, email, trialEndsAt: new Date(trialEnd) }];
  });
}

const trialEndFormat = new Intl.DateTimeFormat('en-GB', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  hour: 'numeric',
  minute: '2-digit',
  timeZone: 'Europe/London',
});
const formatTrialEnd = (date: Date) => trialEndFormat.format(date);

export function buildTrialEndingEmail(input: { trialEndsAt: Date; appUrl: string; lifetimeOffered: boolean }) {
  const when = formatTrialEnd(input.trialEndsAt);
  const plans = [
    `${billingAmount(BILLING_PRICES.month)} a month`,
    `${billingAmount(BILLING_PRICES.year)} a year`,
    ...(input.lifetimeOffered ? [`${billingAmount(BILLING_LIFETIME_PRICE)} once for lifetime access`] : []),
  ];
  const text = `Hi,

Your free Premium trial on Holo Folder ends on ${when} (UK time). Nothing is deleted when it ends, and you don't need to do anything to stay on the free plan.

What you keep for free
Your binders, every card and wanted entry you've saved, the wanted list, a read-only share link, card and page scanning, offline use and one current price per card, including the basic Show mode price lookup.

What Premium adds, and what you'll lose when the trial ends
Creating more than four binders, custom page sizes, Partner mode, multi-source price comparison, price history and trend charts, Rising and Breakout highlights, the Analytics view, eBay listings and sold comps, bundle pricing, Show mode deal verdicts and purchase tally, and the developer API and MCP server.

Keeping Premium
Premium is ${plans.slice(0, -1).join(', ')} or ${plans.at(-1)}. You can choose a plan in Settings, under Plan:
${input.appUrl}

You can also invite a friend from the same page. When they make an account through your link and save 10 cards, you both get a month of Premium free.

Thanks for trying Holo Folder.

--
This is a one-off service email about your Holo Folder account, sent because your Premium trial is ending. We won't send another about it. Holo Folder, https://holofolder.com
`;
  return { subject: `Your Holo Folder Premium trial ends on ${when.split(' at ')[0]}`, text };
}

/** Sends one plain-text email through Resend's REST API. The idempotency key stops a retried run sending twice. */
export async function sendResendEmail(input: {
  apiKey: string;
  from: string;
  to: string;
  subject: string;
  text: string;
  idempotencyKey: string;
}) {
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${input.apiKey}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': input.idempotencyKey,
    },
    body: JSON.stringify({ from: input.from, to: [input.to], subject: input.subject, text: input.text }),
  });
  const body = (await response.json().catch(() => null)) as { id?: string; message?: string } | null;
  if (!response.ok || !body?.id) throw new Error(`Resend ${response.status}: ${body?.message ?? 'no message id'}`);
  return body.id;
}
