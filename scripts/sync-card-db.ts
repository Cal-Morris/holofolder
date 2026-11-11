import { runCardDbSync } from '../lib/card-db-sync';
import { loadProjectEnvFiles } from '../lib/load-project-env';

async function main() {
  await loadProjectEnvFiles();
  await runCardDbSync({
    dryRun: process.argv.includes('--dry-run'),
  });
}

main().catch((error) => {
  console.error('[sync-card-db] Sync failed:', error);
  process.exitCode = 1;
});
