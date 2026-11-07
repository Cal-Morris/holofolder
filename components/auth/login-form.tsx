'use client'

import { getMagicLinkRedirectUrl, getPasswordRecoveryRedirectUrl } from '@/lib/auth-redirects'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useEffect, useState, useSyncExternalStore } from 'react'
import { Mail, Loader2, KeyRound } from 'lucide-react'
import { useRouter } from 'next/navigation'
import styles from './login.module.css'

type AuthMethod = 'magic-link' | 'password'
type PasswordMode = 'sign-in' | 'sign-up'
type SuccessState = 'magic-link' | 'password-signup' | 'password-reset' | null

// supabase-js is only needed once the visitor submits, so it loads then instead of with the page.
async function createClient() {
  const { createClient: createBrowserClient } = await import('@/lib/supabase/client')
  return createBrowserClient()
}

// Read ?mode=recovery after hydration rather than with useSearchParams(), which would make the
// prerendered page a client-only spinner. The static HTML is the normal sign-in form.
const subscribeToNothing = () => () => {}
const readRecoveryMode = () => new URLSearchParams(window.location.search).get('mode') === 'recovery'
const serverRecoveryMode = () => false

export function LoginForm() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [success, setSuccess] = useState<SuccessState>(null)
  const [authMethod, setAuthMethod] = useState<AuthMethod>('magic-link')
  const [passwordMode, setPasswordMode] = useState<PasswordMode>('sign-in')
  const [hasRecoverySession, setHasRecoverySession] = useState(false)
  const [isCheckingRecoverySession, setIsCheckingRecoverySession] = useState(false)

  const router = useRouter()
  const recoveryMode = useSyncExternalStore(subscribeToNothing, readRecoveryMode, serverRecoveryMode)

  useEffect(() => {
    if (!recoveryMode) return

    const checkRecoverySession = async () => {
      setIsCheckingRecoverySession(true)
      const supabase = await createClient().catch(() => null)
      const { data, error } = supabase
        ? await supabase.auth.getUser()
        : { data: { user: null }, error: new Error('Could not reach the sign-in service.') }

      if (error || !data.user) {
        setError('This password recovery link is invalid or has expired.')
      } else {
        setHasRecoverySession(true)
        setError(null)
      }

      setIsCheckingRecoverySession(false)
    }

    checkRecoverySession()
  }, [recoveryMode])

  const resetState = () => {
    setError(null)
    setSuccess(null)
    setPassword('')
    setConfirmPassword('')
  }

  const handleMagicLink = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsLoading(true)
    setError(null)

    try {
      const supabase = await createClient()
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: {
          emailRedirectTo: getMagicLinkRedirectUrl(),
        },
      })

      if (error) throw error
      setSuccess('magic-link')
    } catch (error: unknown) {
      setError(error instanceof Error ? error.message : 'An error occurred')
    } finally {
      setIsLoading(false)
    }
  }

  const handlePasswordAuth = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsLoading(true)
    setError(null)

    try {
      const supabase = await createClient()
      if (passwordMode === 'sign-up') {
        if (password.length < 8) {
          throw new Error('Password must be at least 8 characters.')
        }

        if (password !== confirmPassword) {
          throw new Error('Passwords do not match.')
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
          router.push('/')
          router.refresh()
          return
        }

        setSuccess('password-signup')
        return
      }

      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      })

      if (error) throw error
      router.push('/')
      router.refresh()
    } catch (error: unknown) {
      setError(error instanceof Error ? error.message : 'Authentication failed')
    } finally {
      setIsLoading(false)
    }
  }

  const handlePasswordReset = async () => {
    if (!email) {
      setError('Enter your email address first.')
      return
    }

    setIsLoading(true)
    setError(null)

    try {
      const supabase = await createClient()
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: getPasswordRecoveryRedirectUrl(),
      })

      if (error) throw error
      setSuccess('password-reset')
    } catch (error: unknown) {
      setError(error instanceof Error ? error.message : 'Could not send a password reset link.')
    } finally {
      setIsLoading(false)
    }
  }

  const handleRecoverySubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (password.length < 8) {
      setError('Password must be at least 8 characters.')
      return
    }

    if (password !== confirmPassword) {
      setError('Passwords do not match.')
      return
    }

    setIsLoading(true)
    setError(null)

    try {
      const supabase = await createClient()
      const { error } = await supabase.auth.updateUser({
        password,
      })

      if (error) throw error

      router.push('/')
      router.refresh()
    } catch (error: unknown) {
      setError(error instanceof Error ? error.message : 'Could not update your password.')
    } finally {
      setIsLoading(false)
    }
  }

  const successTitle =
    success === 'password-reset'
      ? 'Check your email'
      : success === 'password-signup'
        ? 'Confirm your email'
        : 'Check your email'

  const successMessage =
    success === 'password-reset'
      ? 'We sent you a password reset link.'
      : success === 'password-signup'
        ? 'We sent you a confirmation link to finish creating your account.'
        : 'We sent you a magic link to sign in.'

  return (
    <>
      <div className={styles.header}>
        <h1 className={styles.heading}>
          {recoveryMode ? 'Set a new password' : success ? successTitle : 'Sign in to Holo Folder'}
        </h1>
        <p className={styles.intro}>
          {recoveryMode
            ? 'Choose a password for your Holo Folder account.'
            : success
              ? successMessage
              : 'Use a magic link or sign in with a password.'}
        </p>
      </div>

      <div className={styles.body}>
        {recoveryMode ? (
          <form onSubmit={handleRecoverySubmit} className="space-y-4">
            {error && (
              <div className="p-3 bg-destructive/10 border border-destructive/20 rounded-xl text-destructive text-sm text-center">
                {error}
              </div>
            )}

            {isCheckingRecoverySession ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
              </div>
            ) : hasRecoverySession ? (
              <>
                <div className="relative">
                  <KeyRound className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    type="password"
                    aria-label="New password"
                    autoComplete="new-password"
                    placeholder="New password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="pl-11 h-12 rounded-xl bg-muted/50 border-border/50 focus:bg-background transition-colors"
                    autoFocus
                  />
                </div>

                <div className="relative">
                  <KeyRound className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    type="password"
                    aria-label="Confirm new password"
                    autoComplete="new-password"
                    placeholder="Confirm new password"
                    required
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    className="pl-11 h-12 rounded-xl bg-muted/50 border-border/50 focus:bg-background transition-colors"
                  />
                </div>

                <Button
                  type="submit"
                  className="w-full h-12 rounded-xl font-semibold text-base"
                  disabled={isLoading}
                >
                  {isLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Save new password'}
                </Button>
              </>
            ) : null}
          </form>
        ) : success ? (
          <div className="space-y-4">
            <div className="p-5 bg-primary/5 border border-primary/10 rounded-xl text-center">
              <Mail className="w-10 h-10 text-primary mx-auto mb-3" />
              <p className="text-sm text-muted-foreground">
                {success === 'password-reset'
                  ? 'Open the reset email and choose a new password.'
                  : success === 'password-signup'
                    ? 'Open the confirmation email to finish setting up password sign-in.'
                    : 'Click the link in your email to sign in. You can close this window.'}
              </p>
            </div>
            <Button
              variant="outline"
              className="w-full h-12 rounded-xl"
              onClick={() => {
                resetState()
                setEmail('')
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

            <div className="grid grid-cols-2 gap-2 p-1 bg-muted/50 rounded-xl">
              <button
                type="button"
                onClick={() => {
                  resetState()
                  setAuthMethod('magic-link')
                }}
                className={`flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-medium transition-all ${
                  authMethod === 'magic-link'
                    ? 'bg-primary/15 text-primary shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                <Mail className="w-4 h-4" />
                Email
              </button>
              <button
                type="button"
                onClick={() => {
                  resetState()
                  setAuthMethod('password')
                }}
                className={`flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-medium transition-all ${
                  authMethod === 'password'
                    ? 'bg-primary/15 text-primary shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                <KeyRound className="w-4 h-4" />
                Password
              </button>
            </div>

            {authMethod === 'magic-link' ? (
              <form onSubmit={handleMagicLink} className="space-y-4">
                <div className="relative">
                  <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    type="email"
                    aria-label="Email address"
                    autoComplete="email"
                    placeholder="you@example.com"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="pl-11 h-12 rounded-xl bg-muted/50 border-border/50 focus:bg-background transition-colors"
                    autoFocus
                  />
                </div>

                <Button
                  type="submit"
                  className="w-full h-12 rounded-xl font-semibold text-base"
                  disabled={isLoading}
                >
                  {isLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Send magic link'}
                </Button>

                <p className="text-xs text-center text-muted-foreground pt-2">
                  No password needed. We&apos;ll email you a secure link.
                </p>
              </form>
            ) : (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-2 p-1 bg-muted/50 rounded-xl">
                  <button
                    type="button"
                    onClick={() => {
                      setPasswordMode('sign-in')
                      setError(null)
                    }}
                    className={`py-2 rounded-lg text-sm font-medium transition-all ${
                      passwordMode === 'sign-in'
                        ? 'bg-primary/15 text-primary shadow-sm'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    Sign in
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setPasswordMode('sign-up')
                      setError(null)
                    }}
                    className={`py-2 rounded-lg text-sm font-medium transition-all ${
                      passwordMode === 'sign-up'
                        ? 'bg-primary/15 text-primary shadow-sm'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    Create account
                  </button>
                </div>

                <form onSubmit={handlePasswordAuth} className="space-y-4">
                  <div className="relative">
                    <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <Input
                      type="email"
                      aria-label="Email address"
                      autoComplete="email"
                      placeholder="you@example.com"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="pl-11 h-12 rounded-xl bg-muted/50 border-border/50 focus:bg-background transition-colors"
                      autoFocus
                    />
                  </div>

                  <div className="relative">
                    <KeyRound className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <Input
                      type="password"
                      aria-label={passwordMode === 'sign-in' ? 'Password' : 'Create a password'}
                      autoComplete={passwordMode === 'sign-in' ? 'current-password' : 'new-password'}
                      placeholder={passwordMode === 'sign-in' ? 'Password' : 'Create a password'}
                      required
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="pl-11 h-12 rounded-xl bg-muted/50 border-border/50 focus:bg-background transition-colors"
                    />
                  </div>

                  {passwordMode === 'sign-up' && (
                    <div className="relative">
                      <KeyRound className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                      <Input
                        type="password"
                        aria-label="Confirm password"
                        autoComplete="new-password"
                        placeholder="Confirm password"
                        required
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        className="pl-11 h-12 rounded-xl bg-muted/50 border-border/50 focus:bg-background transition-colors"
                      />
                    </div>
                  )}

                  <Button
                    type="submit"
                    className="w-full h-12 rounded-xl font-semibold text-base"
                    disabled={isLoading}
                  >
                    {isLoading ? (
                      <Loader2 className="w-5 h-5 animate-spin" />
                    ) : passwordMode === 'sign-in' ? (
                      'Sign in with password'
                    ) : (
                      'Create password account'
                    )}
                  </Button>
                </form>

                {passwordMode === 'sign-in' && (
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
                  {passwordMode === 'sign-in'
                    ? 'Your usual password, straight to your collection.'
                    : 'Keep your collection together with a Holo Folder account.'}
                </p>
              </div>
            )}
          </div>
        )}
      </div>
    </>
  )
}
