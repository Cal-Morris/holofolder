import { readFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * CLI-only: loads `.env` / `.env.local` from the project root into `process.env` (existing values win).
 * Kept out of lib/card-db-sync.ts because reading arbitrary paths under process.cwd() makes Turbopack
 * trace the whole repository into every route that imports that module.
 */
export async function loadProjectEnvFiles(projectRoot?: string) {
  const root = projectRoot || process.cwd();
  const envFiles = [path.join(root, '.env'), path.join(root, '.env.local')];

  for (const filePath of envFiles) {
    try {
      const contents = await readFile(filePath, 'utf8');
      for (const line of contents.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;

        const separatorIndex = trimmed.indexOf('=');
        if (separatorIndex === -1) continue;

        const key = trimmed.slice(0, separatorIndex).trim();
        const rawValue = trimmed.slice(separatorIndex + 1).trim();
        const unquotedValue = rawValue.replace(/^['"]|['"]$/g, '');

        if (!process.env[key]) {
          process.env[key] = unquotedValue;
        }
      }
    } catch {
      continue;
    }
  }
}
