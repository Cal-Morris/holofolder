import { handleStorageCommand } from "@/lib/server/storage-command-http"

export async function POST(request: Request) {
  return handleStorageCommand(request, "collection.create")
}
