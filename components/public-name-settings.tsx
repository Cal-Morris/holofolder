"use client"

import { useEffect, useId, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { buildNamedBinderSharePath, normalizeBinderSlug, normalizeUsername, suggestBinderSlug } from "@/lib/public-binder-identity"

interface PublicNameSettingsProps {
  kind: "account" | "binder"
  binderId?: string | null
  binderName?: string
  isOnline: boolean
  onSaved: () => void
}

type SavedIdentity = { current: string | null; username: string | null; available: boolean; canEdit: boolean }

export function PublicNameSettings(props: PublicNameSettingsProps) {
  return <PublicNameForm key={`${props.kind}:${props.binderId ?? ""}:${props.binderName ?? ""}:${props.isOnline}`} {...props} />
}

function PublicNameForm({ kind, binderId, binderName = "", isOnline, onSaved }: PublicNameSettingsProps) {
  const id = useId()
  const account = kind === "account"
  const endpoint = account ? "/app/api/account-identity" : `/app/api/binder-identity?binderId=${encodeURIComponent(binderId ?? "")}`
  const normalize = account ? normalizeUsername : normalizeBinderSlug
  const saveController = useRef<AbortController | null>(null)
  const [saved, setSaved] = useState<SavedIdentity | null>(null)
  const [value, setValue] = useState("")
  const [loading, setLoading] = useState(account || Boolean(binderId))
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    const controller = new AbortController()
    if (!account && !binderId) return () => controller.abort()
    async function load() {
      try {
        const response = await fetch(endpoint, { cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(8000)]) })
        const payload = await response.json()
        if (!response.ok) throw new Error(payload?.error || "Could not load your public address.")
        if (controller.signal.aborted) return
        const current = account ? normalizeUsername(payload?.username) : normalizeBinderSlug(payload?.slug)
        setSaved({ current, username: normalizeUsername(payload?.username), available: payload?.available === true, canEdit: account || payload?.canEdit === true })
        setValue(current ?? (account ? "" : suggestBinderSlug(binderName)))
      } catch (error) {
        if (!controller.signal.aborted) { setFailed(true); setMessage(error instanceof Error ? error.message : "Could not load your public address.") }
      } finally { if (!controller.signal.aborted) setLoading(false) }
    }
    void load()
    return () => { controller.abort(); saveController.current?.abort() }
  }, [account, binderId, binderName, endpoint, isOnline])

  const chosen = normalize(value)
  const changed = Boolean(chosen && chosen !== saved?.current)
  const disabled = loading || saving || !isOnline || !saved?.available || !saved.canEdit
  async function save() {
    if (disabled || !chosen || !changed) return
    const controller = new AbortController()
    saveController.current = controller
    setSaving(true)
    setMessage(null)
    setFailed(false)
    try {
      const response = await fetch(endpoint, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(account ? { username: chosen } : { binderId, slug: chosen }),
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]),
      })
      const payload = await response.json()
      if (controller.signal.aborted) return
      if (!response.ok) throw new Error(payload?.error || "Could not save your public address.")
      const current = account ? normalizeUsername(payload?.username) : normalizeBinderSlug(payload?.slug)
      if (!current) throw new Error("Could not confirm the saved address. Reopen Settings to check it.")
      setSaved({ current, username: normalizeUsername(payload?.username), canEdit: true, available: true })
      setValue(current)
      setMessage(account ? "Username saved." : "Binder address saved.")
      onSaved()
    } catch (error) { if (!controller.signal.aborted) { setFailed(true); setMessage(error instanceof Error ? error.message : "Could not save your public address.") } }
    finally { if (!controller.signal.aborted) setSaving(false) }
  }

  return (
    <section className="holo-panel space-y-3 rounded-3xl border border-border/60 p-4" aria-label={account ? "Public username" : "Binder address"}>
      <div>
        <h3 className="font-semibold">{account ? "Public username" : "Binder address"}</h3>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{account ? "Your account's name in public binder links. Each shared binder uses its owner's username." : "Give this binder a short address. Renaming the binder later won't change this."}</p>
      </div>
      <label htmlFor={id} className="block text-sm font-medium">{account ? "Username" : "Binder slug"}</label>
      <div className="flex items-center gap-2">
        {account && <span aria-hidden className="text-muted-foreground">@</span>}
        <Input id={id} value={value} onChange={event => setValue(event.target.value)} disabled={disabled} autoCapitalize="none" autoCorrect="off" spellCheck={false} maxLength={account ? 30 : 60} placeholder={account ? "cal" : "national"} aria-describedby={`${id}-help`} />
        <Button onClick={() => void save()} disabled={disabled || !changed} className="min-h-10">{saving ? "Saving…" : "Save"}</Button>
      </div>
      <p id={`${id}-help`} className="text-xs text-muted-foreground">{account ? "3–30" : "1–60"} letters, numbers or hyphens. Start and end with a letter or number.</p>
      {saved?.current && changed && <p className="text-xs text-muted-foreground">{account ? "Changing your username breaks previous named links for every shared binder." : "Changing the slug breaks this binder's previous named link."} The old name stays reserved to you.</p>}
      {!account && saved?.username && saved.current && <p className="break-all text-xs text-primary">holofolder.com{buildNamedBinderSharePath(saved.username, saved.current)}</p>}
      {!account && <p className="text-xs text-muted-foreground">{saved?.available && !saved.canEdit ? "Only the binder owner can change this address. " : ""}{saved?.available && !saved.username ? "Set your account username first to use a named link. " : ""}Sharing must be enabled for this address to work.</p>}
      {loading && <p role="status" className="text-xs text-muted-foreground">Loading address…</p>}
      {saved && !saved.available && <p className="text-xs text-muted-foreground">Named links are not available yet. Your existing share link still works.</p>}
      {!account && !binderId && <p className="text-xs text-muted-foreground">Open a named binder to set its address.</p>}
      {!isOnline && <p className="text-xs text-muted-foreground">Connect to the internet to save your public address.</p>}
      {message && <p role={failed ? "alert" : "status"} className="text-xs text-muted-foreground">{message}</p>}
    </section>
  )
}
