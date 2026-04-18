function withNoVerifySslMode(connectionString: string) {
  const separator = connectionString.includes("?") ? "&" : "?"
  if (connectionString.includes("sslmode=")) {
    return connectionString.replace(/sslmode=([^&]+)/, "sslmode=no-verify")
  }
  return `${connectionString}${separator}sslmode=no-verify`
}

const postgresUrl = process.env.WORKFLOW_POSTGRES_URL || process.env.POSTGRES_URL_NON_POOLING

if (!process.env.WORKFLOW_TARGET_WORLD) {
  process.env.WORKFLOW_TARGET_WORLD = "@workflow/world-postgres"
}

if (!process.env.WORKFLOW_POSTGRES_URL && postgresUrl) {
  process.env.WORKFLOW_POSTGRES_URL = withNoVerifySslMode(postgresUrl)
}

if (!process.env.WORKFLOW_POSTGRES_JOB_PREFIX) {
  process.env.WORKFLOW_POSTGRES_JOB_PREFIX = "binderdex"
}

export async function register() {
  if (process.env.NEXT_RUNTIME !== "edge") {
    const { getWorld } = await import("workflow/runtime")
    await getWorld().start?.()
  }
}
