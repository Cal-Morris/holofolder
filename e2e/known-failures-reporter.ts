import type { FullResult, Reporter, Suite } from '@playwright/test/reporter';
import { knownFailure } from './known-failures';

/**
 * Keeps e2e/known-failures.json honest. Listed tests still run: a listed failure is reported on its own and doesn't
 * fail the run, a listed test that passes fails the run until it's removed from the list, and anything else that
 * fails fails the run as usual.
 */
export default class KnownFailuresReporter implements Reporter {
  private root?: Suite;

  onBegin(_config: unknown, suite: Suite) {
    this.root = suite;
  }

  async onEnd(result: FullResult): Promise<{ status: FullResult['status'] } | undefined> {
    const known: string[] = [];
    const fixed: string[] = [];
    let unlisted = 0;
    for (const test of this.root?.allTests() ?? []) {
      // ['', project, file, ...describes, title]
      const [, project, file, ...title] = test.titlePath();
      const entry = knownFailure(file, title, project);
      const outcome = test.outcome();
      const name = `${project} › ${[file, ...title].join(' › ')}`;
      if (outcome === 'unexpected') {
        if (entry) known.push(`${name} [${entry.cause}, batch ${entry.batch}]`);
        else unlisted++;
      } else if (entry && entry.cause !== 'flaky' && (outcome === 'expected' || outcome === 'flaky')) {
        fixed.push(name);
      }
    }
    if (known.length)
      console.log(`\n${known.length} known failure(s), listed in e2e/known-failures.json (not passes):`);
    for (const name of known) console.log(`  ~ ${name}`);
    if (fixed.length) {
      console.log(`\n${fixed.length} listed test(s) now pass. Remove them from e2e/known-failures.json:`);
      for (const name of fixed) console.log(`  ✖ remove from known-failures: ${name}`);
      return { status: 'failed' };
    }
    if (result.status === 'failed' && known.length && !unlisted) return { status: 'passed' };
    return undefined;
  }
}
