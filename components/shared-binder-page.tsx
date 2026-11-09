import PublicBinderView from '@/components/public-binder'
import type { PublicBinder } from '@/lib/public-binder'

/** The server passes only the public allowlist to the client component and RSC payload. */
export default function SharedBinder({ binder }: { binder: PublicBinder }) {
  return <PublicBinderView binder={binder} />
}
