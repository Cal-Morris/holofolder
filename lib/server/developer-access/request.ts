import {
  StorageRestoreRejectedError,
  StorageCreationRejectedError,
  StorageImportRejectedError,
  StorageRecoveryRejectedError,
  StorageCommandRejectedError,
} from './storage-command-error';
import {
  rawRestoreErrorSchema,
  creationErrorSchema,
  importErrorSchema,
  recoveryErrorSchema,
  storageCommandErrorSchema,
} from '@/lib/developer-api/storage';
import { BinderAccessError } from '@/lib/server/binders';
import { BillingAccessError } from '@/lib/billing';
import { AppearanceError } from '@/lib/server/binder-appearance';
import { DeveloperAccessError } from '@/lib/developer-api/permissions';
export const DEVELOPER_HEADERS = { 'Cache-Control': 'private, no-store' };
export function bearerCredential(request: Request): string | null {
  const value = request.headers.get('authorization');
  return value && /^Bearer [A-Za-z0-9._~-]+$/i.test(value) ? value.slice(7) : null;
}
export async function readDeveloperJson(
  request: Request,
  maxBytes = 65536,
  measureBytes?: (size: number) => void,
): Promise<Record<string, unknown>> {
  const reader = request.body?.getReader();
  if (!reader) throw new DeveloperAccessError('invalid_json', 'Provide a valid JSON object.', 400);
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      // oxlint-disable-next-line react-doctor/async-await-in-loop -- a stream is read one chunk at a time
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw new DeveloperAccessError('body_too_large', `Request bodies must be at most ${maxBytes / 1024} KiB.`, 413);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  measureBytes?.(size);
  try {
    const body: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error();
    return body as Record<string, unknown>;
  } catch {
    throw new DeveloperAccessError('invalid_json', 'Provide a valid JSON object.', 400);
  }
}
export function knownDeveloperError(error: unknown): DeveloperAccessError | null {
  if (error instanceof DeveloperAccessError) return error;
  if (error instanceof BinderAccessError) return new DeveloperAccessError('not_found', 'Binder not found.', 404);
  if (error instanceof AppearanceError)
    return new DeveloperAccessError(error.code ?? 'invalid_appearance', error.message, error.status);
  if (error instanceof BillingAccessError) return new DeveloperAccessError(error.code, error.message, 402);
  return null;
}
export function developerErrorPayload(error: unknown, requestId: string) {
  const safe = knownDeveloperError(error);
  if (safe instanceof StorageRestoreRejectedError)
    return rawRestoreErrorSchema.parse({
      error: { code: safe.code, message: safe.message, requestId, rejection: safe.rejection },
    });
  if (safe instanceof StorageCreationRejectedError)
    return creationErrorSchema.parse({
      error: { code: safe.code, message: safe.message, requestId, rejection: safe.rejection },
    });
  if (safe instanceof StorageImportRejectedError)
    return importErrorSchema.parse({
      error: { code: safe.code, message: safe.message, requestId, rejection: safe.rejection },
    });
  if (safe instanceof StorageRecoveryRejectedError)
    return recoveryErrorSchema.parse({
      error: { code: safe.code, message: safe.message, requestId, rejection: safe.rejection },
    });
  if (safe instanceof StorageCommandRejectedError)
    return storageCommandErrorSchema.parse({
      error: { code: safe.code, message: safe.message, requestId, rejection: safe.rejection },
    });
  return {
    error: {
      code: safe ? safe.code : 'temporarily_unavailable',
      message: safe ? safe.message : 'This operation is temporarily unavailable.',
      requestId,
    },
  };
}
export function developerErrorResponse(error: unknown, requestId: string) {
  const safe = knownDeveloperError(error);
  const known = safe instanceof DeveloperAccessError;
  return Response.json(developerErrorPayload(error, requestId), {
    status: known ? safe.status : 503,
    headers: {
      ...DEVELOPER_HEADERS,
      'X-Request-Id': requestId,
      ...(known && safe.retryAfter ? { 'Retry-After': String(safe.retryAfter) } : {}),
    },
  });
}

const REST_CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Expose-Headers': 'X-Request-Id, Retry-After, Server-Timing',
};
export function restResponse(response: Response) {
  for (const [key, value] of Object.entries(REST_CORS_HEADERS)) response.headers.set(key, value);
  return response;
}
export function restOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      ...REST_CORS_HEADERS,
      'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type, Idempotency-Key',
      'Access-Control-Max-Age': '600',
    },
  });
}
