import { Suspense } from "react"
import { headers } from "next/headers"
import { notFound } from "next/navigation"
import ScanDestinationHarness from "@/components/scan-destination-harness"
import { canShowInventoryHarness } from "@/lib/inventory-harness-gate"

async function LocalScanDestinationHarness() {
  if (!canShowInventoryHarness(process.env.HOLOFOLDER_E2E, Boolean(process.env.VERCEL || process.env.VERCEL_ENV), (await headers()).get("host"))) notFound()
  return <ScanDestinationHarness />
}
export default function ScanDestinationHarnessPage() {
  if (process.env.HOLOFOLDER_E2E !== "1" || process.env.VERCEL || process.env.VERCEL_ENV) notFound()
  return <Suspense fallback={null}><LocalScanDestinationHarness /></Suspense>
}
