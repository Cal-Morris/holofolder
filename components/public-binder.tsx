'use client'

import { useMemo } from 'react'
import BinderApp from '@/components/binder-app'
import { getDefaultBinderSettings } from '@/lib/settings'
import { publicBinderDisplayInput, publicReadIndex } from '@/lib/public-binder-display'
import type { PublicBinder } from '@/lib/public-binder'

/**
 * Share links open the normal binder in its read-only state. Input is only the public projection:
 * no viewer session, owner ID, collection queue or account settings are mounted or fetched.
 */
export default function PublicBinderView({ binder, sharePath }: { binder: PublicBinder; sharePath: string }) {
  const display = useMemo(() => publicBinderDisplayInput(binder), [binder])
  const index = useMemo(() => publicReadIndex(binder, display), [binder, display])
  const settings = useMemo(() => ({
    ...getDefaultBinderSettings(), binderRows: binder.rows, binderCols: binder.cols, darkMode: binder.appearance.dark,
    binderColorId: binder.appearance.color, binderPageColors: binder.appearance.pageColors, binderSlotGlareEnabled: binder.appearance.glare,
  }), [binder])
  return <BinderApp initialUser={null} initialCollection={[]} initialCollectionOwnerUserId={null} initialBinders={[]} initialBinderId={null}
    initialSettings={settings} initialHasStoredSettings initialDarkMode={binder.appearance.dark}
    readOnlyMode stagedSlotDisplay={display} publicIndex={index} initialSharePath={sharePath}
    // Saved estimates come from the payload; no live price lookup from a share (Prices view follow-up: #542).
    pricingEnabled={false} initialPriceMode={false} />
}
