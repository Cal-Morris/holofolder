import { handleNativeRecovery } from '@/lib/server/native-recovery-http';

export async function POST(request: Request) {
  return handleNativeRecovery(request);
}
