import type { PublicBinder } from '@/lib/public-binder';
import { binderShareMetadata } from '@/lib/social-metadata';

/** Uses the same authorized, fenced projection as the page. No card/grade/price/image payload. */
export function loadShareMetadata(binder: PublicBinder, username?: string, previewImage?: string) {
  return binderShareMetadata(username ?? binder.username, binder.name, previewImage);
}
