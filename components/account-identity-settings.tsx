'use client';

import { useEffect, useState } from 'react';
import type { User } from '@supabase/supabase-js';
import { Button } from '@/components/ui/button';
import { createClient } from '@/lib/supabase/client';
import { accountDisplayName, normalizeDisplayName, normalizeUsername } from '@/lib/account-identity';

export function AccountIdentitySettings({
  user,
  isOnline,
  onUsernameSaved,
}: {
  user: User;
  isOnline: boolean;
  onUsernameSaved?: () => void;
}) {
  const [name, setName] = useState(() => accountDisplayName(user.user_metadata));
  const [savedName, setSavedName] = useState(name);
  const [namePending, setNamePending] = useState(false);
  const [nameMessage, setNameMessage] = useState('');
  const [username, setUsername] = useState('');
  const [savedUsername, setSavedUsername] = useState<string | null>(null);
  const [usernameReady, setUsernameReady] = useState(false);
  const [usernamePending, setUsernamePending] = useState(false);
  const [usernameMessage, setUsernameMessage] = useState('');

  useEffect(() => {
    if (!isOnline) return;
    const controller = new AbortController();
    void fetch('/app/api/account-identity', { cache: 'no-store', signal: controller.signal })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Could not load your username. Reopen Settings to retry.');
        if (controller.signal.aborted) return;
        const value = normalizeUsername(data.username);
        setUsername(value ?? '');
        setSavedUsername(value);
        setUsernameReady(true);
        setUsernameMessage('');
      })
      .catch((error) => {
        if (!controller.signal.aborted)
          setUsernameMessage(
            error instanceof Error ? error.message : 'Could not load your username. Reopen Settings to retry.',
          );
      });
    return () => controller.abort();
  }, [isOnline, user.id]);

  return (
    <section className="border-border/50 bg-muted/25 space-y-4 rounded-2xl border p-3" aria-label="Your profile">
      <form
        className="space-y-2"
        onSubmit={async (event) => {
          event.preventDefault();
          const value = normalizeDisplayName(name);
          if (!value) {
            setNameMessage('Enter a name of up to 60 characters.');
            return;
          }
          if (!isOnline || namePending) return;
          setNamePending(true);
          setNameMessage('');
          try {
            const { error } = await createClient().auth.updateUser({ data: { display_name: value, name: value } });
            if (error) throw error;
            setName(value);
            setSavedName(value);
            setNameMessage('Name saved.');
          } catch {
            setNameMessage('Could not save your name. Try again.');
          } finally {
            setNamePending(false);
          }
        }}
      >
        <label htmlFor="account-name" className="text-sm font-medium">
          Name
        </label>
        <input
          id="account-name"
          autoComplete="name"
          maxLength={60}
          value={name}
          disabled={namePending}
          onChange={(event) => {
            setName(event.target.value);
            setNameMessage('');
          }}
          className="border-border bg-background min-h-10 w-full rounded-xl border px-3 text-base"
          aria-describedby="account-name-help"
        />
        <p id="account-name-help" className="text-muted-foreground text-xs">
          Your first name is used in notifications, for example “Cal found a card”.
        </p>
        <Button
          type="submit"
          variant="outline"
          className="min-h-10 w-full"
          disabled={!isOnline || namePending || name === savedName}
        >
          {namePending ? 'Saving name…' : 'Save name'}
        </Button>
        {nameMessage && (
          <p role="status" className="text-muted-foreground text-xs">
            {nameMessage}
          </p>
        )}
      </form>
      <form
        className="space-y-2"
        onSubmit={async (event) => {
          event.preventDefault();
          const value = normalizeUsername(username);
          if (!value) {
            setUsernameMessage('Use 3–30 letters, numbers or hyphens, starting and ending with a letter or number.');
            return;
          }
          if (!isOnline || usernamePending || !usernameReady) return;
          setUsernamePending(true);
          setUsernameMessage('');
          try {
            const response = await fetch('/app/api/account-identity', {
              method: 'PATCH',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ username: value }),
              signal: AbortSignal.timeout(15_000),
            });
            const data = await response.json();
            if (!response.ok) throw new Error(data.error || 'Could not save your username. Try again.');
            if (data.username !== value) throw new Error('Could not confirm your username. Reopen Settings to check.');
            setUsername(value);
            setSavedUsername(value);
            setUsernameMessage('Username saved.');
            onUsernameSaved?.();
          } catch (error) {
            setUsernameMessage(error instanceof Error ? error.message : 'Could not save your username. Try again.');
          } finally {
            setUsernamePending(false);
          }
        }}
      >
        <label htmlFor="account-username" className="text-sm font-medium">
          Username
        </label>
        <div className="border-border bg-background flex min-h-10 items-center rounded-xl border px-3">
          <span aria-hidden="true" className="text-muted-foreground">
            @
          </span>
          <input
            id="account-username"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            maxLength={30}
            value={username}
            disabled={!usernameReady || usernamePending}
            onChange={(event) => {
              setUsername(event.target.value);
              setUsernameMessage('');
            }}
            className="min-h-10 min-w-0 flex-1 bg-transparent pl-1 text-base outline-none"
            aria-describedby="account-username-help"
          />
        </div>
        <p id="account-username-help" className="text-muted-foreground text-xs">
          Your unique name for public binder links. Use 3–30 letters, numbers or hyphens.
        </p>
        {savedUsername && (
          <p className="text-muted-foreground text-xs">
            Changing your username will stop previous named links working. Your old username stays reserved to you.
          </p>
        )}
        <Button
          type="submit"
          variant="outline"
          className="min-h-10 w-full"
          disabled={!isOnline || !usernameReady || usernamePending || username === (savedUsername ?? '')}
        >
          {usernamePending ? 'Saving username…' : 'Save username'}
        </Button>
        {usernameMessage && (
          <p role="status" className="text-muted-foreground text-xs">
            {usernameMessage}
          </p>
        )}
      </form>
      {!isOnline && (
        <p role="status" className="text-muted-foreground text-xs">
          Connect to the internet to save your name or username.
        </p>
      )}
    </section>
  );
}
