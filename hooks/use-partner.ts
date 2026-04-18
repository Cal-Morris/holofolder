"use client"

import { useState, useEffect, useCallback } from "react"
import { createClient } from "@/lib/supabase/client"
import type { User } from "@supabase/supabase-js"

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

export function usePartner() {
  const [user, setUser] = useState<User | null>(null)
  const [partner, setPartner] = useState<Partner | null>(null)
  const [pendingInvites, setPendingInvites] = useState<PartnerInvite[]>([])
  const [receivedInvites, setReceivedInvites] = useState<PartnerInvite[]>([])
  const [isLoading, setIsLoading] = useState(true)

  const supabase = createClient()

  const loadPartnerData = useCallback(async (currentUser: User | null) => {
    if (!currentUser) {
      setPartner(null)
      setPendingInvites([])
      setReceivedInvites([])
      setIsLoading(false)
      return
    }

    setIsLoading(true)
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
        setPartner({
          id: partnerId,
          email: "Partner",
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
    } finally {
      setIsLoading(false)
    }
  }, [supabase])

  useEffect(() => {
    const loadUserAndPartnerData = async () => {
      const { data: { user: currentUser } } = await supabase.auth.getUser()
      setUser(currentUser)
      await loadPartnerData(currentUser)
    }

    loadUserAndPartnerData()

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_event, session) => {
      const currentUser = session?.user ?? null
      setUser(currentUser)
      await loadPartnerData(currentUser)
    })

    return () => subscription.unsubscribe()
  }, [loadPartnerData, supabase])

  const sendInvite = useCallback(async (email: string) => {
    if (!user) return { error: "Not logged in" }

    try {
      const { error } = await supabase.from("partner_invites").insert({
        inviter_id: user.id,
        invitee_email: email,
        status: "pending",
      })

      if (error) throw error
      await loadPartnerData(user)
      return { success: true }
    } catch (err: any) {
      return { error: err.message }
    }
  }, [user, supabase, loadPartnerData])

  const acceptInvite = useCallback(async (inviteId: string) => {
    if (!user) return { error: "Not logged in" }

    try {
      const { data: invite } = await supabase
        .from("partner_invites")
        .select("*")
        .eq("id", inviteId)
        .single()

      if (!invite) throw new Error("Invite not found")

      // Create partnership
      await supabase.from("partnerships").insert({
        user1_id: invite.inviter_id,
        user2_id: user.id,
      })

      // Update invite status
      await supabase
        .from("partner_invites")
        .update({ status: "accepted" })
        .eq("id", inviteId)

      await loadPartnerData(user)
      return { success: true }
    } catch (err: any) {
      return { error: err.message }
    }
  }, [user, supabase, loadPartnerData])

  const rejectInvite = useCallback(async (inviteId: string) => {
    if (!user) return { error: "Not logged in" }

    try {
      await supabase
        .from("partner_invites")
        .update({ status: "rejected" })
        .eq("id", inviteId)

      await loadPartnerData(user)
      return { success: true }
    } catch (err: any) {
      return { error: err.message }
    }
  }, [user, supabase, loadPartnerData])

  const removePartner = useCallback(async () => {
    if (!user || !partner) return { error: "No partner to remove" }

    try {
      await supabase
        .from("partnerships")
        .delete()
        .or(`user1_id.eq.${user.id},user2_id.eq.${user.id}`)

      setPartner(null)
      return { success: true }
    } catch (err: any) {
      return { error: err.message }
    }
  }, [user, partner, supabase])

  return {
    partner,
    pendingInvites,
    receivedInvites,
    isLoading,
    sendInvite,
    acceptInvite,
    rejectInvite,
    removePartner,
    refresh: () => loadPartnerData(user),
  }
}
