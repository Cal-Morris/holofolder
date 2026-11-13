// Playwright's app web server (playwright.config.ts): checks the port, builds only when the source changed, then
// serves the e2e build. The build goes to NEXT_DIST_DIR (default `.next-e2e`) so it never clobbers `bun run build`
// or `next dev` output, and its synthetic Supabase URL never ends up in `.next`.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import path from 'node:path';

const port = Number(process.env.E2E_PORT || 3210);
const distDir = process.env.NEXT_DIST_DIR || '.next-e2e';
process.env.NEXT_DIST_DIR = distDir;
const stampFile = path.join(distDir, 'e2e-build-stamp');

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

function git(...args: string[]) {
  const result = spawnSync('git', args, { encoding: 'buffer', maxBuffer: 1 << 30 });
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`);
  return result.stdout;
}

/** Everything the build reads: tracked and untracked source outside e2e/, plus the env baked into the bundle. */
function buildFingerprint() {
  const hash = createHash('sha256');
  const scope = ['--', '.', ':(exclude)e2e'];
  hash.update(git('ls-files', '-s', ...scope));
  hash.update(git('diff', '--binary', ...scope));
  for (const file of git('ls-files', '-o', '--exclude-standard', '-z', ...scope)
    .toString()
    .split('\0')) {
    if (file && existsSync(file)) hash.update(file).update(readFileSync(file));
  }
  for (const [key, value] of Object.entries(process.env).sort()) {
    if (key.startsWith('NEXT_PUBLIC_') || key === 'HOLOFOLDER_E2E' || key === 'NEXT_DIST_DIR')
      hash.update(`${key}=${value}\n`);
  }
  return hash.digest('hex');
}

async function main() {
  if (!(await portFree(port))) {
    console.error(
      `\nE2E port ${port} is already in use (see \`lsof -nP -iTCP:${port} -sTCP:LISTEN\`).\n` +
        `Pick a free one with E2E_PORT=<port>, or set E2E_REUSE=1 to test the server already running there.\n`,
    );
    process.exit(1);
  }

  const fingerprint = buildFingerprint();
  const built =
    existsSync(path.join(distDir, 'BUILD_ID')) &&
    existsSync(stampFile) &&
    readFileSync(stampFile, 'utf8') === fingerprint;
  if (built && process.env.E2E_REBUILD !== '1') {
    console.log(`e2e build in ${distDir} matches the source, skipping the build (E2E_REBUILD=1 forces one)`);
  } else {
    // next build points next-env.d.ts at its distDir; keep the committed one pointing at `.next`.
    const nextEnv = readFileSync('next-env.d.ts', 'utf8');
    const build = spawnSync('bunx', ['next', 'build'], { stdio: 'inherit' });
    writeFileSync('next-env.d.ts', nextEnv);
    if (build.status !== 0) process.exit(build.status ?? 1);
    if (!existsSync(path.join(distDir, 'BUILD_ID'))) {
      console.error(`next build did not write ${distDir}; next.config.mjs must honour NEXT_DIST_DIR`);
      process.exit(1);
    }
    writeFileSync(stampFile, fingerprint);
  }

  const server = spawnSync('bunx', ['next', 'start', '-p', String(port)], { stdio: 'inherit' });
  process.exit(server.status ?? 1);
}

void main();
