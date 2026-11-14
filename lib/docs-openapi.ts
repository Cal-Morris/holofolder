import { createOpenAPI } from 'fumadocs-openapi/server';
import type { Document } from 'fumadocs-openapi';
import schema from '@/public/openapi.json';

export const docsOpenAPI = createOpenAPI({
  input: { holofolder: schema as unknown as Document },
  // Pages load the document once per browser session (components/docs/api-page.tsx) instead of embedding it.
  includeDocument: false,
});
