import { canShowInventoryHarness } from "@/lib/inventory-harness-gate"
import { handleInventoryCompleteRead } from "@/lib/server/inventory-read-http"
import { handleStorageCommand } from "@/lib/server/storage-command-http"

async function handle(request: Request, context: { params: Promise<{ kind: string }> }) {
  const denied = () => Response.json({ error: "storage_operations_staged" }, { status: 503, headers: { "Cache-Control": "private, no-store" } })
  if (!canShowInventoryHarness(process.env.HOLOFOLDER_E2E, Boolean(process.env.VERCEL || process.env.VERCEL_ENV), new URL(request.url).host)) return denied()
  const { kind } = await context.params
  const id = request.headers.get("cookie")?.match(/(?:^|;\s*)hf-storage-fixture=([a-zA-Z0-9-]{8,100})(?:;|$)/)?.[1]
  if (!id || !["inventory", "slots", "recovery", "creation", "raw-restore"].includes(kind)) return denied()
  const { storageCommandHarness } = await import("@/tests/fixtures/storage-command-harness")
  const { client } = storageCommandHarness(id)
  if (kind === 'raw-restore') {
    const { handleRawRestore } = await import('@/lib/server/raw-restore-http')
    return handleRawRestore(request, { session: client, admin: client })
  }
  if (kind === "recovery") {
    const { handleNativeRecovery } = await import("@/lib/server/native-recovery-http")
    return handleNativeRecovery(request, { session: client, admin: client })
  }
  if (request.method === "GET" && kind === "inventory") return handleInventoryCompleteRead(request, client)
  return handleStorageCommand(request, kind === "creation" ? "collection.create" : kind as "inventory" | "slots", { session: client, admin: client })
}
export const GET = handle
export const POST = handle
