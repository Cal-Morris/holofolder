import "server-only"
import { isStorageCommandRejection } from "@/lib/collection/storage-command-rejection"
import { randomUUID } from "node:crypto"
import { isSlotContractId } from "@/lib/domain/binder-slots"
import { DeveloperAccessError } from "@/lib/developer-api/permissions"
import { requireAppearanceOrigin } from "@/lib/server/binder-appearance"
import { developerErrorResponse } from "@/lib/server/developer-access/request"
import { executeAppStorageRequest } from "@/lib/server/operations/storage-execution"

const headers = { "Cache-Control": "private, no-store", Vary: "Cookie", "X-Content-Type-Options": "nosniff" }
/** Internal handler only. Public production routes retain their unconditional staging response.
 * localClients is trusted server injection, never HTTP input or a production admission flag. */
export async function handleStorageCommand(request: Request, operation: "slots" | "inventory" | "collection.create",
  localClients?: Parameters<typeof executeAppStorageRequest>[2]): Promise<Response> {
  const requestId = randomUUID()
  try {
    if (request.method !== "POST") return Response.json({ error: "storage_method" }, { status: 405, headers })
    const origin = request.headers.get("origin")
    if (!origin) {
      throw new DeveloperAccessError("storage_origin_denied", "Use the current app origin.", 403)
    }
    requireAppearanceOrigin(request)
    const operationId = request.headers.get("X-Storage-Operation"), authSessionId = request.headers.get("X-Binder-Auth-Session")
    if (!isSlotContractId(operationId) || !isSlotContractId(authSessionId)
      || !request.headers.get("content-type")?.startsWith("application/json")) {
      throw new DeveloperAccessError("invalid_input", "Provide the command and current session fences.", 400)
    }
    // The bridge parses the original body and establishes actor/source/membership/billing.
    // Compare the header to the same bounded body without accepting any caller audit context.
    const { readDeveloperJson } = await import("@/lib/server/developer-access/request")
    const input = await readDeveloperJson(request, operation === "inventory" ? 8388608 : operation === "collection.create" ? 2097152 : 1048576)
    if (input.operationId !== operationId) throw new DeveloperAccessError("invalid_input", "Operation identity does not match.", 400)
    const forwarded = new Request(request.url, { method: "POST", headers: request.headers, body: JSON.stringify(input) })
    const receipt = await executeAppStorageRequest(forwarded, operation, localClients)
    if (isStorageCommandRejection(receipt, operationId)) return Response.json({ version: 1, operationId, rejection: receipt }, { status: 409, headers })
    return Response.json({ version: 1, operationId, receipt }, { headers })
  } catch (error) {
    const response = developerErrorResponse(error, requestId)
    for (const [key, value] of Object.entries(headers)) response.headers.set(key, value)
    return response
  }
}
