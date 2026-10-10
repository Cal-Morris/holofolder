"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { ArrowRight, BookOpen, Camera, Check, DollarSign, Heart, Layers3, Search, Share2, Sparkles, Star, Users, Wifi } from "lucide-react"
import AuthModal from "@/components/auth-modal"
import { Button } from "@/components/ui/button"
import { getOfficialArtworkUrl } from "@/lib/pokemon-artwork"
import { useServiceWorkerRegistration } from "@/hooks/use-service-worker-registration"

const PREVIEW_SLOTS = [
  { id: 145, name: "Zapdos", status: "owned" },
  { id: 147, name: "Dratini", status: "wanted" },
  { id: 148, name: "Dragonair", status: "owned" },
  { id: 150, name: "Mewtwo", status: "owned" },
  { id: 151, name: "Mew", status: "perfect" },
  { id: 152, name: "Chikorita", status: "empty" },
  { id: 155, name: "Cyndaquil", status: "empty" },
  { id: 158, name: "Totodile", status: "owned" },
]

const HERO_STATS = [
  { value: "1025", label: "National Dex slots" },
  { value: "Live", label: "partner sync" },
  { value: "Read-only", label: "share previews" },
  { value: "Exact", label: "TCG print tracking" },
]

const PRIMARY_FEATURES = [
  {
    icon: BookOpen,
    title: "A binder that matches the real one",
    text: "Navigate by page, spread, generation, or slot. The app stays grounded in the physical binder layout instead of becoming a generic checklist.",
  },
  {
    icon: Search,
    title: "Fast ways to find the next card",
    text: "Search Pokemon, jump to page numbers, filter by status, and move straight to the next needed or wanted slot.",
  },
  {
    icon: Check,
    title: "Exact card ownership",
    text: "Attach the real TCG printing, language, finish, and set to each Dex slot, then update it when you upgrade.",
  },
]

const FEATURE_GROUPS = [
  {
    eyebrow: "Collection state",
    title: "Know what you own and what still needs work.",
    items: [
      { icon: Check, label: "Owned", text: "Mark collected slots with or without an exact card." },
      { icon: Heart, label: "Wanted", text: "Track cards you want to find without hiding the base slot." },
      { icon: Star, label: "Upgrade / Perfect", text: "Separate placeholders from cards that are good enough to keep." },
    ],
  },
  {
    eyebrow: "Card details",
    title: "Track real TCG cards, not just Pokemon names.",
    items: [
      { icon: Layers3, label: "Set views", text: "Browse set populations and add or want cards from there." },
      { icon: DollarSign, label: "Prices", text: "See owned, wanted, filtered, and page-level value totals." },
      { icon: Camera, label: "Scanning", text: "Use slot or page scanning to speed up binder entry." },
    ],
  },
  {
    eyebrow: "Sharing",
    title: "Built for more than one person looking at the binder.",
    items: [
      { icon: Users, label: "Partner mode", text: "Two people can update the same collection and stay in sync." },
      { icon: Share2, label: "Read-only links", text: "Share a real-time binder preview with anyone, without edit access." },
      { icon: Wifi, label: "Offline queue", text: "Local changes can wait and sync when the connection comes back." },
    ],
  },
]

const WORKFLOW = [
  "Open the binder page or jump straight to a Pokemon.",
  "Choose Add, Want, Upgrade, or Perfect from the slot actions.",
  "Pick the exact TCG card, finish, language, and set.",
  "Use prices, wanted cards, and share links to decide what happens next.",
]

const VIEW_MODES = [
  { label: "Binder", text: "Visual page and spread tracking for the physical collection." },
  { label: "List", text: "Dense checklist review when you just need to move quickly." },
  { label: "Wanted", text: "Buying-focused view for cards still missing or planned." },
  { label: "Sets", text: "Set-by-set population for matching real TCG releases." },
]

function getPokemonArtworkUrl(id: number) {
  return getOfficialArtworkUrl(id, 320)
}

