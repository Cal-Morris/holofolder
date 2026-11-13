import PublicBinderView from '@/components/public-binder';
import type { PublicBinder } from '@/lib/public-binder';

/** The server passes only the public allowlist to the client component and RSC payload. */
export default function SharedBinder({ binder, sharePath }: { binder: PublicBinder; sharePath: string }) {
  return (
    <>
      {/* Owner's light/dark choice before first paint, as the read-only BinderApp share did. */}
      {/* oxlint-disable-next-line react-doctor/nextjs-no-native-script -- must run inline before first paint; next/script's beforeInteractive only works in the root layout */}
      <script
        dangerouslySetInnerHTML={{
          __html: `document.documentElement.classList.toggle("dark", ${JSON.stringify(binder.appearance.dark)});`,
        }}
      />
      <PublicBinderView binder={binder} sharePath={sharePath} />
    </>
  );
}
