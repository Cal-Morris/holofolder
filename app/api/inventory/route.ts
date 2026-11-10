import { handleStorageCommand } from "@/lib/server/storage-command-http"
import { handleInventoryCompleteRead } from "@/lib/server/inventory-read-http"

export async function GET(request: Request) {
  return handleInventoryCompleteRead(request)
}

export async function POST(request: Request) {
  return handleStorageCommand(request, "inventory")
}
