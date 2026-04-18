"use client"

import { useState, useEffect } from "react"
import { X, Loader2, Mail, Sparkles, Fingerprint } from "lucide-react"
import { createClient } from "@/lib/supabase/client"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { startRegistration, startAuthentication, browserSupportsWebAuthn } from "@simplewebauthn/browser"

interface AuthModalProps {
  isOpen: boolean
  onClose: () => void
}

export default function AuthModal({ isOpen, onClose }: AuthModalProps) {
  const [email, setEmail] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [supportsPasskey, setSupportsPasskey] = useState(false)
  const [authMethod, setAuthMethod] = useState<"passkey" | "email">("passkey")

  const supabase = createClient()

  useEffect(() => {
    const supported = browserSupportsWebAuthn()
    setSupportsPasskey(supported)
    if (!supported) {
      setAuthMethod("email")
    }
  }, [])

  const getRedirectUrl = () => {
    // Always use production URL for magic links
    return "https://binder.cal.gg/auth/callback"
  }

  const handleEmailSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsLoading(true)
    setError(null)

    try {
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: {
          emailRedirectTo: getRedirectUrl(),
        },
      })
      if (error) throw error
      setSuccess(true)
    } catch (err: any) {
      setError(err.message || "An error occurred")
    } finally {
      setIsLoading(false)
    }
  }

  const handlePasskeyLogin = async () => {
    setIsLoading(true)
    setError(null)

    try {
      // Get authentication options from server
      const optionsRes = await fetch("/api/auth/passkey/authenticate/options", {
        method: "POST",
      })
      
      if (!optionsRes.ok) throw new Error("Failed to get authentication options")
      const options = await optionsRes.json()

      // Start WebAuthn authentication
      const credential = await startAuthentication({
        challenge: options.challenge,
        rpId: options.rpId,
        timeout: options.timeout,
        userVerification: options.userVerification,
        allowCredentials: options.allowCredentials,
      })

      // Verify with server
      const verifyRes = await fetch("/api/auth/passkey/authenticate/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          credential: {
            id: credential.id,
            rawId: credential.rawId,
            response: {
              authenticatorData: credential.response.authenticatorData,
              clientDataJSON: credential.response.clientDataJSON,
              signature: credential.response.signature,
            },
            type: credential.type,
          },
          sessionId: options.sessionId,
        }),
      })

      if (!verifyRes.ok) {
        const data = await verifyRes.json()
        throw new Error(data.error || "Authentication failed")
      }

      const result = await verifyRes.json()
      
      // Use the token to sign in
      if (result.token && result.email) {
        const { error } = await supabase.auth.verifyOtp({
          email: result.email,
          token: result.token,
          type: "magiclink",
        })
        if (error) throw error
      }

      onClose()
      window.location.reload()
    } catch (err: any) {
      if (err.name === "NotAllowedError") {
        setError("Authentication was cancelled")
      } else if (err.message?.includes("not found") || err.message?.includes("No passkey")) {
        setError("No passkey found. Sign in with email first, then add a passkey in settings.")
        setAuthMethod("email")
      } else {
        setError(err.message || "Passkey authentication failed")
      }
    } finally {
      setIsLoading(false)
    }
  }

  if (!isOpen) return null

  return (
    <div 
      className="fixed inset-0 bg-black/70 backdrop-blur-md flex items-center justify-center z-50 p-4"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="bg-card border border-border/50 rounded-2xl w-full max-w-sm overflow-hidden animate-scale-in shadow-2xl">
        {/* Header with gradient */}
        <div className="relative p-6 pb-4">
          <div className="absolute inset-0 bg-gradient-to-b from-primary/10 to-transparent" />
          <button
            onClick={onClose}
            className="absolute top-4 right-4 p-2 rounded-full hover:bg-muted/50 transition-colors"
          >
            <X className="w-4 h-4 text-muted-foreground" />
          </button>
          
          <div className="relative flex flex-col items-center text-center">
            <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-primary to-primary/60 flex items-center justify-center mb-4 shadow-lg shadow-primary/20">
              <Sparkles className="w-7 h-7 text-primary-foreground" />
            </div>
            <h2 className="text-2xl font-bold tracking-tight">
              {success ? "Check your email" : "Welcome"}
            </h2>
            <p className="text-sm text-muted-foreground mt-1">
              {success 
                ? "We sent you a magic link to sign in" 
                : "Sign in to sync your collection across devices"
              }
            </p>
          </div>
        </div>

        {/* Content */}
        <div className="px-6 pb-6">
          {success ? (
            <div className="space-y-4">
              <div className="p-4 bg-primary/5 border border-primary/10 rounded-xl text-center">
                <Mail className="w-8 h-8 text-primary mx-auto mb-2" />
                <p className="text-sm text-muted-foreground">
                  Click the link in your email to sign in. You can close this window.
                </p>
              </div>
              <Button 
                variant="outline" 
                className="w-full" 
                onClick={() => {
                  setSuccess(false)
                  setEmail("")
                }}
              >
                Use a different email
              </Button>
            </div>
          ) : (
            <div className="space-y-4">
              {error && (
                <div className="p-3 bg-destructive/10 border border-destructive/20 rounded-xl text-destructive text-sm text-center">
                  {error}
                </div>
              )}

              {/* Auth Method Toggle */}
              {supportsPasskey && (
                <div className="grid grid-cols-2 gap-2 p-1 bg-muted/50 rounded-xl">
                  <button
                    type="button"
                    onClick={() => setAuthMethod("passkey")}
                    className={`flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-medium transition-all ${
                      authMethod === "passkey"
                        ? "bg-background text-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    <Fingerprint className="w-4 h-4" />
                    Passkey
                  </button>
                  <button
                    type="button"
                    onClick={() => setAuthMethod("email")}
                    className={`flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-medium transition-all ${
                      authMethod === "email"
                        ? "bg-background text-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    <Mail className="w-4 h-4" />
                    Email
                  </button>
                </div>
              )}

              {authMethod === "passkey" && supportsPasskey ? (
                <div className="space-y-4">
                  <Button 
                    type="button"
                    onClick={handlePasskeyLogin}
                    className="w-full h-12 rounded-xl font-semibold text-base shadow-lg shadow-primary/20 hover:shadow-primary/30 transition-shadow" 
                    disabled={isLoading}
                  >
                    {isLoading ? (
                      <Loader2 className="w-5 h-5 animate-spin" />
                    ) : (
                      <>
                        <Fingerprint className="w-5 h-5 mr-2" />
                        Sign in with Passkey
                      </>
                    )}
                  </Button>
                  <p className="text-xs text-center text-muted-foreground">
                    Use Face ID, Touch ID, or Windows Hello to sign in instantly.
                  </p>
                </div>
              ) : (
                <form onSubmit={handleEmailSubmit} className="space-y-4">
                  <div className="space-y-2">
                    <div className="relative">
                      <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                      <Input
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="you@example.com"
                        className="pl-10 h-12 rounded-xl bg-muted/50 border-border/50 focus:bg-background transition-colors"
                        required
                        autoFocus
                      />
                    </div>
                  </div>

                  <Button 
                    type="submit" 
                    className="w-full h-12 rounded-xl font-semibold text-base shadow-lg shadow-primary/20 hover:shadow-primary/30 transition-shadow" 
                    disabled={isLoading}
                  >
                    {isLoading ? (
                      <Loader2 className="w-5 h-5 animate-spin" />
                    ) : (
                      "Send magic link"
                    )}
                  </Button>

                  <p className="text-xs text-center text-muted-foreground">
                    No password needed. We&apos;ll email you a secure link.
                  </p>
                </form>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
