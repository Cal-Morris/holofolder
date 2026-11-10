import { DeveloperAccessError } from '@/lib/developer-api/permissions'

/** Fixed denial, no environment, credential, request or test flag can admit production execution. */
export function requireNativeDeveloperAdmission(): void {
  throw new DeveloperAccessError('native_operations_staged', 'Native storage operations are not enabled. Complete developer reads and rollout acceptance under #379 are still required.', 503)
}
