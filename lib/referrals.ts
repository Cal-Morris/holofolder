import { createHmac, timingSafeEqual } from 'node:crypto';

/** Invite rewards (migration 133): both sides get this many days when the invitee reaches activation. */
export const REFERRAL_REWARD_DAYS = 30;
/** Rewarded invites an inviter can earn, ever (12 months of granted time). */
export const REFERRAL_INVITER_CAP = 12;
/** Saved entries that count as activation, the funnel's activation milestone. */
export const REFERRAL_ACTIVATION_ENTRIES = 10;
export const INVITE_COOKIE = 'hf_invite';
/** How long a click stays claimable. The database also requires the account to be under 7 days old. */
export const INVITE_COOKIE_MAX_AGE = 30 * 24 * 60 * 60;

// The random referral code (`[a-z2-9]{10}`, migration 133) or a username (047), which paid affiliates share (146).
const CODE = /^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$/;
export const isInviteCode = (value: unknown): value is string => typeof value === 'string' && CODE.test(value);
export const inviteUrl = (code: string) => `https://holofolder.com/app/invite/${code}`;

const sign = (secret: string, body: string) =>
  createHmac('sha256', secret).update(`invite-v1.${body}`).digest('base64url');

/** `code.clickedAtMs.signature`: the click time is the server's, so "signed up after clicking" can be trusted. */
export function signInviteCookie(secret: string, code: string, clickedAt = Date.now()) {
  const body = `${code}.${clickedAt}`;
  return `${body}.${sign(secret, body)}`;
}

export function readInviteCookie(secret: string, value: string | undefined, now = Date.now()) {
  const [code, at, signature, ...rest] = (value ?? '').split('.');
  const clickedAt = Number(at);
  if (rest.length || !isInviteCode(code) || !Number.isSafeInteger(clickedAt) || !signature) return null;
  const expected = Buffer.from(sign(secret, `${code}.${at}`));
  const actual = Buffer.from(signature);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
  if (clickedAt > now + 60_000 || now - clickedAt > INVITE_COOKIE_MAX_AGE * 1000) return null;
  return { code, clickedAt: new Date(clickedAt).toISOString() };
}
