"use client"

import { useCallback, useEffect, useRef, useState, type MouseEvent } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { ArrowUpRight, ChevronDown, Menu, X } from "lucide-react"
import { useOverlay, useSwipeToDismiss } from "@/hooks/use-overlay"
import styles from "@/components/marketing-navigation.module.css"

const features = [
  { href: "#collection", title: "Collection tracking" },
  { href: "#prices", title: "Price tracking" },
  { href: "#wishlisting", title: "Card wishlisting" },
  { href: "#scanning", title: "Card scanning" },
  { href: "#sharing", title: "Share your collection" },
  { href: "#partners", title: "Partner collections" },
  { href: "#offline", title: "Offline access" },
]

export function MarketingNavigation() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const panel = useRef<HTMLDivElement>(null)
  const pendingNavigation = useRef<{ listener: () => void; frame: number } | null>(null)
  const cancelNavigation = useCallback(() => {
    const pending = pendingNavigation.current
    if (!pending) return
    window.removeEventListener("popstate", pending.listener)
    cancelAnimationFrame(pending.frame)
    pendingNavigation.current = null
  }, [])
  const close = () => { cancelNavigation(); setOpen(false) }
  const toggle = () => { cancelNavigation(); setOpen((value) => !value) }
  useOverlay(open, close, { containerRef: panel })
  const swipe = useSwipeToDismiss(panel, close, open)

  useEffect(() => cancelNavigation, [cancelNavigation])

  const select = (event: MouseEvent<HTMLAnchorElement>, href: string) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      close()
      return
    }
    event.preventDefault()
    cancelNavigation()
    // History restores scroll after popstate, so navigate on the following frame.
    const navigate = () => {
      const pending = pendingNavigation.current
      if (!pending || pending.listener !== navigate) return
      pending.frame = requestAnimationFrame(() => {
        pendingNavigation.current = null
        if (href.startsWith("#")) {
          window.location.hash = href
          document.getElementById(href.slice(1))?.scrollIntoView({ behavior: "instant" })
        } else router.push(href)
      })
    }
    pendingNavigation.current = { listener: navigate, frame: 0 }
    window.addEventListener("popstate", navigate, { once: true })
    setOpen(false)
  }

  return (
    <nav className={styles.navigation} aria-label="Main navigation">
      <div className={styles.desktop}>
        <button type="button" className={styles.trigger} aria-expanded={open} aria-haspopup="dialog" aria-controls="marketing-features" onClick={toggle}>Features <ChevronDown size={14} /></button>
        <a href="#pricing">Pricing</a>
        <Link href="/studio">Binder Studio <ArrowUpRight size={14} /></Link>
      </div>
      <button type="button" className={styles.mobileTrigger} aria-label="Open navigation" aria-expanded={open} aria-haspopup="dialog" aria-controls="marketing-features" onClick={toggle}><Menu size={20} /></button>
      {open ? (
        <div className={styles.overlay}>
          <div data-overlay-backdrop className={styles.backdrop} onClick={close} />
          <div id="marketing-features" ref={panel} role="dialog" aria-modal="true" aria-label="Explore BinderDex" className={styles.panel}>
            <div className={styles.panelHeader} {...swipe}>
              <span className={styles.grabber} aria-hidden="true" />
              <h2>Explore BinderDex</h2>
              <button type="button" aria-label="Close navigation" className={styles.close} onClick={close}><X size={18} /></button>
            </div>
            <div className={styles.links}>
              {features.map(({ href, title }) => <a href={href} key={href} onClick={(event) => select(event, href)}><span>{title}</span></a>)}
              <Link href="/studio" onClick={(event) => select(event, "/studio")}><span>Binder Studio <ArrowUpRight size={14} /></span></Link>
              <a href="#pricing" className={styles.pricing} onClick={(event) => select(event, "#pricing")}><span>Pricing</span><small>Free during early access.</small></a>
            </div>
          </div>
        </div>
      ) : null}
    </nav>
  )
}
