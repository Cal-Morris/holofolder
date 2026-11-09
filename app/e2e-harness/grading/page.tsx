import { Suspense } from "react"
import { headers } from "next/headers"
import { notFound } from "next/navigation"
import GradingHarness from "@/components/grading/grading-harness"
import { canShowInventoryHarness } from "@/lib/inventory-harness-gate"

async function LocalGradingHarness() {
  if (!canShowInventoryHarness(process.env.HOLOFOLDER_E2E, Boolean(process.env.VERCEL || process.env.VERCEL_ENV), (await headers()).get("host"))) notFound()
  return <GradingHarness />
}
export default function GradingHarnessPage() {
  if (process.env.HOLOFOLDER_E2E !== "1" || process.env.VERCEL || process.env.VERCEL_ENV) notFound()
  return <Suspense fallback={null}><LocalGradingHarness /></Suspense>
}
