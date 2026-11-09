import { inventoryStagingResponse } from "@/lib/server/operations/inventory"

// No body, environment flag or authenticated role can open the staged store.
export const GET = inventoryStagingResponse
export const POST = inventoryStagingResponse
export const PATCH = inventoryStagingResponse
export const DELETE = inventoryStagingResponse
