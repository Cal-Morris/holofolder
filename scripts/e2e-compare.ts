// `bun run test:e2e:compare [playwright args…]`: did this tree break any e2e tests that pass on origin/main?
// Runs the given specs here first (failures retried once). Only if something fails, it builds and serves origin/main
// from its own worktree, on its own ports, and runs the failing spec files there. Prints tests that fail here but
// pass on main, new tests that fail, and flaky ones. Exit code 1 when anything regressed.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

type Outcome = 'expected' | 'unexpected' | 'flaky' | 'skipped';
type Suite = {
  title: string;
  file: string;
  suites?: Suite[];
  specs?: { title: string; file: string; tests: { projectName: string; status: Outcome }[] }[];
};

const root = process.cwd();
const args = process.argv.slice(2);
const port = Number(process.env.E2E_PORT || 3210);
// Flags whose value is a separate argument, so it isn't mistaken for a spec filter.
const valueFlags = new Set([
  '--project',
  '-g',
  '--grep',
  '--grep-invert',
  '-j',
  '--workers',
  '--repeat-each',
  '--timeout',
]);
const flags = args.filter((arg, index) => arg.startsWith('-') || valueFlags.has(args[index - 1]));

function run(command: string, commandArgs: string[], options: { cwd?: string; env?: NodeJS.ProcessEnv } = {}) {
  const result = spawnSync(command, commandArgs, { stdio: 'inherit', cwd: options.cwd ?? root, env: options.env });
  return result.status ?? 1;
}

function playwright(cwd: string, testArgs: string[], tree: string, treePort: number, env: Record<string, string> = {}) {
  const report = path.join(os.tmpdir(), `holofolder-e2e-${tree}-${process.pid}.json`);
  console.log(`\n▶ ${tree}: playwright test ${testArgs.join(' ')} (port ${treePort})`);
  run('bunx', ['playwright', 'test', '--retries=1', '--reporter=dot,json', ...testArgs], {
    cwd,
    env: {
      ...process.env,
      ...env,
      E2E_PORT: String(treePort),
      E2E_BACKEND_PORT: '',
      PLAYWRIGHT_JSON_OUTPUT_FILE: report,
    },
  });
  if (!existsSync(report)) throw new Error(`${tree}: Playwright wrote no report; see the output above`);
  const results = new Map<string, { file: string; status: Outcome }>();
  const walk = (suite: Suite, titles: string[]) => {
    const here = suite.title && suite.title !== suite.file ? [...titles, suite.title] : titles;
    for (const spec of suite.specs ?? [])
      for (const test of spec.tests)
        results.set(`${test.projectName} › ${spec.file} › ${[...here, spec.title].join(' › ')}`, {
          file: spec.file,
          status: test.status,
        });
    for (const child of suite.suites ?? []) walk(child, here);
  };
  for (const suite of JSON.parse(readFileSync(report, 'utf8')).suites as Suite[]) walk(suite, []);
  return results;
}

/** A detached origin/main worktree per source worktree, reused (and its e2e build with it) across runs. */
function baselineTree(): { dir: string; env: Record<string, string> } {
  const dir = path.join(
    os.tmpdir(),
    'holofolder-e2e-baseline',
    createHash('sha1').update(root).digest('hex').slice(0, 12),
  );
  if (run('git', ['fetch', '--quiet', 'origin', 'main'])) throw new Error('git fetch origin main failed');
  if (!existsSync(path.join(dir, '.git'))) {
    mkdirSync(path.dirname(dir), { recursive: true });
    if (run('git', ['worktree', 'add', '--detach', dir, 'origin/main'])) throw new Error(`could not create ${dir}`);
  } else if (run('git', ['checkout', '--quiet', '--detach', '--force', 'origin/main'], { cwd: dir })) {
    throw new Error(`could not check out origin/main in ${dir}`);
  }
  run('git', ['clean', '-fdq'], { cwd: dir });
  if (run('bun', ['install', '--frozen-lockfile', '--silent'], { cwd: dir })) throw new Error('bun install failed');
  // ponytail: until this runner is on main, main runs with this tree's isolated config (building into its own
  // `.next`, since main's next.config ignores NEXT_DIST_DIR); drop once merged.
  if (!existsSync(path.join(dir, 'scripts/e2e-server.ts'))) {
    for (const file of ['playwright.config.ts', 'scripts/e2e-server.ts'])
      copyFileSync(path.join(root, file), path.join(dir, file));
    return { dir, env: { NEXT_DIST_DIR: '.next' } };
  }
  return { dir, env: {} };
}

const branch = playwright(root, args, 'branch', port);
const failing = [...branch].filter(([, result]) => result.status === 'unexpected');
const flaky = [...branch].filter(([, result]) => result.status === 'flaky').map(([key]) => `${key} (branch)`);
const regressions: string[] = [];
const added: string[] = [];
let preexisting = 0;

if (failing.length) {
  const { dir, env } = baselineTree();
  const files = [...new Set(failing.map(([, result]) => result.file))].filter((file) =>
    existsSync(path.join(dir, 'e2e', file)),
  );
  const main = files.length
    ? playwright(dir, [...flags, ...files.map((file) => `e2e/${file}`)], 'main', port + 1, env)
    : new Map();
  for (const [key] of failing) {
    const base = main.get(key);
    if (!base) added.push(key);
    else if (base.status === 'expected') regressions.push(key);
    else if (base.status === 'flaky') flaky.push(`${key} (main)`);
    else if (base.status === 'unexpected') preexisting++;
  }
}

const section = (title: string, keys: string[]) =>
  keys.length && console.log(`\n${title} (${keys.length}):\n${keys.map((key) => `  ${key}`).join('\n')}`);
console.log(
  `\n${'─'.repeat(60)}\n${branch.size} tests here, ${failing.length} failing after one retry, ${preexisting} of them fail on origin/main too`,
);
section('✖ Fail here, pass on origin/main', regressions);
section('✖ Fail here, not on origin/main', added);
section('~ Flaky (failed, then passed on retry)', flaky);
if (!regressions.length && !added.length) console.log('\nNo regressions against origin/main.');
process.exit(regressions.length || added.length ? 1 : 0);
