'use client';

import { useSyncExternalStore, type ComponentProps } from 'react';
import { createOpenAPIPage } from 'fumadocs-openapi/ui';
import type { Document } from 'fumadocs-openapi';
import { appPath } from '@/lib/app-path';

const APIPage = createOpenAPIPage({
  storageKeyPrefix: 'holofolder-docs-',
  // The one document (`holofolder`) is left out of page props; the browser fetches the public copy.
  loadDocument: async () => {
    if (typeof window === 'undefined') return (await import('@/public/openapi.json')).default as unknown as Document;
    const response = await fetch(appPath('/openapi.json'));
    if (!response.ok) throw new Error(`OpenAPI document failed to load (${response.status})`);
    return (await response.json()) as Document;
  },
  playground: {
    authProviders: [
      {
        on: 'apiKey',
        onRequest: (data, value) => {
          data.header.Authorization = `Bearer ${typeof value === 'string' ? value.trim().replace(/^Bearer\s+/i, '') : ''}`;
        },
        render: ({ Value }) => (
          <Value
            name="API key"
            type="Bearer"
            schema={{ type: 'string', format: 'password' }}
            description="Paste the full hf_ key. The Bearer prefix is added for you."
          />
        ),
      },
    ],
    transformAuthInputs: (fields) => fields.map((field) => ({ ...field, defaultValue: '' })),
    fetchOptions: { onRequestInit: (init) => ({ ...init, credentials: 'omit' }) },
  },
});
const subscribe = () => () => {};

export function OpenAPIPage(props: ComponentProps<typeof APIPage>) {
  const ready = useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
  // The server-rendered playground trigger must not accept a click before its handlers attach.
  return (
    <div inert={!ready}>
      <APIPage {...props} />
    </div>
  );
}
