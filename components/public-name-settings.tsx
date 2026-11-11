'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  buildNamedBinderSharePath,
  normalizeBinderSlug,
  normalizeUsername,
  suggestBinderSlug,
} from '@/lib/public-binder-identity';

interface PublicNameSettingsProps {
  binderId?: string | null;
  binderName?: string;
  isOnline: boolean;
  onSaved: () => void;
}

type SavedIdentity = { current: string | null; username: string | null; available: boolean; canEdit: boolean };

export function PublicNameSettings(props: PublicNameSettingsProps) {
  return <PublicNameForm key={`${props.binderId ?? ''}:${props.binderName ?? ''}:${props.isOnline}`} {...props} />;
}

function PublicNameForm({ binderId, binderName = '', isOnline, onSaved }: PublicNameSettingsProps) {
  const id = useId();
  const endpoint = `/app/api/binder-identity?binderId=${encodeURIComponent(binderId ?? '')}`;
  const normalize = normalizeBinderSlug;
  const saveController = useRef<AbortController | null>(null);
  const [saved, setSaved] = useState<SavedIdentity | null>(null);
  const [value, setValue] = useState('');
  const [loading, setLoading] = useState(Boolean(binderId));
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    if (!binderId) return () => controller.abort();
    async function load() {
      try {
        const response = await fetch(endpoint, {
          cache: 'no-store',
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(8000)]),
        });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload?.error || 'Could not load your public address.');
        if (controller.signal.aborted) return;
        const current = normalizeBinderSlug(payload?.slug);
        setSaved({
          current,
          username: normalizeUsername(payload?.username),
          available: payload?.available === true,
          canEdit: payload?.canEdit === true,
        });
        setValue(current ?? suggestBinderSlug(binderName));
      } catch (error) {
        if (!controller.signal.aborted) {
          setFailed(true);
          setMessage(error instanceof Error ? error.message : 'Could not load your public address.');
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    void load();
    return () => {
      controller.abort();
      saveController.current?.abort();
    };
  }, [binderId, binderName, endpoint, isOnline]);

  const chosen = normalize(value);
  const changed = Boolean(chosen && chosen !== saved?.current);
  const disabled = loading || saving || !isOnline || !saved?.available || !saved.canEdit;
  async function save() {
    if (disabled || !chosen || !changed) return;
    const controller = new AbortController();
    saveController.current = controller;
    setSaving(true);
    setMessage(null);
    setFailed(false);
    try {
      const response = await fetch(endpoint, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ binderId, slug: chosen }),
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]),
      });
      const payload = await response.json();
      if (controller.signal.aborted) return;
      if (!response.ok) throw new Error(payload?.error || 'Could not save your public address.');
      const current = normalizeBinderSlug(payload?.slug);
      if (!current) throw new Error('Could not confirm the saved address. Reopen Settings to check it.');
      setSaved({ current, username: normalizeUsername(payload?.username), canEdit: true, available: true });
      setValue(current);
      setMessage('Binder address saved.');
      onSaved();
    } catch (error) {
      if (!controller.signal.aborted) {
        setFailed(true);
        setMessage(error instanceof Error ? error.message : 'Could not save your public address.');
      }
    } finally {
      if (!controller.signal.aborted) setSaving(false);
    }
  }

  return (
    <section className="holo-panel border-border/60 space-y-3 rounded-3xl border p-4" aria-label="Binder address">
      <div>
        <h3 className="font-semibold">Binder address</h3>
        <p className="text-muted-foreground mt-1 text-xs leading-relaxed">
          Give this binder a short address. Renaming the binder later won’t change this.
        </p>
      </div>
      <label htmlFor={id} className="block text-sm font-medium">
        Binder slug
      </label>
      <div className="flex items-center gap-2">
        <Input
          id={id}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          disabled={disabled}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          maxLength={60}
          placeholder="national"
          aria-describedby={`${id}-help`}
        />
        <Button onClick={() => void save()} disabled={disabled || !changed} className="min-h-10">
          {saving ? 'Saving…' : 'Save'}
        </Button>
      </div>
      <p id={`${id}-help`} className="text-muted-foreground text-xs">
        1–60 letters, numbers or hyphens. Start and end with a letter or number.
      </p>
      {saved?.current && changed && (
        <p className="text-muted-foreground text-xs">
          Changing the slug breaks this binder’s previous named link. The old name stays reserved to you.
        </p>
      )}
      {saved?.username && saved.current && (
        <p className="text-primary text-xs break-all">
          holofolder.com{buildNamedBinderSharePath(saved.username, saved.current)}
        </p>
      )}
      <p className="text-muted-foreground text-xs">
        {saved?.available && !saved.canEdit ? 'Only the binder owner can change this address. ' : ''}
        {saved?.available && saved.canEdit && !saved.username
          ? 'Set your account username first to use a named link. '
          : ''}
        Sharing must be enabled for this address to work.
      </p>
      {loading && (
        <p role="status" className="text-muted-foreground text-xs">
          Loading address…
        </p>
      )}
      {saved && !saved.available && (
        <p className="text-muted-foreground text-xs">
          Named links are not available yet. Your existing share link still works.
        </p>
      )}
      {!binderId && <p className="text-muted-foreground text-xs">Open a named binder to set its address.</p>}
      {!isOnline && (
        <p className="text-muted-foreground text-xs">Connect to the internet to save your public address.</p>
      )}
      {message && (
        <p role={failed ? 'alert' : 'status'} className="text-muted-foreground text-xs">
          {message}
        </p>
      )}
    </section>
  );
}
