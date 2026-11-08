import { requireDeveloperSettingsUser } from '@/lib/server/developer-access/first-party'
import { readDeveloperJson, developerErrorResponse, DEVELOPER_HEADERS } from '@/lib/server/developer-access/request'
import { DeveloperAccessError } from '@/lib/developer-api/permissions'
import { DEVELOPER_OPERATIONS } from '@/lib/developer-api/operations'
import { changeDeveloperPartner } from '@/lib/server/operations/partners'
const names = { invite: 'invite_partner', accept: 'accept_partner_invite', reject: 'reject_partner_invite', disconnect: 'disconnect_partner' } as const
export async function POST(request: Request) {
  const requestId = crypto.randomUUID()
  try {
    const { user } = await requireDeveloperSettingsUser(request, true)
    const { action, ...input } = await readDeveloperJson(request)
    if (typeof action !== 'string' || !Object.hasOwn(names, action)) throw new DeveloperAccessError('invalid_action', 'Choose a valid partner action.', 400)
    const kind = action as keyof typeof names
    const operation = DEVELOPER_OPERATIONS.find(op => op.name === names[kind])!
    const parsed = operation.schema.safeParse(input)
    if (!parsed.success) throw new DeveloperAccessError('invalid_input', 'Check the email or invitation identifier.', 400)
    return Response.json(await changeDeveloperPartner(user.id, kind, parsed.data), { headers: DEVELOPER_HEADERS })
  } catch (error) { return developerErrorResponse(error, requestId) }
}
