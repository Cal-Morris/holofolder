import { ArrowLeft } from 'lucide-react'
import Link from 'next/link'
import Image from 'next/image'
import { LoginForm } from '@/components/auth/login-form'
import { ServiceWorkerRegistration } from '@/components/auth/service-worker-registration'
import styles from '@/components/auth/login.module.css'

// Server component, prerendered as static HTML: the page chrome and the full sign-in form are in
// the HTML, so it paints before any JS runs. Only the form is a client island.
export default function Page() {
  return (
    <main className={styles.page}>
      <ServiceWorkerRegistration />
      <div className={styles.frame}>
        <nav className={styles.navigation} aria-label="Sign-in navigation">
          <a href="https://holofolder.com" className={styles.brand}>
            <Image src="/app/holofolder-mark.png" alt="" width={36} height={36} unoptimized />
            Holo Folder
          </a>
          <Link
            href="https://holofolder.com"
            className={styles.backLink}
          >
            <ArrowLeft className="w-4 h-4" />
            Back to home
          </Link>
        </nav>

        <div className={styles.card}>
          <LoginForm />
        </div>
        <p className={styles.tagline}>Your collection, beautifully kept.</p>
      </div>
    </main>
  )
}
