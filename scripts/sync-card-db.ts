import { loadProjectEnvFiles, runCardDbSync } from "../lib/card-db-sync"

async function main() {
  await loadProjectEnvFiles()
  await runCardDbSync()
}

main().catch((error) => {
  console.error("[sync-card-db] Sync failed:", error)
  process.exitCode = 1
})
