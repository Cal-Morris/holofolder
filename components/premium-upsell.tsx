'use client';

import { useBillingContext } from '@/hooks/use-billing';
import { Button } from '@/components/ui/button';
import { hasPremiumFeatures } from '@/lib/billing';

/** True unless loaded billing says this owner is on the free plan (see hasPremiumFeatures). */
export function usePremium() {
  return hasPremiumFeatures(useBillingContext()?.access ?? null);
}

/** The inline "included with Premium" card that stands in for a Premium feature. */
export function PremiumUpsell({ label, message, action }: { label: string; message: string; action: string }) {
  const billing = useBillingContext();
  return (
    <section aria-label={label} className="mt-2 rounded-xl border p-3">
      <p className="text-sm">{message}</p>
      <Button className="mt-2 min-h-11 w-full" onClick={billing?.upgrade}>
        {action}
      </Button>
    </section>
  );
}
