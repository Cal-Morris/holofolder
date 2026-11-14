'use client';

import { getMagicLinkRedirectUrl, getPasswordRecoveryRedirectUrl } from '@/lib/auth-redirects';
import { PasskeySignIn } from '@/components/passkey-sign-in';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { Mail, Loader2, KeyRound } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { AuthShell } from './auth-shell';
import styles from './login.module.css';

type AuthMethod = 'magic-link' | 'password';
type PasswordMode = 'sign-in' | 'sign-up';
type SuccessState = 'magic-link' | 'password-signup' | 'password-reset' | null;

// supabase-js is only needed once the visitor submits, so it loads then instead of with the page.
async function createClient() {
  const { createClient: createBrowserClient } = await import('@/lib/supabase/client');
  return createBrowserClient();
}

// Read ?mode=recovery after hydration rather than with useSearchParams(), which would make the
// prerendered page a client-only spinner. The static HTML is the normal sign-in form.
const subscribeToNothing = () => () => {};
const readRecoveryMode = () => new URLSearchParams(window.location.search).get('mode') === 'recovery';
const serverRecoveryMode = () => false;

// oxlint-disable-next-line react-doctor/prefer-useReducer -- independent form fields and status; one reducer would not read better
export function LoginForm() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [success, setSuccess] = useState<SuccessState>(null);
  const [authMethod, setAuthMethod] = useState<AuthMethod>('magic-link');
  const [passwordMode, setPasswordMode] = useState<PasswordMode>('sign-in');
  const [hasRecoverySession, setHasRecoverySession] = useState(false);
  const [isCheckingRecoverySession, setIsCheckingRecoverySession] = useState(false);

  const router = useRouter();
  const recoveryMode = useSyncExternalStore(subscribeToNothing, readRecoveryMode, serverRecoveryMode);

  useEffect(() => {
    if (!recoveryMode) return;

    const checkRecoverySession = async () => {
      setIsCheckingRecoverySession(true);
      const supabase = await createClient().catch(() => null);
      const { data, error } = supabase
        ? await supabase.auth.getUser()
        : { data: { user: null }, error: new Error('Could not reach the sign-in service.') };

      if (error || !data.user) {
        setError('This password recovery link is invalid or has expired.');
      } else {
        setHasRecoverySession(true);
        setError(null);
      }

      setIsCheckingRecoverySession(false);
    };

    checkRecoverySession();
  }, [recoveryMode]);

  const resetState = () => {
    setError(null);
    setSuccess(null);
    setPassword('');
    setConfirmPassword('');
  };

  const handleMagicLink = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);

    try {
      const supabase = await createClient();
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: {
          emailRedirectTo: getMagicLinkRedirectUrl(),
          shouldCreateUser: true,
        },
      });

      if (error) throw error;
      setSuccess('magic-link');
    } catch (error: unknown) {
      setError(error instanceof Error ? error.message : 'An error occurred');
    } finally {
      setIsLoading(false);
    }
  };

  const handlePasswordAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);

    try {
      const supabase = await createClient();
      if (passwordMode === 'sign-up') {
        if (password.length < 8) {
          throw new Error('Password must be at least 8 characters.');
        }

        if (password !== confirmPassword) {
          throw new Error('Passwords do not match.');
        }

        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: getMagicLinkRedirectUrl(),
          },
        });

        if (error) throw error;

        if (data.session) {
          router.push('/');
          router.refresh();
          return;
        }

        setSuccess('password-signup');
        return;
      }

      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) throw error;
      router.push('/');
      router.refresh();
    } catch (error: unknown) {
      setError(error instanceof Error ? error.message : 'Authentication failed');
    } finally {
      setIsLoading(false);
    }
  };

  const handlePasswordReset = async () => {
    if (!email) {
      setError('Enter your email address first.');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const supabase = await createClient();
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: getPasswordRecoveryRedirectUrl(),
      });

      if (error) throw error;
      setSuccess('password-reset');
    } catch (error: unknown) {
      setError(error instanceof Error ? error.message : 'Could not send a password reset link.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleRecoverySubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }

    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const supabase = await createClient();
      const { error } = await supabase.auth.updateUser({
        password,
      });

      if (error) throw error;

      router.push('/');
      router.refresh();
    } catch (error: unknown) {
      setError(error instanceof Error ? error.message : 'Could not update your password.');
    } finally {
      setIsLoading(false);
    }
  };

  const title = recoveryMode
    ? 'Set a new password'
    : success
      ? 'Check your email'
      : authMethod === 'magic-link'
        ? 'Start your binder'
        : passwordMode === 'sign-up'
          ? 'Create your account'
          : 'Welcome back';

  const intro = recoveryMode
    ? 'Choose a password for your Holo Folder account.'
    : success === 'password-reset'
      ? 'We sent you a link to choose a new password.'
      : success === 'password-signup'
        ? 'We sent you a link to confirm your email and finish creating your account.'
        : success
          ? 'We sent you a secure link. Open it on any device to sign in, then you can close this tab.'
          : authMethod === 'magic-link'
            ? 'Sign in or create an account. We’ll email you a secure link, no password needed.'
            : passwordMode === 'sign-up'
              ? 'Choose a password of at least 8 characters.'
              : 'Sign in with your email and password.';

  const errorNote = error && (
    <p role="alert" className="bg-destructive/10 border-destructive/20 text-destructive rounded-xl border p-3 text-sm">
      {error}
    </p>
  );

  return (
    <AuthShell title={title} intro={intro} footer={<p>Your collection, beautifully kept.</p>}>
      {recoveryMode ? (
        <form onSubmit={handleRecoverySubmit} className="space-y-3">
          {errorNote}
          {isCheckingRecoverySession ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="text-muted-foreground h-5 w-5 animate-spin" />
            </div>
          ) : hasRecoverySession ? (
            <>
              <Field
                icon={KeyRound}
                type="password"
                label="New password"
                autoComplete="new-password"
                value={password}
                onChange={setPassword}
                // oxlint-disable-next-line jsx-a11y/no-autofocus -- the reset page's only task is this field
                autoFocus
              />
              <Field
                icon={KeyRound}
                type="password"
                label="Confirm new password"
                autoComplete="new-password"
                value={confirmPassword}
                onChange={setConfirmPassword}
              />
              <SubmitButton busy={isLoading}>Save new password</SubmitButton>
            </>
          ) : null}
        </form>
      ) : success ? (
        <div className="space-y-4">
          <div className="border-border bg-muted/40 flex items-center gap-3 rounded-2xl border p-4">
            <span className="bg-primary/15 text-primary flex size-10 shrink-0 items-center justify-center rounded-full">
              <Mail className="h-5 w-5" />
            </span>
            <p className="min-w-0 text-sm break-words">
              <span className="text-muted-foreground block text-xs">Sent to</span>
              {email}
            </p>
          </div>
          <Button
            variant="outline"
            className="h-12 w-full rounded-xl"
            onClick={() => {
              resetState();
              setEmail('');
            }}
          >
            Use a different email
          </Button>
        </div>
      ) : (
        <div className="space-y-4">
          {errorNote}
          {authMethod === 'magic-link' ? (
            <form onSubmit={handleMagicLink} className="space-y-3">
              <Field
                icon={Mail}
                type="email"
                label="Email address"
                placeholder="you@example.com"
                autoComplete="email"
                value={email}
                onChange={setEmail}
                // oxlint-disable-next-line jsx-a11y/no-autofocus -- the sign-in page's only task starts at this field
                autoFocus
              />
              <SubmitButton busy={isLoading}>Continue with email</SubmitButton>
            </form>
          ) : (
            <div className="space-y-2">
              <form onSubmit={handlePasswordAuth} className="space-y-3">
                <Field
                  icon={Mail}
                  type="email"
                  label="Email address"
                  placeholder="you@example.com"
                  autoComplete="email"
                  value={email}
                  onChange={setEmail}
                  // oxlint-disable-next-line jsx-a11y/no-autofocus -- the sign-in page's only task starts at this field
                  autoFocus
                />
                <Field
                  icon={KeyRound}
                  type="password"
                  label={passwordMode === 'sign-in' ? 'Password' : 'Create a password'}
                  autoComplete={passwordMode === 'sign-in' ? 'current-password' : 'new-password'}
                  value={password}
                  onChange={setPassword}
                />
                {passwordMode === 'sign-up' && (
                  <Field
                    icon={KeyRound}
                    type="password"
                    label="Confirm password"
                    autoComplete="new-password"
                    value={confirmPassword}
                    onChange={setConfirmPassword}
                  />
                )}
                <SubmitButton busy={isLoading}>
                  {passwordMode === 'sign-in' ? 'Sign in' : 'Create account'}
                </SubmitButton>
              </form>
              <div className="flex flex-wrap justify-between gap-2">
                {passwordMode === 'sign-in' ? (
                  <>
                    <Button
                      type="button"
                      variant="ghost"
                      className="text-muted-foreground px-3"
                      onClick={handlePasswordReset}
                      disabled={isLoading}
                    >
                      Forgot password?
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      className="px-3"
                      onClick={() => {
                        setPasswordMode('sign-up');
                        setError(null);
                      }}
                    >
                      Create account
                    </Button>
                  </>
                ) : (
                  <Button
                    type="button"
                    variant="ghost"
                    className="mx-auto px-3"
                    onClick={() => {
                      setPasswordMode('sign-in');
                      setError(null);
                    }}
                  >
                    I already have an account
                  </Button>
                )}
              </div>
            </div>
          )}

          <div className={styles.divider}>or</div>

          {!(authMethod === 'password' && passwordMode === 'sign-up') && (
            <PasskeySignIn
              disabled={isLoading}
              onSuccess={() => {
                router.push('/');
                router.refresh();
              }}
            />
          )}
          <Button
            type="button"
            variant="ghost"
            className="text-muted-foreground h-11 w-full rounded-xl"
            onClick={() => {
              resetState();
              setPasswordMode('sign-in');
              setAuthMethod(authMethod === 'magic-link' ? 'password' : 'magic-link');
            }}
          >
            {authMethod === 'magic-link' ? 'Use a password instead' : 'Email me a sign-in link instead'}
          </Button>
        </div>
      )}
    </AuthShell>
  );
}

function Field({
  icon: Icon,
  label,
  onChange,
  ...props
}: Omit<React.ComponentProps<typeof Input>, 'onChange' | 'aria-label'> & {
  icon: typeof Mail;
  label: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="relative">
      <Icon className="text-muted-foreground pointer-events-none absolute top-1/2 left-4 h-4 w-4 -translate-y-1/2" />
      <Input
        aria-label={label}
        placeholder={label}
        required
        onChange={(event) => onChange(event.target.value)}
        className="bg-muted/50 border-border focus:bg-background h-12 rounded-xl pl-11 text-base transition-colors"
        {...props}
      />
    </div>
  );
}

function SubmitButton({ busy, children }: { busy: boolean; children: React.ReactNode }) {
  return (
    <Button type="submit" className="h-12 w-full rounded-xl text-base font-semibold" disabled={busy}>
      {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : children}
    </Button>
  );
}
