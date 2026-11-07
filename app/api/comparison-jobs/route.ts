import { preferManagedVercelWorkflowWorld } from "@/lib/server/workflow-world"
import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { getSessionUser } from "@/lib/supabase/session-user"
import { resolveCollectionOwnerUserId } from "@/lib/server/collection-owner"
import { requirePaidAccess, billingErrorResponse } from "@/lib/server/billing"
import { isBillingError } from "@/lib/billing"
import { requireAppearanceOrigin, AppearanceError } from "@/lib/server/binder-appearance"
import { normalizeComparisonTargets } from "@/lib/comparison-jobs"
import { comparisonScopeKey, estimateComparisonSpend, initialComparisonProgress, publicComparisonJob, readComparisonJob, type StoredComparisonJob } from "@/lib/server/comparison-jobs"

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "private, no-store" } })
async function owner(write: boolean) {
  preferManagedVercelWorkflowWorld()
  const client = await createClient()
  const user = write ? (await client.auth.getUser()).data.user : await getSessionUser(client)
  if (!user) throw new AppearanceError("Sign in to check prices.", 401)
  const ownerId = await resolveCollectionOwnerUserId(client, user.id)
  await requirePaidAccess(ownerId)
  return ownerId
}
function failure(error: unknown) {
  if (error instanceof AppearanceError) return json({ error: error.message }, error.status)
  if (isBillingError(error)) return billingErrorResponse(error)
  console.error("[holofolder] Comparison job unavailable", error)
  return json({ error: "Background checks are temporarily unavailable. Saved checks are safe." }, 503)
}
export async function GET(request: Request) {
  try {
    const ownerId = await owner(false)
    const id = new URL(request.url).searchParams.get("id")
    if (!id || !/^[0-9a-f-]{36}$/.test(id)) return json({ error: "Invalid job." }, 400)
    let job = await readComparisonJob(id, ownerId)
    if (!job) return json({ error: "Job not found." }, 404)
    if ((job.status === "queued" || job.status === "running") && job.run_id) {
      const { getRun } = await import("workflow/api")
      const status = await getRun(job.run_id).status
      if (status === "failed" || status === "cancelled") {
        const { error } = await createAdminClient().from("comparison_jobs").update({ status }).eq("id", id).eq("owner_user_id", ownerId).in("status", ["queued", "running"])
        if (error) throw error
        job = { ...job, status }
      }
    }
    return json({ job: publicComparisonJob(job) })
  } catch (error) { return failure(error) }
}
export async function POST(request: Request) {
  try {
    requireAppearanceOrigin(request)
    const text = await request.text()
    if (text.length > 1_000_000) return json({ error: "Too many cards." }, 413)
    let body
    try { body = JSON.parse(text) } catch { return json({ error: "Invalid request." }, 400) }
    const ownerId = await owner(body?.action !== "inspect")
    const admin = createAdminClient()
    if (body?.action === "stop") {
      if (typeof body.id !== "string" || !/^[0-9a-f-]{36}$/.test(body.id)) return json({ error: "Invalid job." }, 400)
      const job = await readComparisonJob(body.id, ownerId)
      if (!job) return json({ error: "Job not found." }, 404)
      const { error } = await admin.from("comparison_jobs").update({ status: "cancelled" }).eq("id", job.id).eq("owner_user_id", ownerId).in("status", ["queued", "running"])
      if (error) throw error
      if (job.run_id && (job.status === "queued" || job.status === "running")) { const { getRun } = await import("workflow/api"); await getRun(job.run_id).cancel() }
      return json({ job: publicComparisonJob((await readComparisonJob(job.id, ownerId))!) })
    }
    if (body?.action !== "inspect" && body?.action !== "start") return json({ error: "Invalid action." }, 400)
    const targets = normalizeComparisonTargets(body.cards)
    if (!targets) return json({ error: "Invalid comparison cards." }, 400)
    const scopeKey = comparisonScopeKey(targets)
    const { data: existing, error: readError } = await admin.from("comparison_jobs").select("*").eq("owner_user_id", ownerId).eq("scope_key", scopeKey).in("status", ["queued", "running"]).maybeSingle()
    if (readError) throw readError
    if (existing) {
      if (existing.status === "queued" && !existing.run_id && Date.parse(existing.created_at) < Date.now() - 120_000) {
        const { error: staleError } = await admin.from("comparison_jobs").update({ status: "failed" }).eq("id", existing.id).eq("owner_user_id", ownerId).eq("status", "queued").is("run_id", null)
        if (staleError) throw staleError
      } else return json({ job: publicComparisonJob(existing as StoredComparisonJob) })
    }
    const needed = await estimateComparisonSpend(targets)
    if (body.action === "inspect") {
      const { data: latest, error: latestError } = await admin.from("comparison_jobs").select("*").eq("owner_user_id", ownerId).eq("scope_key", scopeKey).order("created_at", { ascending: false }).limit(1).maybeSingle()
      if (latestError) throw latestError
      return json({ job: latest ? publicComparisonJob(latest as StoredComparisonJob) : null, needed })
    }
    if (needed >= 15 && body.confirmed !== true) return json({ needsConfirmation: true, needed }, 409)
    const { data: inserted, error } = await admin.from("comparison_jobs").insert({ owner_user_id: ownerId, scope_key: scopeKey, targets, progress: initialComparisonProgress(targets.length) }).select("*").single()
    if (error?.code === "23505") {
      const { data: active, error: activeError } = await admin.from("comparison_jobs").select("*").eq("owner_user_id", ownerId).eq("scope_key", scopeKey).in("status", ["queued", "running"]).single()
      if (activeError) throw activeError
      return json({ job: publicComparisonJob(active as StoredComparisonJob) })
    }
    if (error) throw error
    const job = inserted as StoredComparisonJob
    try {
      const [{ start }, { comparisonChecksWorkflow }] = await Promise.all([import("workflow/api"), import("@/workflows/comparison-checks")])
      const run = await start(comparisonChecksWorkflow, [job.id])
      const { error: saveError } = await admin.from("comparison_jobs").update({ run_id: run.runId }).eq("id", job.id).eq("owner_user_id", ownerId)
      if (saveError) throw saveError
    } catch (error) {
      await admin.from("comparison_jobs").update({ status: "failed" }).eq("id", job.id).eq("owner_user_id", ownerId).eq("status", "queued")
      throw error
    }
    return json({ job: publicComparisonJob(job) }, 202)
  } catch (error) { return failure(error) }
}
