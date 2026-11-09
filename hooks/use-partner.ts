"use client"

import { clearActivityCache } from "@/lib/collection-activity"

import { useState, useEffect, useCallback } from "react"
import { createClient } from "@/lib/supabase/client"
import type { User } from "@supabase/supabase-js"

async function changePartner(action: string, input: Record<string, unknown> = {}) {
  const response = await fetch('/app/api/partners', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, ...input }) })
  const result = await response.json()
  if (!response.ok) throw new Error(result.error?.message ?? 'Could not update the partnership.')
}

export interface Partner {
  id: string
  email: string
  partneredAt: string
}

export interface PartnerInvite {
  id: string
  inviterEmail?: string
  inviteeEmail?: string
  status: string
  createdAt: string
}

interface UsePartnerOptions {
  user: User | null
}

export function usePartner({ user }: UsePartnerOptions) {
  const [partner, setPartner] = useState<Partner | null>(null)
  const [pendingInvites, setPendingInvites] = useState<PartnerInvite[]>([])
  const [receivedInvites, setReceivedInvites] = useState<PartnerInvite[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const supabase = createClient()

  const loadPartnerData = useCallback(async (currentUser: User | null) => {
    if (!currentUser) {
      setPartner(null)
      setPendingInvites([])
      setReceivedInvites([])
      setError(null)
      setIsLoading(false)
      return
    }

    setIsLoading(true)
    setError(null)
    try {
      // Load partnerships
      const { data: partnership, error: partnershipError } = await supabase
        .from("partnerships")
        .select("*")
        .or(`user1_id.eq.${currentUser.id},user2_id.eq.${currentUser.id}`)
        .limit(1)
        .maybeSingle()

      if (partnershipError) {
        throw partnershipError
      }

      if (partnership) {
        const partnerId = partnership.user1_id === currentUser.id ? partnership.user2_id : partnership.user1_id
        const currentUserIsInviter = partnership.owner_user_id === currentUser.id
        let partnerEmail = "Partner"

        if (currentUserIsInviter) {
          const { data: acceptedInvite, error: inviteLookupError } = await supabase
            .from("partner_invites")
            .select("invitee_email")
            .eq("inviter_id", currentUser.id)
            .eq("status", "accepted")
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle()

          if (inviteLookupError) {
            throw inviteLookupError
          }

          partnerEmail = acceptedInvite?.invitee_email || partnerEmail
        } else {
          const { data: acceptedInvite, error: inviteLookupError } = await supabase
            .from("partner_invites")
            .select("inviter_email")
            .eq("invitee_email", currentUser.email ?? "")
            .eq("status", "accepted")
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle()

          if (inviteLookupError) {
            throw inviteLookupError
          }

          partnerEmail = acceptedInvite?.inviter_email || partnerEmail
        }

        setPartner({
          id: partnerId,
          email: partnerEmail,
          partneredAt: partnership.created_at,
        })
      } else {
        setPartner(null)
      }

      // Load pending invites received
      if (currentUser.email) {
        const { data: received } = await supabase
          .from("partner_invites")
          .select("*")
          .eq("invitee_email", currentUser.email)
          .eq("status", "pending")

        setReceivedInvites(
          (received || []).map((i) => ({
            id: i.id,
            inviterEmail: i.inviter_email || "User",
            status: i.status,
            createdAt: i.created_at,
          }))
        )
      } else {
        setReceivedInvites([])
      }

      // Load sent invites
      const { data: sent } = await supabase
        .from("partner_invites")
        .select("*")
        .eq("inviter_id", currentUser.id)
        .eq("status", "pending")

      setPendingInvites(
        (sent || []).map((i) => ({
          id: i.id,
          inviteeEmail: i.invitee_email,
          status: i.status,
          createdAt: i.created_at,
        }))
      )
    } catch (err) {
      console.error("[v0] Error loading partner data:", err)
      setError(err instanceof Error ? err.message : "Could not load partner data.")
    } finally {
      setIsLoading(false)
    }
  }, [supabase])

  useEffect(() => {
    void loadPartnerData(user)
  }, [loadPartnerData, user])

  const sendInvite = useCallback(async (email: string) => {
    if (!user) return { error: "Not logged in" }

    try {
      await changePartner('invite', { email })
      await loadPartnerData(user)
      return { success: true }
    } catch (err: unknown) {
      return { error: err instanceof Error ? err.message : "Could not update the partnership." }
    }
  }, [user, loadPartnerData])

  const acceptInvite = useCallback(async (inviteId: string) => {
    if (!user) return { error: "Not logged in" }

    try {
      await changePartner('accept', { inviteId })
      await loadPartnerData(user)
      return { success: true }
    } catch (err: unknown) {
      return { error: err instanceof Error ? err.message : "Could not update the partnership." }
    }
  }, [user, loadPartnerData])

  const rejectInvite = useCallback(async (inviteId: string) => {
    if (!user) return { error: "Not logged in" }

    try {
      await changePartner('reject', { inviteId })
      await loadPartnerData(user)
      return { success: true }
    } catch (err: unknown) {
      return { error: err instanceof Error ? err.message : "Could not update the partnership." }
    }
  }, [user, loadPartnerData])

  const removePartner = useCallback(async () => {
    if (!user || !partner) return { error: "No partner to remove" }

    try {
      await changePartner('disconnect')
      clearActivityCache(window.localStorage)
      setPartner(null)
      return { success: true }
    } catch (err: unknown) {
      return { error: err instanceof Error ? err.message : "Could not update the partnership." }
    }
  }, [user, partner])

  return {
    partner,
    pendingInvites,
    receivedInvites,
    isLoading,
    error,
    sendInvite,
    acceptInvite,
    rejectInvite,
    removePartner,
    refresh: () => loadPartnerData(user),
  }
}
