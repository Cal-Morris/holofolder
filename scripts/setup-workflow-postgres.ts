import { spawn } from "node:child_process"
import { getWorkflowPostgresUrl, loadProjectEnvFiles } from "../lib/card-db-sync"

async function main() {
  await loadProjectEnvFiles()

  const env = {
    ...process.env,
    WORKFLOW_TARGET_WORLD: "@workflow/world-postgres",
    WORKFLOW_POSTGRES_URL: getWorkflowPostgresUrl(),
  }

  await new Promise<void>((resolve, reject) => {
    const child = spawn("npx", ["workflow-postgres-setup"], {
      stdio: "inherit",
      env,
    })

    child.on("error", reject)
    child.on("close", (code) => {
      if (code === 0) {
        resolve()
        return
      }

      reject(new Error(`workflow-postgres-setup exited with code ${code}`))
    })
  })
}

main().catch((error) => {
  console.error("[workflow-postgres-setup] Setup failed:", error)
  process.exitCode = 1
})
