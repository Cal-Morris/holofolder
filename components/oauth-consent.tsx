'use client';
import { use, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { appPath } from '@/lib/app-path';
import { isLoopbackOAuthRedirect } from '@/lib/developer-api/oauth';
import {
  DEFAULT_DEVELOPER_PERMISSIONS,
  DEVELOPER_PERMISSION_LABELS,
  DEVELOPER_PERMISSIONS,
  type DeveloperPermission,
} from '@/lib/developer-api/permissions';
const GROUP_LABEL = 'text-muted-foreground px-1 text-[11px] font-semibold tracking-[0.12em] uppercase';
const GROUP_CARD = 'border-border/50 bg-muted/25 divide-border/40 divide-y overflow-hidden rounded-2xl border';
const READ_PERMISSIONS = DEVELOPER_PERMISSIONS.filter((p) => p.endsWith(':read'));
const CHANGE_PERMISSIONS = DEVELOPER_PERMISSIONS.filter((p) => !p.endsWith(':read'));
/** Same row shape as Settings: label on the left, switch on the right, whole row taps. */
function SwitchRow({
  label,
  hint,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  hint?: ReactNode;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex min-h-12 cursor-pointer items-center justify-between gap-4 px-4 py-3 has-[:disabled]:cursor-not-allowed">
      <span className="min-w-0 space-y-1">
        <span className="block text-sm font-medium break-words">{label}</span>
        {hint && <span className="text-muted-foreground block text-xs leading-relaxed">{hint}</span>}
      </span>
      <Switch checked={checked} disabled={disabled} onCheckedChange={onChange} aria-label={label} />
    </label>
  );
}
type Details = { client: { id: string; name: string }; redirectUri: string; scope: string; eligible: boolean };
export default function OAuthConsent({ searchParams }: { searchParams: Promise<{ authorization_id?: string }> }) {
  const { authorization_id: authorizationId } = use(searchParams);
  const [details, setDetails] = useState<Details | null>(null),
    [loading, setLoading] = useState(true),
    [signIn, setSignIn] = useState(false),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const [permissions, setPermissions] = useState<DeveloperPermission[]>([...DEFAULT_DEVELOPER_PERMISSIONS]);
  const [remoteClient, setRemoteClient] = useState(false),
    [callbackUrl, setCallbackUrl] = useState(''),
    [copied, setCopied] = useState(false);
  useEffect(() => {
    let cancelled = false;
    if (!authorizationId) return;
    fetch(appPath(`/api/oauth/authorization?authorization_id=${encodeURIComponent(authorizationId)}`), {
      cache: 'no-store',
    })
      .then(async (response) => {
        const result = await response.json();
        if (cancelled) return;
        if (response.status === 401) {
          setSignIn(true);
          return;
        }
        if (!response.ok) throw new Error(result.error?.message ?? 'This authorization request is unavailable.');
        if (typeof result.redirectUrl === 'string') {
          if (isLoopbackOAuthRedirect(result.redirectUrl)) setCallbackUrl(result.redirectUrl);
          else window.location.assign(result.redirectUrl);
          return;
        }
        if (
          typeof result.client?.name !== 'string' ||
          typeof result.client.id !== 'string' ||
          typeof result.redirectUri !== 'string' ||
          typeof result.scope !== 'string'
        )
          throw new Error('Invalid authorization details.');
        new URL(result.redirectUri);
        setDetails({
          client: result.client,
          redirectUri: result.redirectUri,
          scope: result.scope,
          eligible: result.eligible === true,
        });
      })
      .catch((error) => {
        if (!cancelled) setError(error instanceof Error ? error.message : 'Authorization unavailable.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [authorizationId]);
  async function decide(decision: 'approve' | 'deny') {
    if (!authorizationId) return;
    setBusy(true);
    setError('');
    try {
      const response = await fetch(appPath('/api/oauth/decision'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ authorizationId, decision, permissions }),
      });
      const result = await response.json();
      if (!response.ok || typeof result.redirectUrl !== 'string')
        throw new Error(result.error?.message ?? 'Authorization failed. Try connecting again.');
      if (remoteClient && isLoopbackOAuthRedirect(result.redirectUrl)) setCallbackUrl(result.redirectUrl);
      else window.location.assign(result.redirectUrl);
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Authorization failed.');
      setBusy(false);
    }
  }
  async function copyCallback() {
    try {
      await navigator.clipboard.writeText(callbackUrl);
      setCopied(true);
      setError('');
    } catch {
      setError('Copy unavailable. Select and copy the callback URL.');
    }
  }
  if (!authorizationId)
    return (
      <p role="alert" className="text-destructive mt-4 text-sm">
        Start the connection from your MCP client to open a consent request.
      </p>
    );
  if (signIn)
    return (
      <div className="mt-6 space-y-4">
        <p className="text-muted-foreground text-sm">Sign in to review this client and choose its permissions.</p>
        <a
          className="bg-primary text-primary-foreground inline-flex min-h-11 items-center rounded-lg px-4 text-sm font-medium"
          href={appPath(
            `/auth/login?next=${encodeURIComponent(appPath(`/oauth/consent?authorization_id=${authorizationId}`))}`,
          )}
        >
          Sign in to Holo Folder
        </a>
      </div>
    );
  if (callbackUrl)
    return (
      <div className="mt-6 space-y-4">
        <h2 className="text-lg font-medium">Return to your MCP client</h2>
        <p className="text-muted-foreground text-sm leading-relaxed">
          If your client runs on another machine, copy this callback URL and send it to your agent. Ask it to open the
          URL on the machine where the client is waiting. Opening localhost in this browser reaches this device instead.
        </p>
        <Button type="button" className="min-h-11 w-full" onClick={() => void copyCallback()}>
          {copied ? 'Copied callback URL' : 'Copy callback URL'}
        </Button>
        <label className="block space-y-2 text-sm">
          <span>Callback URL</span>
          <textarea
            readOnly
            value={callbackUrl}
            onFocus={(event) => event.target.select()}
            spellCheck={false}
            className="border-border bg-muted/20 h-28 w-full resize-none rounded-lg border p-3 text-base [overflow-wrap:anywhere]"
          />
        </label>
        <p className="text-muted-foreground text-xs leading-relaxed">
          Send this only to the client you are connecting. If the request expires, start a new connection from your
          client.
        </p>
        <Button
          type="button"
          variant="outline"
          className="min-h-11 w-full"
          onClick={() => window.location.assign(callbackUrl)}
        >
          Open on this device
        </Button>
        {copied && (
          <p role="status" className="text-muted-foreground text-sm">
            Callback URL copied. Return to your agent to finish.
          </p>
        )}
        {error && (
          <p role="alert" className="text-destructive text-sm">
            {error}
          </p>
        )}
      </div>
    );
  return (
    <div className="mt-6 space-y-5">
      {loading && <p className="text-muted-foreground text-sm">Loading authorization request…</p>}
      {details && (
        <>
          <section aria-label="Client" className="space-y-1.5">
            <h2 className={GROUP_LABEL}>Client</h2>
            <div className={GROUP_CARD}>
              <div className="space-y-1 px-4 py-3">
                <h3 className="text-base font-semibold break-words">{details.client.name}</h3>
                <p className="text-muted-foreground text-sm">Wants to access your Holo Folder data.</p>
              </div>
              <div className="flex items-center justify-between gap-4 px-4 py-3 text-sm">
                <span className="text-muted-foreground shrink-0">Redirects to</span>
                <span className="min-w-0 text-right font-medium break-all">
                  {new URL(details.redirectUri).host || new URL(details.redirectUri).protocol}
                </span>
              </div>
              {details.scope && (
                <div className="flex items-center justify-between gap-4 px-4 py-3 text-sm">
                  <span className="text-muted-foreground shrink-0">Account info</span>
                  <span className="min-w-0 text-right font-medium break-words">
                    {details.scope.split(' ').join(', ')}
                  </span>
                </div>
              )}
            </div>
          </section>
          {!details.eligible && (
            <p className="border-border/50 bg-muted/35 rounded-2xl border px-4 py-3 text-sm">
              MCP access requires a Premium subscription or lifetime access. Signup trials do not include it.{' '}
              <a className="underline" href="/app">
                Open Holo Folder to manage your plan.
              </a>
            </p>
          )}
          {(
            [
              ['Read access', READ_PERMISSIONS],
              ['Changes', CHANGE_PERMISSIONS],
            ] as const
          ).map(([label, group]) => (
            <section key={label} aria-label={label} className="space-y-1.5">
              <h2 className={GROUP_LABEL}>{label}</h2>
              <div className={GROUP_CARD}>
                {group.map((permission) => (
                  <SwitchRow
                    key={permission}
                    label={DEVELOPER_PERMISSION_LABELS[permission]}
                    checked={permissions.includes(permission)}
                    disabled={!details.eligible || busy}
                    onChange={(checked) =>
                      setPermissions((current) =>
                        checked ? [...current, permission] : current.filter((p) => p !== permission),
                      )
                    }
                  />
                ))}
              </div>
            </section>
          ))}
          <p className="text-muted-foreground px-1 text-xs leading-relaxed">
            Changes let this client edit your data. Sharing and partner permissions can change who has access. You can
            revoke the connection in Settings.
          </p>
          {isLoopbackOAuthRedirect(details.redirectUri) && (
            <div className={GROUP_CARD}>
              <SwitchRow
                label="My client is on another machine"
                hint="For a remote agent, SSH session or container. We will show a callback URL to send to your agent instead of opening localhost on this device."
                checked={remoteClient}
                disabled={busy}
                onChange={setRemoteClient}
              />
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <Button
              type="button"
              variant="outline"
              className="min-h-11"
              disabled={busy}
              onClick={() => void decide('deny')}
            >
              Deny
            </Button>
            <Button
              type="button"
              className="min-h-11"
              disabled={busy || !details.eligible}
              onClick={() => void decide('approve')}
            >
              {busy ? 'Connecting…' : 'Approve access'}
            </Button>
          </div>
        </>
      )}
      {error && (
        <p role="alert" className="text-destructive text-sm break-words">
          {error}
        </p>
      )}
    </div>
  );
}
