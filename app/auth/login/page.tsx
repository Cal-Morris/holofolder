import { ArrowLeft } from 'lucide-react'
import Link from 'next/link'
import { LoginForm } from '@/components/auth/login-form'
import { ServiceWorkerRegistration } from '@/components/auth/service-worker-registration'

// Server component, prerendered as static HTML: the page chrome and the full sign-in form are in
// the HTML, so it paints before any JS runs. Only the form is a client island.
export default function Page() {
  return (
    <div className="min-h-svh w-full flex flex-col items-center justify-center p-6 bg-background">
      <ServiceWorkerRegistration />
      <div className="w-full max-w-sm">
        <Link
          href="/"
          className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground mb-8 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Binder
        </Link>

        <div className="bg-card border border-border/50 rounded-2xl overflow-hidden shadow-xl">
          <LoginForm />
        </div>
      </div>
    </div>
  )
}
