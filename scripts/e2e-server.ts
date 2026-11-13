// Playwright's app web server (playwright.config.ts): checks the port, builds, then serves the e2e build.
// The build goes to NEXT_DIST_DIR (default `.next-e2e`) so it never clobbers `bun run build`
// or `next dev` output, and its synthetic Supabase URL never ends up in `.next`.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createServer } from 'node:net';
import path from 'node:path';

const port = Number(process.env.E2E_PORT || 3210);
const distDir = process.env.NEXT_DIST_DIR || '.next-e2e';
process.env.NEXT_DIST_DIR = distDir;

// Next fills unset keys from .env.local, which on a dev machine holds real Postgres, Supabase, Stripe and eBay
// credentials. Blank them so e2e runs match CI (no .env.local) and server routes can't reach real services.
for (const file of ['.env.local', '.env.production.local']) {
  if (!existsSync(file)) continue;
  for (const [, key] of readFileSync(file, 'utf8').matchAll(/^\s*(?:export\s+)?([A-Za-z_]\w*)\s*=/gm)) {
    process.env[key] ??= '';
  }
}

function portFree(value: number) {
  return new Promise<boolean>((resolve) => {
    const server = createServer()
      .once('error', () => resolve(false))
      .once('listening', () => server.close(() => resolve(true)));
    server.listen(value);
  });
}

async function main() {
  if (!(await portFree(port))) {
    console.error(
      `\nE2E port ${port} is already in use (see \`lsof -nP -iTCP:${port} -sTCP:LISTEN\`).\n` +
        `Pick a free one with E2E_PORT=<port>, or set E2E_REUSE=1 to test the server already running there.\n`,
    );
    process.exit(1);
  }

  const build = spawnSync('bunx', ['next', 'build'], { stdio: 'inherit' });
  if (build.status !== 0) process.exit(build.status ?? 1);
  if (!existsSync(path.join(distDir, 'BUILD_ID'))) {
    console.error(`next build did not write ${distDir}; next.config.mjs must honour NEXT_DIST_DIR`);
    process.exit(1);
  }

  const server = spawnSync('bunx', ['next', 'start', '-p', String(port)], { stdio: 'inherit' });
  process.exit(server.status ?? 1);
}

void main();
