import { slotStagingResponse } from "@/lib/server/operations/binder-slots"

// Neither reads nor writes expose the staged store. No auth/body metadata can enable it.
export const GET = slotStagingResponse
export const POST = slotStagingResponse
export const PATCH = slotStagingResponse
export const DELETE = slotStagingResponse
