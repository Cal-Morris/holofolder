'use client';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { appPath } from '@/lib/app-path';
type Client = { client_id: string; client_name: string; revocationPending?: boolean };
export default function DeveloperClients({ isOnline }: { isOnline: boolean }) {
  const [clients, setClients] = useState<Client[]>([]),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    let cancelled = false;
    fetch(appPath('/api/developer/clients'), { cache: 'no-store' })
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok) throw new Error(result.error?.message ?? 'Connected clients are unavailable.');
        if (!cancelled)
          setClients(
            Array.isArray(result.clients)
              ? result.clients.filter((row: unknown): row is Client =>
                  Boolean(
                    row &&
                    typeof row === 'object' &&
                    'client_id' in row &&
                    typeof row.client_id === 'string' &&
                    'client_name' in row &&
                    typeof row.client_name === 'string',
                  ),
                )
              : [],
          );
      })
      .catch((error) => {
        if (!cancelled) setError(error instanceof Error ? error.message : 'Connected clients are unavailable.');
      });
    return () => {
      cancelled = true;
    };
  }, []);
  async function revoke(client: Client) {
    setBusy(true);
    setError('');
    try {
      const response = await fetch(appPath('/api/developer/clients'), {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId: client.client_id }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error?.message ?? 'Could not revoke this client.');
      setClients((current) => current.filter((row) => row.client_id !== client.client_id));
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Could not revoke this client.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="space-y-2" aria-label="Connected MCP clients">
      <h4 className="text-sm font-medium">Connected MCP clients</h4>
      {clients.length === 0 && !error && (
        <p className="text-muted-foreground text-xs">
          No connected clients. Add Holo Folder in your MCP client and approve the connection.
        </p>
      )}
      {clients.map((client) => (
        <div
          key={client.client_id}
          className="border-border flex items-start justify-between gap-3 rounded-xl border p-3"
        >
          <p className="min-w-0 text-sm break-words">{client.client_name}</p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="min-h-9 shrink-0"
            disabled={busy || !isOnline}
            onClick={() => void revoke(client)}
            aria-label={`${client.revocationPending ? 'Finish disconnecting' : 'Disconnect'} ${client.client_name}`}
          >
            {client.revocationPending ? 'Retry disconnect' : 'Disconnect'}
          </Button>
        </div>
      ))}
      {error && (
        <p role="alert" className="text-destructive text-xs break-words">
          {error}
        </p>
      )}
    </section>
  );
}
