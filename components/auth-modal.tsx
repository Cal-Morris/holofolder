"use client"

import { useState, useEffect, useRef } from "react"
import { useOverlay } from "@/hooks/use-overlay"
import { X, Loader2, Mail, Sparkles, KeyRound } from "lucide-react"
import { createClient } from "@/lib/supabase/client"
import { getMagicLinkRedirectUrl, getPasswordRecoveryRedirectUrl } from "@/lib/auth-redirects"
import { PasskeySignIn } from "@/components/passkey-sign-in"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"

interface AuthModalProps {
  isOpen: boolean
  initialMode?: PasswordMode
  onClose: () => void
}

type AuthMethod = "magic-link" | "password"
type PasswordMode = "sign-in" | "sign-up"
type SuccessState = "magic-link" | "password-signup" | "password-reset" | null

export default function AuthModal({ isOpen, initialMode = "sign-in", onClose }: AuthModalProps) {
  const dialogRef = useRef<HTMLDivElement | null>(null)
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<SuccessState>(null)
  const [authMethod, setAuthMethod] = useState<AuthMethod>("password")
  const [passwordMode, setPasswordMode] = useState<PasswordMode>(initialMode)

  const supabase = createClient()

  useEffect(() => {
    if (!isOpen) return
    setError(null)
    setSuccess(null)
    setIsLoading(false)
    setAuthMethod("password")
    setPasswordMode(initialMode)
  }, [isOpen, initialMode])

  const closeAndReload = () => {
    onClose()
    window.location.reload()
  }

  const handleMagicLinkSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsLoading(true)
    setError(null)

    try {
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: {
          emailRedirectTo: getMagicLinkRedirectUrl(),
          shouldCreateUser: true,
        },
      })

      if (error) throw error
      setSuccess("magic-link")
    } catch (err: any) {
      setError(err.message || "An error occurred")
    } finally {
      setIsLoading(false)
    }
  }

  const handlePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsLoading(true)
    setError(null)

    try {
      if (passwordMode === "sign-up") {
        if (password.length < 8) {
          throw new Error("Password must be at least 8 characters.")
        }

        if (password !== confirmPassword) {
          throw new Error("Passwords do not match.")
        }

        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: getMagicLinkRedirectUrl(),
          },
        })

        if (error) throw error

        if (data.session) {
          closeAndReload()
          return
        }

        setSuccess("password-signup")
        return
      }

      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      })

      if (error) throw error
      closeAndReload()
    } catch (err: any) {
      setError(err.message || "Authentication failed")
    } finally {
      setIsLoading(false)
    }
  }

  const handlePasswordReset = async () => {
    if (!email) {
      setError("Enter your email address first.")
      return
    }

    setIsLoading(true)
    setError(null)

    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: getPasswordRecoveryRedirectUrl(),
      })

      if (error) throw error
      setSuccess("password-reset")
    } catch (err: any) {
      setError(err.message || "Could not send a password reset link.")
    } finally {
      setIsLoading(false)
    }
  }

  const resetAuthState = () => {
    setSuccess(null)
    setError(null)
    setPassword("")
    setConfirmPassword("")
  }

  useOverlay(isOpen, onClose, { containerRef: dialogRef, autoFocus: false })

  if (!isOpen) return null

  const successTitle =
    success === "password-reset"
      ? "Check your email"
      : success === "password-signup"
        ? "Confirm your email"
        : "Check your email"

  const successMessage =
    success === "password-reset"
      ? "We sent you a password reset link."
      : success === "password-signup"
        ? "We sent you a confirmation link to finish creating your account."
        : "We sent you a secure link to open your binder."

  const isSignUp = authMethod === "password" && passwordMode === "sign-up"

  return (
    <div
      data-overlay-backdrop
      className="fixed inset-0 z-50 bg-black/70 backdrop-blur-md"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-label={success ? successTitle : isSignUp ? "Create account" : "Welcome, sign in"} className="absolute inset-x-3 top-[calc(var(--top-inset)+0.5rem)] bottom-[calc(var(--safe-bottom)+1rem)] mx-auto flex w-auto max-w-sm flex-col overflow-hidden rounded-[2.25rem] border border-border/50 bg-card/95 shadow-2xl backdrop-blur-xl animate-slide-up sm:inset-auto sm:left-1/2 sm:top-1/2 sm:max-h-[min(85vh,44rem)] sm:w-full sm:-translate-x-1/2 sm:-translate-y-1/2">
        <div className="relative shrink-0 px-6 pt-6 pb-4 sm:px-6 sm:pt-6 sm:pb-4">
          <div className="absolute inset-0 bg-gradient-to-b from-primary/10 to-transparent" />
          <button
            onClick={onClose}
            aria-label={isSignUp ? "Close create account" : "Close sign in"}
            className="absolute top-4 right-4 z-10 flex h-10 w-10 items-center justify-center rounded-full hover:bg-muted/60 transition-colors"
          >
            <X className="w-4 h-4 text-muted-foreground" />
          </button>

          <div className="relative flex flex-col items-center text-center">
            <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-primary to-primary/60 flex items-center justify-center mb-4 shadow-lg shadow-primary/20">
              <Sparkles className="w-7 h-7 text-primary-foreground" />
            </div>
            <h2 className="text-2xl font-bold tracking-tight">
              {success ? successTitle : isSignUp ? "Create account" : authMethod === "magic-link" ? "Start your binder" : "Welcome"}
            </h2>
            <p className="text-sm text-muted-foreground mt-1">
              {success ? successMessage : isSignUp ? "Start your own binder and sync it across devices" : authMethod === "magic-link" ? "Create an account or sign in with your email" : "Sign in to sync your collection across devices"}
            </p>
          </div>
        </div>

        <div
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 pb-6"
          style={{
            WebkitOverflowScrolling: "touch",
            touchAction: "pan-y",
          }}
        >
          {success ? (
            <div className="space-y-4">
              <div className="rounded-2xl border border-primary/10 bg-primary/5 p-4 text-center">
                <Mail className="w-8 h-8 text-primary mx-auto mb-2" />
                <p className="text-sm text-muted-foreground">
                  {success === "password-reset"
                    ? "Open the reset email and choose a new password."
                    : success === "password-signup"
                      ? "Open the confirmation email to finish setting up password sign-in."
                      : "Open the link to finish creating your account or sign in. You can close this window."}
                </p>
              </div>
              <Button
                variant="outline"
                className="w-full"
                onClick={() => {
                  resetAuthState()
                  setEmail("")
                }}
              >
                Use a different email
              </Button>
            </div>
          ) : (
            <div className="space-y-4">
              {error && (
                <div className="rounded-2xl border border-destructive/20 bg-destructive/10 p-3 text-center text-sm text-destructive">
                  {error}
                </div>
              )}

              <div className="grid grid-cols-2 gap-2 rounded-2xl bg-muted/50 p-1">
                <button
                  type="button"
                  onClick={() => {
                    resetAuthState()
                    setAuthMethod("magic-link")
                  }}
                  className={`flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-medium transition-all ${
                    authMethod === "magic-link"
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <Mail className="w-4 h-4" />
                  Email
                </button>
                <button
                  type="button"
                  onClick={() => {
                    resetAuthState()
                    setAuthMethod("password")
                  }}
                  className={`flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-medium transition-all ${
                    authMethod === "password"
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <KeyRound className="w-4 h-4" />
                  Password
                </button>
              </div>

              {authMethod === "magic-link" ? (
                <form onSubmit={handleMagicLinkSubmit} className="space-y-4">
                  <div className="space-y-2">
                    <div className="relative">
                      <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                      <Input
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="you@example.com"
                        className="h-12 rounded-2xl border-border/50 bg-muted/50 pl-10 transition-colors focus:bg-background"
                        required
                        autoFocus
                      />
                    </div>
                  </div>

                  <Button
                    type="submit"
                    className="h-12 w-full rounded-2xl font-semibold text-base shadow-lg shadow-primary/20 transition-shadow hover:shadow-primary/30"
                    disabled={isLoading}
                  >
                    {isLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : "Continue with email"}
                  </Button>

                  <p className="text-xs text-center text-muted-foreground">
                    New here? We’ll create your account. Already collecting? We’ll sign you in.
                  </p>
                </form>
              ) : (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-2 rounded-2xl bg-muted/50 p-1">
                    <button
                      type="button"
                      onClick={() => {
                        setPasswordMode("sign-in")
                        setError(null)
                      }}
                      className={`py-2 rounded-lg text-sm font-medium transition-all ${
                        passwordMode === "sign-in"
                          ? "bg-background text-foreground shadow-sm"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      Sign in
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setPasswordMode("sign-up")
                        setError(null)
                      }}
                      className={`py-2 rounded-lg text-sm font-medium transition-all ${
                        passwordMode === "sign-up"
                          ? "bg-background text-foreground shadow-sm"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      Create account
                    </button>
                  </div>

                  <form onSubmit={handlePasswordSubmit} className="space-y-3">
                    <div className="relative">
                      <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                      <Input
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="you@example.com"
                        className="h-12 rounded-2xl border-border/50 bg-muted/50 pl-10 transition-colors focus:bg-background"
                        required
                        autoFocus
                      />
                    </div>
                    <div className="relative">
                      <KeyRound className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                      <Input
                        type="password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder={passwordMode === "sign-in" ? "Password" : "Create a password"}
                        className="h-12 rounded-2xl border-border/50 bg-muted/50 pl-10 transition-colors focus:bg-background"
                        required
                      />
                    </div>
                    {passwordMode === "sign-up" && (
                      <div className="relative">
                        <KeyRound className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                        <Input
                          type="password"
                          value={confirmPassword}
                          onChange={(e) => setConfirmPassword(e.target.value)}
                          placeholder="Confirm password"
                          className="h-12 rounded-2xl border-border/50 bg-muted/50 pl-10 transition-colors focus:bg-background"
                          required
                        />
                      </div>
                    )}

                    <Button
                      type="submit"
                      className="h-12 w-full rounded-2xl font-semibold text-base shadow-lg shadow-primary/20 transition-shadow hover:shadow-primary/30"
                      disabled={isLoading}
                    >
                      {isLoading ? (
                        <Loader2 className="w-5 h-5 animate-spin" />
                      ) : passwordMode === "sign-in" ? (
                        "Sign in with password"
                      ) : (
                        "Create password account"
                      )}
                    </Button>
                  </form>

                  {passwordMode === "sign-in" && (
                    <Button
                      type="button"
                      variant="ghost"
                      className="w-full"
                      onClick={handlePasswordReset}
                      disabled={isLoading}
                    >
                      Email me a reset link
                    </Button>
                  )}

                  <p className="text-xs text-center text-muted-foreground">
                    {passwordMode === "sign-in"
                      ? "Use this if magic links are throttled or you want a normal sign-in."
                      : "We may email you a link to confirm your account."}
                  </p>
                </div>
              )}
              {!isSignUp && <PasskeySignIn disabled={isLoading} onSuccess={closeAndReload} />}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
