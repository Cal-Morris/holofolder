import { timingSafeEqual } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  buildTrialEndingEmail,
  selectTrialEmailRecipients,
  sendResendEmail,
  trialEmailWindow,
  type TrialEmailCandidate,
  type TrialEmailRecipient,
} from '@/lib/trial-ending-email';

const APP_URL = 'https://holofolder.com/app';
const DEFAULT_FROM = 'Holo Folder <hello@mail.holofolder.com>';

type Admin = ReturnType<typeof createAdminClient>;
type Mail = { apiKey: string; from: string; lifetimeOffered: boolean };

function isCronRequest(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const actual = Buffer.from(request.headers.get('authorization') ?? '');
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

/** Claims the owner's row first so they are emailed once; a failed send releases the claim for a later run. */
async function emailRecipient(admin: Admin, mail: Mail, recipient: TrialEmailRecipient) {
  const { data: claimed, error } = await admin
    .from('trial_ending_emails')
    .upsert(
      { owner_user_id: recipient.ownerUserId, trial_ends_at: recipient.trialEndsAt.toISOString() },
      { onConflict: 'owner_user_id', ignoreDuplicates: true },
    )
    .select('owner_user_id');
  if (error || !claimed?.length) return 'skipped';

  try {
    const email = buildTrialEndingEmail({
      trialEndsAt: recipient.trialEndsAt,
      appUrl: APP_URL,
      lifetimeOffered: mail.lifetimeOffered,
    });
    const messageId = await sendResendEmail({
      apiKey: mail.apiKey,
      from: mail.from,
      to: recipient.email,
      ...email,
      idempotencyKey: `trial-ending/${recipient.ownerUserId}`,
    });
    await admin
      .from('trial_ending_emails')
      .update({ message_id: messageId })
      .eq('owner_user_id', recipient.ownerUserId);
    return 'sent';
  } catch (sendError) {
    // Resend's idempotency key still blocks a duplicate if the send did go out.
    await admin.from('trial_ending_emails').delete().eq('owner_user_id', recipient.ownerUserId);
    console.error('[holofolder] Trial email send failed:', sendError instanceof Error ? sendError.message : sendError);
    return 'failed';
  }
}

async function sendTrialEmails(admin: Admin, mail: Mail, now: Date, testTo: string | undefined) {
  const window = trialEmailWindow(now);
  const { data, error } = await admin.rpc('trial_ending_email_candidates_v1', {
    window_start: window.start.toISOString(),
    window_end: window.end.toISOString(),
  });
  if (error) {
    console.error('[holofolder] Trial email candidates failed:', error.message);
    return NextResponse.json({ error: 'Trial email candidates unavailable' }, { status: 503 });
  }
  const recipients = selectTrialEmailRecipients((data ?? []) as TrialEmailCandidate[], now);

  if (testTo) {
    const email = buildTrialEndingEmail({
      trialEndsAt: recipients[0]?.trialEndsAt ?? window.start,
      appUrl: APP_URL,
      lifetimeOffered: mail.lifetimeOffered,
    });
    const messageId = await sendResendEmail({
      apiKey: mail.apiKey,
      from: mail.from,
      to: testTo,
      ...email,
      idempotencyKey: `trial-ending-test/${now.toISOString()}`,
    });
    return NextResponse.json({ status: 'test', eligible: recipients.length, messageId });
  }

  const results: string[] = [];
  for (const recipient of recipients) {
    // One at a time on purpose: Resend rate-limits requests per second.
    // eslint-disable-next-line react-doctor/async-await-in-loop
    results.push(await emailRecipient(admin, mail, recipient));
  }
  const count = (result: string) => results.filter((value) => value === result).length;
  return NextResponse.json({
    status: 'done',
    eligible: recipients.length,
    sent: count('sent'),
    failed: count('failed'),
  });
}

/**
 * Daily cron (vercel.json): emails owners whose Premium trial ends in 40 to 64 hours, once each.
 * Vercel cron calls GET; the CRON_SECRET bearer check is the guard. With TRIAL_EMAIL_TEST_TO set, it sends
 * one sample to that address only and records nothing.
 */
export async function GET(request: NextRequest) {
  if (!isCronRequest(request)) return NextResponse.json({ error: 'Not authorized' }, { status: 401 });
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return NextResponse.json({ status: 'skipped', reason: 'RESEND_API_KEY is not set' });

  const mail = {
    apiKey,
    from: process.env.TRIAL_EMAIL_FROM || DEFAULT_FROM,
    lifetimeOffered: Boolean(process.env.STRIPE_LIFETIME_PRICE_ID),
  };
  return sendTrialEmails(createAdminClient(), mail, new Date(), process.env.TRIAL_EMAIL_TEST_TO?.trim() || undefined);
}
