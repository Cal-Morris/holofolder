import data from './known-failures.json';

/** A test that already fails on a clean main. See the rules in known-failures.json and the writing-e2e-tests skill. */
export type KnownFailure = {
  file: string;
  /** Describe titles, then the test title. */
  title: string[];
  /** Only these projects fail; omitted means every project the test runs on. */
  projects?: string[];
  cause: 'stale-selector-or-flow' | 'harness-or-fixture' | 'flaky' | 'environment' | 'app-bug';
  batch: 1 | 2 | 3;
  failure: string;
};

const entries = new Map(
  (data.tests as KnownFailure[]).map((entry) => [[entry.file, ...entry.title].join(' › '), entry]),
);

/** The entry for a test, by its spec file (relative to e2e/) and title path, if it is listed for this project. */
export function knownFailure(file: string, title: string[], project: string) {
  const entry = entries.get([file, ...title].join(' › '));
  return entry && (!entry.projects || entry.projects.includes(project)) ? entry : undefined;
}
