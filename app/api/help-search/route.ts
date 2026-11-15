import { createFromSource } from 'fumadocs-core/search/server';
import { helpSource } from '@/lib/help-source';

export const { GET } = createFromSource(helpSource);
