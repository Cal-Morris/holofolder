import { createOpenAPI } from 'fumadocs-openapi/server'
import type { Document } from 'fumadocs-openapi'
import schema from '@/public/openapi.json'

export const docsOpenAPI = createOpenAPI({
  input: { holofolder: { ...schema, servers: [{ url: '/app/api/v1', description: 'Holo Folder API, on this site' }] } as Document },
})
