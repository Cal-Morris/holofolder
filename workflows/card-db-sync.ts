export async function syncCardDbWorkflow(triggeredBy: string) {
  "use workflow"

  return await runCardDbSyncStep(triggeredBy)
}

async function runCardDbSyncStep(triggeredBy: string) {
  "use step"

  const { runCardDbSync } = await import("@/lib/card-db-sync")

  return await runCardDbSync({
    logger: (message) => {
      console.log(`[workflow][card-db-sync][${triggeredBy}] ${message}`)
    },
  })
}
