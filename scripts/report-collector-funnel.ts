// Operator only. Read-only unless an explicit cleanup/backfill flag is supplied.
import { createAdminClient } from '../lib/supabase/admin';
import { fetchAllRows } from '../lib/supabase/fetch-all-rows';
import { funnelReport, type FunnelAccount, type FunnelEvent } from '../lib/collector-funnel';

async function main() {
  const args = process.argv.slice(2);
  const option = (name: string, fallback: string) =>
    args.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
  const to = option('to', new Date().toISOString());
  const from = option('from', new Date(Date.now() - 90 * 86400000).toISOString());
  // Validate dates before any explicit mutation.
  funnelReport([], [], from, to);
  const limit = Number(option('limit', '100'));
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) throw new Error('Limit must be between 1 and 500.');
  const admin = createAdminClient();
  const operations: Record<string, unknown> = {};
  if (args.includes('--backfill-paid')) {
    if (limit > 100) throw new Error('Paid backfill is limited to 100 owners per invocation.');
    if (process.env.HOLOFOLDER_FUNNEL_ENABLED !== 'true' || process.env.VERCEL_ENV !== 'production')
      throw new Error('Paid backfill requires the published privacy notice and explicit production funnel enablement.');
    const { recordCollectorPayments } = await import('../lib/server/collector-payments');
    const cursor = option('after-owner', '');
    if (cursor && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(cursor))
      throw new Error('Invalid backfill owner cursor.');
    let query = admin
      .from('billing_accounts')
      .select('owner_user_id,stripe_customer_id')
      .not('stripe_customer_id', 'is', null)
      .order('owner_user_id')
      .limit(limit);
    if (cursor) query = query.gt('owner_user_id', cursor);
    const { data, error } = await query;
    if (error) throw new Error('Billing accounts could not be read.');
    let owners = 0,
      invoices = 0,
      skipped = 0;
    for (const account of data ?? []) {
      try {
        const result = await recordCollectorPayments(account.owner_user_id, account.stripe_customer_id);
        owners++;
        invoices += result.observed;
        if (result.reason) skipped++;
      } catch {
        skipped++;
      }
    }
    operations.backfill = {
      owners,
      verifiedInvoiceObservations: invoices,
      skipped,
      bound: limit,
      nextOwnerCursor: data?.length === limit ? data[data.length - 1].owner_user_id : null,
      note: 'Idempotent reads of at most 500 invoices and subscriptions per owner. Continue with --after-owner=<nextOwnerCursor>. No activation backfill, payment or subscription changes.',
    };
  }
  if (args.includes('--cleanup')) {
    const cutoff = new Date(Date.now() - 90 * 86400000).toISOString();
    const { data, error } = await admin
      .from('collector_events')
      .select('id')
      .not('name', 'in', '(first_save,activated,first_paid)')
      .lt('occurred_at', cutoff)
      .order('occurred_at')
      .order('id')
      .limit(limit);
    if (error) throw new Error('Expired events could not be selected.');
    const ids = (data ?? []).map((row) => row.id);
    if (ids.length) {
      const removed = await admin
        .from('collector_events')
        .delete()
        .in('id', ids)
        .not('name', 'in', '(first_save,activated,first_paid)')
        .lt('occurred_at', cutoff);
      if (removed.error) throw new Error('Expired events could not be removed.');
    }
    operations.cleanup = { removed: ids.length, limit, cutoff, durableMilestonesRetained: true };
  }
  const accounts = await fetchAllRows<FunnelAccount>((start, end) =>
    admin
      .from('collector_accounts')
      .select('account_id,first_seen_at,owner_seen_at,source,medium,campaign')
      .order('account_id')
      .range(start, end),
  );
  const events = await fetchAllRows<FunnelEvent>((start, end) =>
    admin
      .from('collector_events')
      .select('owner_id,actor_id,name,occurred_at,event_key,origin,subscription_id,period_start,period_end')
      .lt('occurred_at', to)
      .order('id')
      .range(start, end),
  );
  if (accounts.error || events.error)
    throw new Error('Funnel data could not be read. Check migration 054 and operator access.');
  console.log(
    JSON.stringify(
      {
        ...funnelReport(accounts.data, events.data, from, to),
        operations,
        firstObservedEvent: events.data.reduce<string | null>(
          (first, event) => (!first || event.occurred_at < first ? event.occurred_at : first),
          null,
        ),
        gaps: 'Enablement/deployment periods are not automatically reconstructed. Confirm deployment history and configuration; absent events are not proof that no action occurred.',
      },
      null,
      2,
    ),
  );
}
void main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'Collector report failed.');
  process.exitCode = 1;
});
