'use client'

import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useState } from 'react'
import { Mail, Sparkles, Loader2, ArrowLeft } from 'lucide-react'
import Link from 'next/link'

export default function Page() {
  const [email, setEmail] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [success, setSuccess] = useState(false)

  const getRedirectUrl = () => {
    // Always use production URL for magic links
    return "https://binder.cal.gg/auth/callback"
  }

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    const supabase = createClient()
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
    } catch (error: unknown) {
      setError(error instanceof Error ? error.message : 'An error occurred')
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="min-h-svh w-full flex flex-col items-center justify-center p-6 bg-background">
      <div className="w-full max-w-sm">
        <Link 
          href="/"
          className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground mb-8 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Binder
        </Link>

        <div className="bg-card border border-border/50 rounded-2xl overflow-hidden shadow-xl">
          <div className="relative p-8 pb-6">
            <div className="absolute inset-0 bg-gradient-to-b from-primary/10 to-transparent" />
            
            <div className="relative flex flex-col items-center text-center">
              <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-primary to-primary/60 flex items-center justify-center mb-5 shadow-lg shadow-primary/20">
                <Sparkles className="w-8 h-8 text-primary-foreground" />
              </div>
              <h1 className="text-2xl font-bold tracking-tight">
                {success ? "Check your email" : "Sign in to Binder"}
              </h1>
              <p className="text-sm text-muted-foreground mt-2">
                {success 
                  ? "We sent you a magic link to sign in" 
                  : "Enter your email to receive a magic link"
                }
              </p>
            </div>
          </div>

          <div className="px-8 pb-8">
            {success ? (
              <div className="space-y-4">
                <div className="p-5 bg-primary/5 border border-primary/10 rounded-xl text-center">
                  <Mail className="w-10 h-10 text-primary mx-auto mb-3" />
                  <p className="text-sm text-muted-foreground">
                    Click the link in your email to sign in. You can close this window.
                  </p>
                </div>
                <Button 
                  variant="outline" 
                  className="w-full h-12 rounded-xl" 
                  onClick={() => {
                    setSuccess(false)
                    setEmail("")
                  }}
                >
                  Use a different email
                </Button>
              </div>
            ) : (
              <form onSubmit={handleLogin} className="space-y-4">
                {error && (
                  <div className="p-3 bg-destructive/10 border border-destructive/20 rounded-xl text-destructive text-sm text-center">
                    {error}
                  </div>
                )}

                <div className="relative">
                  <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    type="email"
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
                  className="w-full h-12 rounded-xl font-semibold text-base shadow-lg shadow-primary/20" 
                  disabled={isLoading}
                >
                  {isLoading ? (
                    <Loader2 className="w-5 h-5 animate-spin" />
                  ) : (
                    "Send magic link"
                  )}
                </Button>

                <p className="text-xs text-center text-muted-foreground pt-2">
                  No password needed. We&apos;ll email you a secure link.
                </p>
              </form>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
