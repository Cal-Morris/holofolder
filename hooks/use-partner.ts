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
  inviterEmail: string
  status: string
  createdAt: string
}

export function usePartner(user: User | null) {
  const [partner, setPartner] = useState<Partner | null>(null)
  const [pendingInvites, setPendingInvites] = useState<PartnerInvite[]>([])
  const [sentInvites, setSentInvites] = useState<PartnerInvite[]>([])
  const [isLoading, setIsLoading] = useState(true)

  const supabase = createClient()

  const loadPartnerData = useCallback(async () => {
    if (!user) {
      setPartner(null)
      setPendingInvites([])
      setSentInvites([])
      setIsLoading(false)
      return
    }

    setIsLoading(true)
    try {
      // Load partnerships
      const { data: partnerships } = await supabase
        .from("partnerships")
        .select("*")
        .or(`user1_id.eq.${user.id},user2_id.eq.${user.id}`)
        .limit(1)
        .single()

      if (partnerships) {
        const partnerId = partnerships.user1_id === user.id ? partnerships.user2_id : partnerships.user1_id
        const { data: partnerUser } = await supabase.auth.admin?.getUserById?.(partnerId) || {}
        setPartner({
          id: partnerId,
          email: partnerUser?.user?.email || "Partner",
          partneredAt: partnerships.created_at,
        })
      } else {
        setPartner(null)
      }

      // Load pending invites received
      const { data: received } = await supabase
        .from("partner_invites")
        .select("*")
        .eq("invitee_email", user.email)
        .eq("status", "pending")

      setPendingInvites(
        (received || []).map((i) => ({
          id: i.id,
          inviterEmail: "User",
          status: i.status,
          createdAt: i.created_at,
        }))
      )

      // Load sent invites
      const { data: sent } = await supabase
        .from("partner_invites")
        .select("*")
        .eq("inviter_id", user.id)

      setSentInvites(
        (sent || []).map((i) => ({
          id: i.id,
          inviterEmail: i.invitee_email,
          status: i.status,
          createdAt: i.created_at,
        }))
      )
    } catch (err) {
      console.error("[v0] Error loading partner data:", err)
    } finally {
      setIsLoading(false)
    }
  }, [user, supabase])

  useEffect(() => {
    loadPartnerData()
  }, [loadPartnerData])

  const sendInvite = useCallback(async (email: string) => {
    if (!user) return { error: "Not logged in" }

    try {
      const { error } = await supabase.from("partner_invites").insert({
        inviter_id: user.id,
        invitee_email: email,
        status: "pending",
      })

      if (error) throw error
      await loadPartnerData()
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

      await loadPartnerData()
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

      await loadPartnerData()
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
    sentInvites,
    isLoading,
    sendInvite,
    acceptInvite,
    rejectInvite,
    removePartner,
    refresh: loadPartnerData,
  }
}
