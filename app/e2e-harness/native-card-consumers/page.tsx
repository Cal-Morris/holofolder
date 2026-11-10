import { Suspense } from "react"
import { headers } from "next/headers"
import { notFound } from "next/navigation"
import NativeCardConsumersHarness from "@/components/native-card-consumers-harness"
import { canShowInventoryHarness } from "@/lib/inventory-harness-gate"

async function LocalConsumerHarness() {
  if (!canShowInventoryHarness(process.env.HOLOFOLDER_E2E, Boolean(process.env.VERCEL || process.env.VERCEL_ENV), (await headers()).get("host"))) notFound()
  return <NativeCardConsumersHarness />
}
export default function ConsumerHarnessPage() {
  if (process.env.HOLOFOLDER_E2E !== "1" || process.env.VERCEL || process.env.VERCEL_ENV) notFound()
  return <Suspense fallback={null}><LocalConsumerHarness /></Suspense>
}
