"use client"

import { useState, useEffect, useCallback } from "react"
import { Fingerprint, Plus, Trash2, Loader2, CheckCircle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { startRegistration, browserSupportsWebAuthn } from "@simplewebauthn/browser"
import type { User } from "@supabase/supabase-js"

const PASSKEY_REQUEST_TIMEOUT_MS = 10000

interface Passkey {
  id: string
  device_type: string
  created_at: string
}

interface PasskeySettingsProps {
  user: User | null
}

export default function PasskeySettings({ user }: PasskeySettingsProps) {
  const [passkeys, setPasskeys] = useState<Passkey[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isRegistering, setIsRegistering] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [supportsPasskey, setSupportsPasskey] = useState(false)
  const userId = user?.id ?? null

  useEffect(() => {
    setSupportsPasskey(browserSupportsWebAuthn())
  }, [])

  const fetchPasskeyJson = useCallback(async (url: string, init: RequestInit = {}) => {
    const controller = new AbortController()
    const timeoutId = window.setTimeout(() => controller.abort(), PASSKEY_REQUEST_TIMEOUT_MS)

    try {
      const response = await fetch(url, {
        ...init,
        cache: "no-store",
        credentials: "same-origin",
        signal: controller.signal,
      })
      const payload = await response.json().catch(() => null)

      if (!response.ok) {
        throw new Error(typeof payload?.error === "string" ? payload.error : `Request failed (${response.status})`)
      }

      return payload
    } finally {
      window.clearTimeout(timeoutId)
    }
  }, [])

  const loadPasskeys = useCallback(async (currentUserId: string | null) => {
    if (!currentUserId) {
      setPasskeys([])
      setError(null)
      setIsLoading(false)
      return
    }

    setIsLoading(true)
    setError(null)
    try {
      const payload = await fetchPasskeyJson("/api/auth/passkey/credentials")
      setPasskeys(Array.isArray(payload?.passkeys) ? payload.passkeys : [])
    } catch (err) {
      console.error("[binderdex] Error loading passkeys:", err)
      setError("Could not load your passkeys.")
    } finally {
      setIsLoading(false)
    }
  }, [fetchPasskeyJson])

  useEffect(() => {
    void loadPasskeys(userId)
  }, [loadPasskeys, userId])

  const handleRegisterPasskey = async () => {
    setIsRegistering(true)
    setError(null)
    setSuccess(false)

    try {
      // Get registration options from server
      const optionsRes = await fetchPasskeyJson("/api/auth/passkey/register/options", {
        method: "POST",
      })

      // Start WebAuthn registration
      const credential = await startRegistration({ optionsJSON: optionsRes })

      // Verify with server
      await fetchPasskeyJson("/api/auth/passkey/register/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          credential: {
            id: credential.id,
            rawId: credential.rawId,
            response: {
              attestationObject: credential.response.attestationObject,
              clientDataJSON: credential.response.clientDataJSON,
              publicKey: credential.response.publicKey,
              transports: credential.response.transports,
            },
            type: credential.type,
            authenticatorAttachment: credential.authenticatorAttachment,
          },
        }),
      })

      setSuccess(true)
      await loadPasskeys(userId)
      setTimeout(() => setSuccess(false), 3000)
    } catch (err: unknown) {
      if (err instanceof Error && err.name === "NotAllowedError") {
        setError("Registration was cancelled")
      } else if (err instanceof Error && err.name === "InvalidStateError") {
        setError("This passkey is already registered")
      } else {
        setError(err instanceof Error ? err.message : "Failed to register passkey")
      }
    } finally {
      setIsRegistering(false)
    }
  }

  const handleDeletePasskey = async (id: string) => {
    try {
      await fetchPasskeyJson(`/api/auth/passkey/credentials?id=${encodeURIComponent(id)}`, {
        method: "DELETE",
      })
      setPasskeys(prev => prev.filter(p => p.id !== id))
    } catch (err) {
      console.error("[binderdex] Error deleting passkey:", err)
      setError("Could not delete that passkey.")
    }
  }

  if (!supportsPasskey) {
    return (
      <div className="p-4 bg-muted/50 rounded-xl text-sm text-muted-foreground">
        Passkeys are not supported on this device or browser.
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Fingerprint className="w-5 h-5 text-primary" />
          <span className="font-medium">Passkeys</span>
        </div>
        <Button
          size="sm"
          onClick={handleRegisterPasskey}
          disabled={isRegistering}
          className="gap-1.5"
        >
          {isRegistering ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : success ? (
            <CheckCircle className="w-4 h-4" />
          ) : (
            <Plus className="w-4 h-4" />
          )}
          {success ? "Added!" : "Add Passkey"}
        </Button>
      </div>

      {error && (
        <p className="text-sm text-destructive">{error}</p>
      )}

      {!user ? (
        <p className="text-sm text-muted-foreground py-2">
          Sign in to register and manage passkeys.
        </p>
      ) : isLoading ? (
        <div className="flex items-center justify-center py-4">
          <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
        </div>
      ) : passkeys.length === 0 ? (
        <p className="text-sm text-muted-foreground py-2">
          No passkeys registered. Add one for faster sign-in.
        </p>
      ) : (
        <div className="space-y-2">
          {passkeys.map((passkey) => (
            <div
              key={passkey.id}
              className="flex items-center justify-between p-3 bg-muted/50 rounded-xl"
            >
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
                  <Fingerprint className="w-4 h-4 text-primary" />
                </div>
                <div>
                  <p className="text-sm font-medium capitalize">
                    {passkey.device_type || "Passkey"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Added {new Date(passkey.created_at).toLocaleDateString()}
                  </p>
                </div>
              </div>
              <button
                onClick={() => handleDeletePasskey(passkey.id)}
                className="p-2 rounded-lg hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        Use Face ID, Touch ID, or Windows Hello to sign in without email.
      </p>
    </div>
  )
}
