'use client';

import { useEffect, useRef, useState } from 'react';
import type { PasskeyListItem } from '@supabase/supabase-js';
import { Button } from '@/components/ui/button';
import { createClient } from '@/lib/supabase/client';
import { usePasskeySupport } from '@/hooks/use-passkey-support';
import { passkeyErrorMessage } from '@/lib/passkeys';

export function AccountPasskeys({ isOnline }: { isOnline: boolean }) {
  const [passkeys, setPasskeys] = useState<PasskeyListItem[]>([]);
  const supported = usePasskeySupport();
  const [ready, setReady] = useState(false);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState('');
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => {
    return () => controller.current?.abort();
  }, []);
  useEffect(() => {
    if (!isOnline) return;
    let active = true;
    void createClient()
      .auth.passkey.list()
      .then(({ data, error }) => {
        if (!active) return;
        if (error) {
          setMessage('Could not load your passkeys. Reopen Settings to retry.');
          return;
        }
        setPasskeys(data ?? []);
        setReady(true);
      })
      .catch(() => {
        if (active) setMessage('Could not load your passkeys. Reopen Settings to retry.');
      });
    return () => {
      active = false;
    };
  }, [isOnline]);

  return (
    <section aria-label="Passkeys" className="border-border/50 bg-muted/25 space-y-3 rounded-2xl border p-3">
      <h3 className="font-semibold">Passkeys</h3>
      <p className="text-muted-foreground text-sm">
        Sign in with your fingerprint, face or device PIN. Keep email or password sign-in as a backup.
      </p>
      {passkeys.map((passkey) => {
        const name = passkey.friendly_name || 'Passkey';
        return (
          <div key={passkey.id} className="border-border/50 space-y-2 rounded-xl border p-3">
            <p className="text-sm font-medium break-words">{name}</p>
            {confirmId === passkey.id ? (
              <div className="space-y-2">
                <p className="text-muted-foreground text-sm">
                  Remove this passkey from your account? You can still sign in with email or password.
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="destructive"
                    className="min-h-10"
                    disabled={!isOnline || pending}
                    onClick={async () => {
                      setPending(true);
                      setMessage('');
                      try {
                        const { error } = await createClient().auth.passkey.delete({ passkeyId: passkey.id });
                        if (error) throw error;
                        setPasskeys((current) => current.filter((item) => item.id !== passkey.id));
                        setConfirmId(null);
                        setMessage('Passkey removed.');
                      } catch {
                        setMessage('Could not remove this passkey. Try again.');
                      } finally {
                        setPending(false);
                      }
                    }}
                  >
                    Confirm removal
                  </Button>
                  <Button variant="outline" className="min-h-10" disabled={pending} onClick={() => setConfirmId(null)}>
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <Button
                variant="outline"
                className="min-h-10"
                aria-label={`Remove ${name}`}
                disabled={!isOnline || pending}
                onClick={() => setConfirmId(passkey.id)}
              >
                Remove
              </Button>
            )}
          </div>
        );
      })}
      <Button
        variant="outline"
        className="min-h-10 w-full"
        disabled={!supported || !isOnline || !ready || pending}
        onClick={async () => {
          if (pending) return;
          setPending(true);
          setMessage('');
          controller.current = new AbortController();
          try {
            const { error } = await createClient().auth.registerPasskey({
              options: { signal: controller.current.signal },
            });
            if (error) throw error;
            const { data, error: listError } = await createClient().auth.passkey.list();
            if (listError) {
              setMessage('Passkey added. Reopen Settings to refresh the list.');
              return;
            }
            setPasskeys(data ?? []);
            setMessage('Passkey added.');
          } catch (error) {
            setMessage(passkeyErrorMessage(error, 'register'));
          } finally {
            setPending(false);
          }
        }}
      >
        {pending ? 'Please wait…' : 'Add a passkey'}
      </Button>
      {!supported && <p className="text-muted-foreground text-xs">Use a browser that supports passkeys to add one.</p>}
      {!isOnline && <p className="text-muted-foreground text-xs">Connect to the internet to manage passkeys.</p>}
      {message && (
        <p role="status" className="text-muted-foreground text-sm">
          {message}
        </p>
      )}
    </section>
  );
}