export default function HomePage({ isSignedIn = false }: { isSignedIn?: boolean }) {
  useServiceWorkerRegistration()
  const router = useRouter()
  const [isAuthOpen, setIsAuthOpen] = useState(false)
  const openAuthOrApp = () => {
    if (isSignedIn) {
      router.push("/")
      return
    }

    setIsAuthOpen(true)
  }

  useEffect(() => {
    const storedTheme = document.cookie
      .split("; ")
      .find((cookie) => cookie.startsWith("binderdex_theme="))
      ?.split("=")[1]

    document.documentElement.classList.toggle("dark", storedTheme !== "light")
  }, [])

  return (
    <main className="min-h-[100dvh] overflow-x-hidden bg-background text-foreground">
      <header className="sticky top-0 z-30 border-b border-border/60 bg-background/88 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
          <a href="#top" className="flex min-w-0 items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-secondary shadow-lg shadow-primary/20">
              <Sparkles className="h-5 w-5 text-primary-foreground" />
            </div>
            <div className="min-w-0">
              <p className="truncate text-base font-bold tracking-tight">BinderDex</p>
              <p className="hidden truncate text-xs text-muted-foreground sm:block">National Dex binder tracking</p>
            </div>
          </a>

          <nav className="hidden items-center gap-5 text-sm font-medium text-muted-foreground md:flex">
            <a href="#features" className="hover:text-foreground">Features</a>
            <a href="#sharing" className="hover:text-foreground">Sharing</a>
            <a href="#workflow" className="hover:text-foreground">Workflow</a>
            <a href="#views" className="hover:text-foreground">Views</a>
          </nav>

          <Button onClick={openAuthOrApp} className="h-10 shrink-0 rounded-xl px-4">
            {isSignedIn ? "Open app" : "Sign in"}
          </Button>
        </div>
      </header>

      <div id="top" className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8">
        <section className="py-14 text-center sm:py-18 lg:py-20">
          <div className="mx-auto mb-5 inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
            <Heart className="h-3.5 w-3.5 fill-current" />
            Built for shared collecting
          </div>
          <h1 className="mx-auto max-w-5xl text-4xl font-bold tracking-tight sm:text-6xl lg:text-7xl">
            A proper operating system for your Pokemon binder.
          </h1>
          <p className="mx-auto mt-5 max-w-3xl text-base leading-8 text-muted-foreground sm:text-lg">
            BinderDex turns a physical National Dex card binder into a live, searchable, shareable collection. Track exact cards, wanted upgrades, prices, scans, and partner updates without losing the page layout you actually use.
          </p>
          <div className="mt-7 flex flex-col justify-center gap-3 sm:flex-row">
            <Button onClick={openAuthOrApp} size="lg" className="h-12 rounded-2xl px-5 text-base">
              {isSignedIn ? "Open app" : "Open your binder"}
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
            <a
              href="#preview"
              className="inline-flex h-12 items-center justify-center rounded-2xl border border-border/70 bg-card/70 px-5 text-base font-semibold text-foreground transition-colors hover:bg-muted/70"
            >
              See the preview
            </a>
          </div>

          <div className="mx-auto mt-10 grid max-w-5xl gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {HERO_STATS.map((stat) => (
              <div key={stat.label} className="rounded-2xl border border-border/60 bg-card/70 p-4 text-left">
                <p className="text-2xl font-bold tracking-tight text-foreground">{stat.value}</p>
                <p className="mt-1 text-xs font-medium text-muted-foreground">{stat.label}</p>
              </div>
            ))}
          </div>
        </section>

        <section id="preview" className="scroll-mt-24 border-y border-border/50 py-10">
          <div className="grid gap-6 lg:grid-cols-[0.9fr_1.1fr] lg:items-center">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">Live binder preview</p>
              <h2 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">The page view stays close to the real thing.</h2>
              <p className="mt-4 max-w-xl text-sm leading-7 text-muted-foreground">
                The core screen is a binder page, not a spreadsheet. Slots keep their page, row, and column labels so you can move between the app and the physical binder without translating anything.
              </p>
              <div className="mt-6 grid gap-3 sm:grid-cols-3">
                {PRIMARY_FEATURES.map((feature) => {
                  const Icon = feature.icon

                  return (
                    <div key={feature.title} className="rounded-2xl border border-border/60 bg-card/70 p-4">
                      <Icon className="mb-3 h-4 w-4 text-primary" />
                      <p className="text-sm font-semibold">{feature.title}</p>
                      <p className="mt-2 text-xs leading-5 text-muted-foreground">{feature.text}</p>
                    </div>
                  )
                })}
              </div>
            </div>

            <div className="rounded-[2rem] border border-emerald-500/30 bg-emerald-950/25 p-3 shadow-[0_30px_90px_-48px_rgba(16,185,129,0.75)] dark:bg-emerald-950/35">
              <div className="rounded-[1.45rem] border border-white/10 bg-background/80 p-3 shadow-inner backdrop-blur">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Pages 10-11</p>
                    <p className="text-sm font-bold">National Dex binder</p>
                  </div>
                  <div className="rounded-full border border-primary/25 bg-primary/10 px-3 py-1 text-sm font-bold text-primary">
                    423 / 1025
                  </div>
                </div>
                <div className="grid grid-cols-4 gap-2">
                  {PREVIEW_SLOTS.map((slot, index) => (
                    <div
                      key={slot.id}
                      className={`relative aspect-[2.5/3.5] overflow-hidden rounded-xl border bg-gradient-to-br from-muted to-background ${
                        slot.status === "owned" || slot.status === "perfect"
                          ? "border-emerald-400/45"
                          : slot.status === "wanted"
                            ? "border-amber-400/50"
                            : "border-border/60"
                      }`}
                    >
                      <div className="absolute left-1 top-1 rounded bg-black/55 px-1.5 py-0.5 text-[10px] font-bold text-white">
                        {String.fromCharCode(65 + Math.floor(index / 4))}{(index % 4) + 1}
                      </div>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={getPokemonArtworkUrl(slot.id)}
                        alt={slot.name}
                        className={`absolute inset-x-2 top-5 mx-auto h-[55%] w-[76%] object-contain ${
                          slot.status === "empty" ? "grayscale opacity-55" : ""
                        }`}
                      />
                      <div className="absolute inset-x-1 bottom-1 text-center">
                        <p className="truncate text-[11px] font-bold">{slot.name}</p>
                        <p className="text-[10px] text-muted-foreground">#{String(slot.id).padStart(4, "0")}</p>
                      </div>
                      {slot.status === "wanted" ? (
                        <div className="absolute right-1 top-1 rounded-full bg-amber-500 px-1.5 py-0.5 text-[9px] font-bold text-white">
                          Want
                        </div>
                      ) : null}
                      {slot.status === "perfect" ? (
                        <div className="absolute right-1 top-1 rounded-full bg-emerald-500 px-1.5 py-0.5 text-[9px] font-bold text-white">
                          Perfect
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </section>

        <section id="features" className="scroll-mt-24 py-14 sm:py-16">
          <div className="mb-8 max-w-3xl">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">Features</p>
            <h2 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">Everything around the binder, not just a checklist.</h2>
            <p className="mt-4 text-sm leading-7 text-muted-foreground">
              BinderDex handles the messy parts around a real card binder: placeholders, wanted upgrades, exact printings, prices, scans, sharing, and two people editing together.
            </p>
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            {FEATURE_GROUPS.map((group) => (
              <div key={group.title} className="rounded-[1.5rem] border border-border/60 bg-card/70 p-5">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">{group.eyebrow}</p>
                <h3 className="mt-3 text-xl font-bold tracking-tight">{group.title}</h3>
                <div className="mt-5 space-y-4">
                  {group.items.map((item) => {
                    const Icon = item.icon

                    return (
                      <div key={item.label} className="grid grid-cols-[auto_minmax(0,1fr)] gap-3">
                        <div className="mt-0.5 flex h-8 w-8 items-center justify-center rounded-xl border border-primary/20 bg-primary/10 text-primary">
                          <Icon className="h-4 w-4" />
                        </div>
                        <div>
                          <p className="text-sm font-semibold">{item.label}</p>
                          <p className="mt-1 text-xs leading-5 text-muted-foreground">{item.text}</p>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        </section>

        <section id="sharing" className="scroll-mt-24 border-t border-border/50 py-14 sm:py-16">
          <div className="grid gap-6 lg:grid-cols-[0.85fr_1.15fr] lg:items-start">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">Sharing</p>
              <h2 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">A live binder preview you can safely send to anyone.</h2>
              <p className="mt-4 text-sm leading-7 text-muted-foreground">
                Read-only sharing gives friends, buyers, family, or another collector a real-time view of the binder without giving them edit controls. Partner mode is for trusted collaborators; share links are for everyone else.
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-2xl border border-border/60 bg-card/70 p-4">
                <Share2 className="mb-4 h-5 w-5 text-primary" />
                <p className="text-sm font-semibold">Read-only links</p>
                <p className="mt-2 text-xs leading-5 text-muted-foreground">Browseable previews with no edit access.</p>
              </div>
              <div className="rounded-2xl border border-border/60 bg-card/70 p-4">
                <Users className="mb-4 h-5 w-5 text-primary" />
                <p className="text-sm font-semibold">Partner updates</p>
                <p className="mt-2 text-xs leading-5 text-muted-foreground">Two editors can keep one collection current.</p>
              </div>
              <div className="rounded-2xl border border-border/60 bg-card/70 p-4">
                <Wifi className="mb-4 h-5 w-5 text-primary" />
                <p className="text-sm font-semibold">Realtime refresh</p>
                <p className="mt-2 text-xs leading-5 text-muted-foreground">Screens stay aligned as changes land.</p>
              </div>
            </div>
          </div>
        </section>

        <section id="workflow" className="scroll-mt-24 border-t border-border/50 py-14 sm:py-16">
          <div className="grid gap-6 lg:grid-cols-[0.8fr_1.2fr]">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">Workflow</p>
              <h2 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">Fast for daily updates, detailed when it matters.</h2>
              <p className="mt-4 text-sm leading-7 text-muted-foreground">
                The app keeps the common actions close, then opens deeper tools only when you need exact card matching, pricing, or cleanup.
              </p>
            </div>
            <div className="grid gap-3">
              {WORKFLOW.map((step, index) => (
                <div key={step} className="grid grid-cols-[auto_minmax(0,1fr)] gap-4 rounded-2xl border border-border/60 bg-card/70 p-4">
                  <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-sm font-bold text-primary-foreground">
                    {String(index + 1).padStart(2, "0")}
                  </div>
                  <p className="self-center text-sm font-medium leading-6">{step}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section id="views" className="scroll-mt-24 border-t border-border/50 py-14 sm:py-16">
          <div className="mb-8 max-w-3xl">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">Views</p>
            <h2 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">Different ways to inspect the same collection.</h2>
          </div>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            {VIEW_MODES.map((view) => (
              <div key={view.label} className="rounded-2xl border border-border/60 bg-card/70 p-5">
                <div className="mb-5 inline-flex rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-xs font-bold text-primary">
                  {view.label}
                </div>
                <p className="text-sm leading-6 text-muted-foreground">{view.text}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="border-t border-border/50 py-14 sm:py-16">
          <div className="rounded-[2rem] border border-primary/20 bg-primary/10 p-6 sm:flex sm:items-center sm:justify-between sm:gap-6">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">Ready</p>
              <h2 className="mt-2 text-2xl font-bold tracking-tight sm:text-3xl">Start with the binder page you already have.</h2>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
                Add the cards you own, mark the ones you want, then share the live read-only preview when someone asks what is still missing.
              </p>
            </div>
            <Button onClick={openAuthOrApp} size="lg" className="mt-5 h-12 rounded-2xl px-5 text-base sm:mt-0">
              {isSignedIn ? "Open app" : "Start tracking"}
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </div>
        </section>
      </div>

      <footer className="border-t border-border/50 py-8">
        <div className="mx-auto flex max-w-7xl flex-col gap-2 px-4 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8">
          <p className="font-semibold text-foreground">BinderDex</p>
          <p>National Dex binder tracking with realtime sharing.</p>
        </div>
      </footer>

      {!isSignedIn ? <AuthModal isOpen={isAuthOpen} onClose={() => setIsAuthOpen(false)} /> : null}
    </main>
  )
}
