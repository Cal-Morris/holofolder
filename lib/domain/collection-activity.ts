export type ActivityState = Record<string, unknown>
export type ActivityChange = { table: string; id: string; before: ActivityState | null; after: ActivityState | null }
export type ActivityEvent = {
  id: string; recorded_at: string; format_version: number; actor_kind: string; actor_user_id?: string | null
  actor_job?: string | null; source: string; client_id?: string | null; action: string
  operation_id?: string | null; batch_id?: string | null; client_occurred_at?: string | null; recovery_of_event_id?: string | null
  affected_entities: Record<string, string[]>; changes: ActivityChange[]
}
export type ActivityPage = { data: ActivityEvent[]; nextCursor: string | null }
export type ActivityScope = { accountId: string; ownerId: string; membershipKey: string; memberIds?: string[] }
