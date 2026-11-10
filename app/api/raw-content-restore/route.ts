/** #379 owns admission. No environment variable or request can enable native restore. */
export async function POST() {
  return Response.json({ error: 'storage_operations_staged' }, { status: 503, headers: { 'Cache-Control': 'private, no-store' } })
}
