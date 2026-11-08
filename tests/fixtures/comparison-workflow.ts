import assert from "node:assert/strict"

async function run() {
  // Synthetic workflow storage and devices; no provider/network work.
  // @ts-expect-error Bun mocks stay isolated in this subprocess.
  const { mock } = await import("bun:test")
  const job = { id: "synthetic-job", status: "queued", targets: Array.from({ length: 65 }, (_, i) => ({ cardId: `synthetic-${i}`, language: "en", finish: "normal" })), progress: { total: 65, done: 0, fresh: 0, checked: 0, failed: 0, stopped: {} } }
  let checked = 0
  const sent: string[] = []
  mock.module("workflow", () => ({ getWorkflowMetadata: () => ({ workflowRunId: "synthetic-run" }), getStepMetadata: () => ({ attempt: 1 }), RetryableError: Error }))
  mock.module("../../lib/server/comparison-jobs", () => ({
    readComparisonJob: async () => job,
    comparisonJobActive: async () => ["queued", "running"].includes(job.status),
    checkComparisonTarget: async () => { checked++; return { result: "checked", stopped: {} } },
  }))
  mock.module("../../lib/server/comparison-push", () => ({
    comparisonCompletionDevices: async () => { assert.equal(job.status, "completed"); assert.equal(job.progress.done, 65); return ["good-device", "unavailable-device"] },
    sendComparisonCompletion: async (_jobId: string, device: string) => { sent.push(device); if (device === "unavailable-device") throw new Error("Synthetic push service failure") },
  }))
  mock.module("../../lib/supabase/admin", () => ({ createAdminClient: () => ({ from: () => {
    let patch = {}, states: string[] | null = null
    const query = {
      update: (value: object) => { patch = value; return query }, eq: () => query,
      in: (_key: string, value: string[]) => { states = value; return query }, select: () => query,
      then: (resolve: (value: unknown) => unknown) => {
        const matches = !states || states.includes(job.status)
        if (matches) Object.assign(job, patch)
        return Promise.resolve(resolve({ data: matches ? [{ id: job.id }] : [], error: null }))
      },
    }
    return query
  } }) }))
  const { comparisonChecksWorkflow } = await import("../../workflows/comparison-checks")
  assert.deepEqual(await comparisonChecksWorkflow(job.id), { notificationsFailed: 1 })
  assert.equal(checked, 65)
  assert.equal(job.status, "completed", "notification failures cannot roll back completed checks")
  assert.deepEqual(sent, ["good-device", "unavailable-device"])
  await comparisonChecksWorkflow(job.id)
  assert.equal(sent.length, 2, "an already-completed job cannot send another completion")
  job.status = "cancelled"
  job.progress = { total: 65, done: 0, fresh: 0, checked: 0, failed: 0, stopped: {} }
  await comparisonChecksWorkflow(job.id)
  assert.equal(checked, 65)
  assert.equal(sent.length, 2, "cancelled jobs do not send completion pushes")
}
void run().catch(error => { console.error(error); process.exitCode = 1 })
