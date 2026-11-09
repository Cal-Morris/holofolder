import { notFound } from "next/navigation"
import ScanDestinationHarness from "@/components/scan-destination-harness"

export default function ScanDestinationHarnessPage() {
  if (process.env.HOLOFOLDER_E2E !== "1") notFound()
  return <ScanDestinationHarness />
}
