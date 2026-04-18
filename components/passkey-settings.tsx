"use client"

import { useState, useEffect } from "react"
import { Fingerprint, Plus, Trash2, Loader2, CheckCircle } from "lucide-react"
import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import { startRegistration, browserSupportsWebAuthn } from "@simplewebauthn/browser"

interface Passkey {
  id: string
  device_type: string
  created_at: string
}

export default function PasskeySettings() {
  const [passkeys, setPasskeys] = useState<Passkey[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isRegistering, setIsRegistering] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [supportsPasskey, setSupportsPasskey] = useState(false)

  const supabase = createClient()

  useEffect(() => {
    setSupportsPasskey(browserSupportsWebAuthn())
    loadPasskeys()
  }, [])

  const loadPasskeys = async () => {
    try {
      const { data, error } = await supabase
        .from("passkey_credentials")
        .select("id, device_type, created_at")
        .order("created_at", { ascending: false })

      if (error) throw error
      setPasskeys(data || [])
    } catch (err) {
      console.error("[v0] Error loading passkeys:", err)
    } finally {
      setIsLoading(false)
    }
  }

  const handleRegisterPasskey = async () => {
    setIsRegistering(true)
    setError(null)
    setSuccess(false)

    try {
      // Get registration options from server
      const optionsRes = await fetch("/api/auth/passkey/register/options", {
        method: "POST",
      })
      
      if (!optionsRes.ok) throw new Error("Failed to get registration options")
      const options = await optionsRes.json()

      // Start WebAuthn registration
      const credential = await startRegistration({
        challenge: options.challenge,
        rp: options.rp,
        user: options.user,
        pubKeyCredParams: options.pubKeyCredParams,
        timeout: options.timeout,
        attestation: options.attestation,
        excludeCredentials: options.excludeCredentials,
        authenticatorSelection: options.authenticatorSelection,
      })

      // Verify with server
      const verifyRes = await fetch("/api/auth/passkey/register/verify", {
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

      if (!verifyRes.ok) {
        const data = await verifyRes.json()
        throw new Error(data.error || "Registration failed")
      }

      setSuccess(true)
      loadPasskeys()
      setTimeout(() => setSuccess(false), 3000)
    } catch (err: any) {
      if (err.name === "NotAllowedError") {
        setError("Registration was cancelled")
      } else if (err.name === "InvalidStateError") {
        setError("This passkey is already registered")
      } else {
        setError(err.message || "Failed to register passkey")
      }
    } finally {
      setIsRegistering(false)
    }
  }

  const handleDeletePasskey = async (id: string) => {
    try {
      const { error } = await supabase
        .from("passkey_credentials")
        .delete()
        .eq("id", id)

      if (error) throw error
      setPasskeys(prev => prev.filter(p => p.id !== id))
    } catch (err) {
      console.error("[v0] Error deleting passkey:", err)
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

      {isLoading ? (
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
