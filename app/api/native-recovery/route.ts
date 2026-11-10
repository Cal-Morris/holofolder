/** Public admission stays closed; no environment flag or caller can select the internal bridge. */
export async function POST() {
  return Response.json({error:'native_operations_staged'},{status:503,headers:{'Cache-Control':'private, no-store'}})
}
