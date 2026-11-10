import 'server-only'
import { randomUUID } from 'node:crypto'
import { isContractRecord, isSlotContractId } from '@/lib/domain/binder-slots'
import { RawRestoreEnvelopeError, parseRawRestoreCommand, isRawRestoreRejection } from '@/lib/domain/raw-restore'
import { prepareAppRawContentRestore, confirmAppRawContentRestore, deliverAppRawContentRestore } from '@/lib/server/operations/raw-restore'
import { requireAppearanceOrigin } from '@/lib/server/binder-appearance'
import { readDeveloperJson, developerErrorResponse } from '@/lib/server/developer-access/request'
import { StorageRestoreRejectedError } from '@/lib/server/developer-access/storage-command-error'
import { DeveloperAccessError } from '@/lib/developer-api/permissions'
import type { executeAppStorageRequest } from '@/lib/server/operations/storage-execution'

const privateHeaders = { 'Cache-Control': 'private, no-store', Vary: 'Cookie', 'X-Content-Type-Options': 'nosniff' }
/** First-party bounded raw restore boundary. */
export async function handleRawRestore(request: Request, clients?: Parameters<typeof executeAppStorageRequest>[2]) {
  const requestId = randomUUID(), headers = new Headers(privateHeaders)
  try {
    if (request.method !== 'POST') throw new DeveloperAccessError('invalid_input', 'POST required.', 405)
    if (!request.headers.get('origin')) throw new DeveloperAccessError('storage_origin_denied', 'Use the current app origin.', 403)
    requireAppearanceOrigin(request)
    const operationId = request.headers.get('X-Storage-Operation'), delivery = request.headers.get('X-Storage-Delivery')
    if (!isSlotContractId(operationId) || !isSlotContractId(delivery) || !request.headers.get('content-type')?.startsWith('application/json')) {
      throw new DeveloperAccessError('invalid_input', 'Provide the original request identity.', 400)
    }
    headers.set('X-Storage-Operation', operationId); headers.set('X-Storage-Delivery', delivery); headers.set('X-Storage-Family', 'backup.restore.raw')
    const input = await readDeveloperJson(request, 12582912)
    if (input.action === 'plan') {
      if (!isContractRecord(input, ['action', 'text', 'choices', 'operationId']) || Object.keys(input).length !== 4 || typeof input.text !== 'string'
        || input.operationId !== operationId || !isContractRecord(input.choices, ['collectionId', 'slotIds', 'releaseItemIds', 'restoreContent'])
        || Object.keys(input.choices).length !== 4 || input.choices.restoreContent !== true || !isSlotContractId(input.choices.collectionId)
        || !Array.isArray(input.choices.slotIds) || !input.choices.slotIds.every(isSlotContractId)
        || !Array.isArray(input.choices.releaseItemIds) || !input.choices.releaseItemIds.every(isSlotContractId)) throw new DeveloperAccessError('invalid_input', 'Review explicit restore choices.', 400)
      const plan = await prepareAppRawContentRestore(request, { text: input.text, operationId,
        choices: input.choices as { collectionId: string; slotIds: string[]; releaseItemIds: string[]; restoreContent: true } }, clients)
      // Reauthenticate and re-read initial confirmation, without delivering before browser durability.
      await confirmAppRawContentRestore(request, plan, clients, true)
      return Response.json({ version: 1, operationId, request: plan.request }, { headers })
    }
    if (input.version !== 1 && input.version !== 2 && input.version !== 3) throw new DeveloperAccessError('invalid_input', 'Supported raw restore command versions are 1, 2 and 3. Preserve existing device records.', 400)
    const command = parseRawRestoreCommand(input)
    if (command.operationId !== operationId) throw new DeveloperAccessError('invalid_input', 'Operation identity changed.', 400)
    // Original delivery reaches the lifetime ledger before any mutable reconstruction.
    const result = await deliverAppRawContentRestore(new Request(request.url, { method: 'POST', headers: request.headers, body: JSON.stringify(command) }), { request: command, scope: command.planning }, clients)
    if (isRawRestoreRejection(result, operationId)) throw new StorageRestoreRejectedError(result)
    return Response.json({ version: 1, operationId, receipt: result }, { headers })
  } catch (error) {
    const response = developerErrorResponse(error instanceof RawRestoreEnvelopeError ? new DeveloperAccessError('invalid_input', error.message, 400) : error, requestId)
    headers.forEach((value, key) => response.headers.set(key, value))
    return response
  }
}
