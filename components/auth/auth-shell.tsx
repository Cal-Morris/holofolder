import type { ReactNode } from 'react';
import Image from 'next/image';
import styles from './login.module.css';

/** The branded frame shared by sign-in, MCP consent and auth errors: mark, one card, quiet footer. */
export function AuthShell({
  title,
  intro,
  footer,
  children,
}: {
  title: ReactNode;
  intro?: ReactNode;
  footer?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <main className={styles.page}>
      <div className={styles.frame}>
        <a href="https://holofolder.com" className={styles.brand}>
          <Image src="/app/holofolder-mark.png" alt="" width={44} height={44} loading="eager" unoptimized />
          Holo Folder
        </a>
        <div className={`holo-panel ${styles.card}`}>
          <div className={styles.header}>
            <h1 className={styles.heading}>{title}</h1>
            {intro && <p className={styles.intro}>{intro}</p>}
          </div>
          {children && <div className={styles.body}>{children}</div>}
        </div>
        <footer className={styles.footer}>
          {footer}
          <a href="https://holofolder.com">holofolder.com</a>
        </footer>
      </div>
    </main>
  );
}
