import { NextRequest, NextResponse } from "next/server"
import { getRun, start } from "workflow/api"
import { syncCardDbWorkflow } from "@/workflows/card-db-sync"

export const runtime = "nodejs"

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

function isAuthorized(request: NextRequest) {
  const configuredSecret = process.env.CARD_DB_SYNC_SECRET

  if (!configuredSecret) {
    return process.env.NODE_ENV !== "production"
  }

  const authorization = request.headers.get("authorization")
  const bearerToken = authorization?.startsWith("Bearer ") ? authorization.slice("Bearer ".length) : null
  const headerSecret = request.headers.get("x-card-db-sync-secret")

  return bearerToken === configuredSecret || headerSecret === configuredSecret
}

export async function POST(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const body = await request.json().catch(() => ({}))
  const triggeredBy =
    typeof body?.triggeredBy === "string" && body.triggeredBy.trim().length > 0
      ? body.triggeredBy.trim()
      : "api"

  try {
    const run = await start(syncCardDbWorkflow, [triggeredBy])

    return NextResponse.json(
      {
        runId: run.runId,
        message: "Card database sync queued",
      },
      { status: 202 },
    )
  } catch (error) {
    console.error("[binderdex] Failed to start card DB sync workflow:", error)
    return NextResponse.json({ error: "Failed to start card DB sync workflow" }, { status: 500 })
  }
}

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const runId = request.nextUrl.searchParams.get("runId")
  if (!runId) {
    return NextResponse.json({ error: "runId is required" }, { status: 400 })
  }

  try {
    const run = getRun(runId)

    if (!(await run.exists)) {
      return NextResponse.json({ error: "Workflow run not found" }, { status: 404 })
    }

    const status = await run.status
    const response: Record<string, unknown> = {
      runId,
      workflowName: await run.workflowName,
      status,
      createdAt: (await run.createdAt).toISOString(),
      startedAt: (await run.startedAt)?.toISOString() ?? null,
      completedAt: (await run.completedAt)?.toISOString() ?? null,
    }

    if (status === "completed") {
      response.result = await run.returnValue
    }

    return NextResponse.json(response)
  } catch (error) {
    console.error("[binderdex] Failed to read card DB sync workflow:", error)
    return NextResponse.json({ error: "Failed to read card DB sync workflow" }, { status: 500 })
  }
}
