'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { bindPushAccount, clearPushDevice, reconcilePushAccount } from '@/lib/push-device-client';

type Device = { id: string; endpoint: string; label: string };
export function PartnerPushSettings({ userId, isInstalledApp }: { userId: string | null; isInstalledApp: boolean }) {
  const [devices, setDevices] = useState<Device[]>([]);
  const [endpoint, setEndpoint] = useState<string | null>(null);
  const [configured, setConfigured] = useState(false);
  const [supported, setSupported] = useState(false);
  const [needsInstall, setNeedsInstall] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    if (!userId) return;
    await reconcilePushAccount(userId);
    const response = await fetch('/app/api/push/subscriptions', { cache: 'no-store' });
    if (!response.ok) throw new Error('Could not load your notification devices.');
    const data = await response.json();
    setDevices(Array.isArray(data.devices) ? data.devices : []);
    setConfigured(Boolean(data.configured));
    const registration = await navigator.serviceWorker?.getRegistration('/app');
    const subscription = await registration?.pushManager?.getSubscription();
    setEndpoint(subscription?.endpoint ?? null);
  }, [userId]);
  useEffect(() => {
    const available = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
    const ios =
      /iPad|iPhone|iPod/.test(navigator.userAgent) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    queueMicrotask(() => {
      setSupported(available);
      setNeedsInstall(ios && !isInstalledApp);
    });
    if (available)
      queueMicrotask(() => {
        void refresh().catch((error) => setMessage(error.message));
      });
  }, [refresh, isInstalledApp]);

  const sendTest = async (id: string) => {
    const response = await fetch('/app/api/push/test', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id }),
      signal: AbortSignal.timeout(15_000),
    });
    const result = await response.json().catch(() => null);
    if (!response.ok || result?.sent !== true)
      throw new Error(
        result?.error ?? 'Test notification could not be sent. Your device is still registered; try again.',
      );
    setMessage('Test notification sent. If it does not appear, check your device notification settings.');
  };
  const enable = async () => {
    // Permission must be requested directly from this tap, before awaiting any other work.
    const permission = Notification.requestPermission();
    setBusy(true);
    setMessage(null);
    try {
      if ((await permission) !== 'granted')
        throw new Error('Notifications are blocked. Allow them in your device or browser settings, then try again.');
      const registration = await navigator.serviceWorker.getRegistration('/app');
      if (!registration?.active) throw new Error('The app is still getting ready. Reload and try again.');
      const key = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
      if (!key || !userId) throw new Error('Notifications are not available yet.');
      await clearPushDevice();
      const decoded = atob(key.replaceAll('-', '+').replaceAll('_', '/'));
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: Uint8Array.from(decoded, (c) => c.charCodeAt(0)),
      });
      const response = await fetch('/app/api/push/subscriptions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          ...subscription.toJSON(),
          label: /iPhone|iPad/.test(navigator.userAgent) ? 'iPhone / iPad' : navigator.platform || 'This device',
        }),
      });
      if (!response.ok) {
        await subscription.unsubscribe();
        throw new Error((await response.json()).error ?? 'Could not enable notifications.');
      }
      const device = await response.json();
      try {
        await bindPushAccount(userId);
      } catch (error) {
        await clearPushDevice();
        throw error;
      }
      await refresh();
      await sendTest(device.id);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not enable notifications.');
    } finally {
      setBusy(false);
    }
  };
  const remove = async (device: Device) => {
    setBusy(true);
    setMessage(null);
    try {
      if (device.endpoint === endpoint) await clearPushDevice();
      const response = await fetch('/app/api/push/subscriptions', {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: device.id }),
      });
      if (!response.ok) throw new Error('Could not remove this device. Try again when online.');
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not remove device.');
    } finally {
      setBusy(false);
    }
  };
  const retryTest = async (id: string) => {
    setBusy(true);
    setMessage(null);
    try {
      await sendTest(id);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Test notification could not be sent. Try again.');
    } finally {
      setBusy(false);
    }
  };
  if (!userId) return null;
  const current = devices.find((device) => device.endpoint === endpoint);
  return (
    <section aria-label="Notifications" className="space-y-3">
      <p className="text-muted-foreground text-sm">
        Get an alert when your price checks finish, and when your partner adds an owned card or marks a wanted card Got.
        Enable this separately on each device.
      </p>
      {!supported ? (
        <p className="text-muted-foreground text-sm">Push notifications are unavailable in this browser.</p>
      ) : needsInstall ? (
        <p className="text-muted-foreground text-sm">
          On iPhone or iPad, add Holo Folder to your Home Screen, then enable notifications inside the installed app.
        </p>
      ) : !configured ? (
        <p className="text-muted-foreground text-sm">Notifications are not available yet.</p>
      ) : (
        !current && (
          <Button variant="outline" className="min-h-10" disabled={busy} onClick={enable}>
            Enable on this device
          </Button>
        )
      )}
      {current && supported && !needsInstall && configured && (
        <Button variant="outline" className="min-h-10" disabled={busy} onClick={() => void retryTest(current.id)}>
          Send test notification
        </Button>
      )}
      <ul className="space-y-2">
        {devices.map((device) => (
          <li key={device.id} className="flex min-w-0 items-center justify-between gap-3 text-sm">
            <span className="min-w-0 break-words">
              {device.label}
              {device.endpoint === endpoint ? ' · this device' : ''}
            </span>
            <Button
              variant="outline"
              size="sm"
              className="min-h-9 shrink-0"
              disabled={busy}
              onClick={() => void remove(device)}
              aria-label={`Remove ${device.label}`}
            >
              Remove
            </Button>
          </li>
        ))}
      </ul>
      {message && (
        <p role="status" className="text-muted-foreground text-sm">
          {message}
        </p>
      )}
    </section>
  );
}
