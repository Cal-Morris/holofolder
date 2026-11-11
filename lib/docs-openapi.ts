import { createOpenAPI } from 'fumadocs-openapi/server';
import type { Document } from 'fumadocs-openapi';
import schema from '@/public/openapi.json';

export const docsOpenAPI = createOpenAPI({
  input: { holofolder: schema as unknown as Document },
});
