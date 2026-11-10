import { handleRawRestore } from "@/lib/server/raw-restore-http"

export async function POST(request: Request) {
  return handleRawRestore(request)
}
