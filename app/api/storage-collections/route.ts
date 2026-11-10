/** #379 owns admission together with native bootstrap and supported API consumers. */
export async function POST() {
  return Response.json({ error: "storage_operations_staged" }, { status: 503, headers: { "Cache-Control": "private, no-store" } })
}
