"use client"

import { useState } from "react"
import { X, UserPlus, Users, Check, XIcon, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { usePartner } from "@/hooks/use-partner"
import type { User } from "@supabase/supabase-js"

interface PartnerModalProps {
  isOpen: boolean
  onClose: () => void
  user: User | null
}

export default function PartnerModal({ isOpen, onClose, user }: PartnerModalProps) {
  const [email, setEmail] = useState("")
  const [isSending, setIsSending] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const { 
    partner, 
    pendingInvites, 
    receivedInvites, 
    sendInvite, 
    acceptInvite, 
    rejectInvite,
    error,
    removePartner,
    isLoading 
  } = usePartner({ user })

  const handleSendInvite = async () => {
    if (!email.trim()) return
    setIsSending(true)
    setActionError(null)
    const result = await sendInvite(email.trim())
    if (result.error) {
      setActionError(result.error)
    } else {
      setEmail("")
    }
    setIsSending(false)
  }

  const handleAcceptInvite = async (inviteId: string) => {
    setActionError(null)
    const result = await acceptInvite(inviteId)
    if (result.error) setActionError(result.error)
  }

  const handleRejectInvite = async (inviteId: string) => {
    setActionError(null)
    const result = await rejectInvite(inviteId)
    if (result.error) setActionError(result.error)
  }

  const handleRemovePartner = async () => {
    setActionError(null)
    const result = await removePartner()
    if (result.error) setActionError(result.error)
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-card border border-border rounded-xl shadow-2xl w-full max-w-md mx-4 max-h-[80vh] overflow-hidden">
        <div className="flex items-center justify-between p-4 border-b border-border">
          <div className="flex items-center gap-2">
            <Users className="w-5 h-5 text-primary" />
            <h2 className="text-lg font-semibold">Partner Mode</h2>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-muted rounded-lg transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 space-y-6 overflow-y-auto max-h-[60vh]">
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          ) : error ? (
            <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-4">
              <p className="text-sm font-medium text-destructive">Could not load partner mode.</p>
              <p className="mt-1 text-sm text-muted-foreground">{error}</p>
            </div>
          ) : !user ? (
            <div className="rounded-lg border border-border bg-muted/40 p-4">
              <p className="text-sm font-medium">Sign in to use partner mode.</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Partner invites and shared collections are only available for signed-in users.
              </p>
            </div>
          ) : (
            <>
              {actionError && (
                <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-4">
                  <p className="text-sm text-destructive">{actionError}</p>
                </div>
              )}
              {partner ? (
                <div className="bg-primary/10 border border-primary/20 rounded-lg p-4">
                  <p className="text-sm text-muted-foreground mb-1">Currently partnered with</p>
                  <p className="font-medium text-primary">{partner.email}</p>
                  <p className="text-xs text-muted-foreground mt-2">
                    You can both view and manage the same Pokemon collection.
                  </p>
                  <Button variant="outline" size="sm" className="mt-3" onClick={handleRemovePartner}>
                    Remove partner
                  </Button>
                </div>
              ) : (
                <>
                  <div>
                    <label className="text-sm font-medium mb-2 block">Invite a Partner</label>
                    <p className="text-xs text-muted-foreground mb-3">
                      Share your Pokedex collection with someone. You&apos;ll both be able to mark Pokemon as collected.
                    </p>
                    <div className="flex gap-2">
                      <Input
                        type="email"
                        placeholder="partner@email.com"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && handleSendInvite()}
                        className="flex-1"
                      />
                      <Button onClick={handleSendInvite} disabled={isSending || !email.trim()}>
                        {isSending ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserPlus className="w-4 h-4" />}
                      </Button>
                    </div>
                  </div>

                  {pendingInvites.length > 0 && (
                    <div>
                      <label className="text-sm font-medium mb-2 block">Pending Invites</label>
                      <div className="space-y-2">
                        {pendingInvites.map((invite) => (
                          <div key={invite.id} className="flex items-center justify-between bg-muted/50 rounded-lg p-3">
                            <span className="text-sm">{invite.inviteeEmail || "Unknown"}</span>
                            <span className="text-xs text-muted-foreground">Waiting...</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {receivedInvites.length > 0 && (
                    <div>
                      <label className="text-sm font-medium mb-2 block">Received Invites</label>
                      <div className="space-y-2">
                        {receivedInvites.map((invite) => (
                          <div key={invite.id} className="flex items-center justify-between bg-muted/50 rounded-lg p-3">
                            <span className="text-sm">From: {invite.inviterEmail || "Unknown"}</span>
                            <div className="flex gap-1">
                              <Button size="sm" variant="ghost" onClick={() => handleAcceptInvite(invite.id)}>
                                <Check className="w-4 h-4 text-green-500" />
                              </Button>
                              <Button size="sm" variant="ghost" onClick={() => handleRejectInvite(invite.id)}>
                                <XIcon className="w-4 h-4 text-red-500" />
                              </Button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
