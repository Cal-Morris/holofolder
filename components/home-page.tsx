"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { ArrowRight, BookOpen, Camera, Check, DollarSign, Heart, Layers3, Palette, Search, Share2, Sparkles, Star, Users, Wifi } from "lucide-react"
import AuthModal from "@/components/auth-modal"
import { Button } from "@/components/ui/button"

const PREVIEW_SLOTS = [
  { id: 1, name: "Bulbasaur", status: "owned" },
  { id: 2, name: "Ivysaur", status: "owned" },
  { id: 3, name: "Venusaur", status: "wanted" },
  { id: 4, name: "Charmander", status: "empty" },
  { id: 5, name: "Charmeleon", status: "empty" },
  { id: 6, name: "Charizard", status: "wanted" },
  { id: 7, name: "Squirtle", status: "owned" },
  { id: 8, name: "Wartortle", status: "empty" },
]

const FEATURES = [
  {
    icon: Check,
    title: "Track the binder",
    text: "Mark each National Dex slot as owned, wanted, upgraded, or perfect.",
  },
  {
    icon: Search,
    title: "Pick exact cards",
    text: "Attach the real TCG print you own, then keep variants and wanted cards tidy.",
  },
  {
    icon: Layers3,
    title: "Share with a partner",
    text: "Sync the collection across devices so two people can update it together.",
  },
]

const CAPABILITIES = [
  {
    icon: BookOpen,
    title: "Binder pages",
    text: "Navigate single pages or facing spreads with page numbers that match a physical binder.",
  },
  {
    icon: Check,
    title: "Owned cards",
    text: "Mark slots as owned, attach exact printings, and keep card language and finish with the slot.",
  },
  {
    icon: Heart,
    title: "Wanted cards",
    text: "Track cards you still want without losing the original National Dex slot position.",
  },
  {
    icon: Star,
    title: "Upgrade and perfect",
    text: "Separate basic ownership from upgrade targets and final perfect binder slots.",
  },
  {
    icon: Search,
    title: "Fast search",
    text: "Jump to Pokemon, filter by generation, or move through the next needed cards.",
  },
  {
    icon: Layers3,
    title: "Set population",
    text: "Inspect TCG sets and add or want cards from set-focused views.",
  },
  {
    icon: DollarSign,
    title: "Prices",
    text: "Show estimated values for owned and wanted cards, including filtered totals.",
  },
  {
    icon: Camera,
    title: "Scanning",
    text: "Use page and slot scanning to speed up adding cards from a real binder.",
  },
  {
    icon: Users,
    title: "Partner sync",
    text: "Let two people update the same collection and see changes refresh across screens.",
  },
  {
    icon: Share2,
    title: "Read-only sharing",
    text: "Share a real-time binder preview with anyone, without exposing editing controls.",
  },
  {
    icon: Wifi,
    title: "Offline-friendly",
    text: "Keep local collection changes queued when the network is unavailable.",
  },
  {
    icon: Palette,
    title: "Binder feel",
    text: "Tune dark mode, binder colors, glare, and card finish effects.",
  },
]

const WORKFLOW_STEPS = [
  "Pick the binder page or jump to the next needed slot.",
  "Open a slot, choose Add or Want, then select the exact TCG printing.",
  "Use filters, prices, and wanted lists to decide what to buy or upgrade next.",
  "Share or partner-sync the binder so updates stay aligned across devices.",
]

const VIEW_MODES = [
  { label: "Binder", text: "The physical-page view for daily tracking." },
  { label: "List", text: "A dense checklist for fast review." },
  { label: "Wanted", text: "A buying-focused view of cards still needed." },
  { label: "Sets", text: "Set-by-set card population and add/want flows." },
]

function getPokemonArtworkUrl(id: number) {
  return `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/${id}.png`
}

export default function HomePage({ isSignedIn = false }: { isSignedIn?: boolean }) {
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
      <div className="mx-auto flex min-h-[100dvh] w-full max-w-7xl flex-col px-4 py-4 sm:px-6 lg:px-8">
        <header className="flex shrink-0 items-center justify-between gap-3 rounded-2xl border border-border/70 bg-card/90 px-3 py-3 shadow-[0_18px_50px_-34px_rgba(15,23,42,0.28)] backdrop-blur-xl sm:px-4">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-secondary shadow-lg shadow-primary/20">
              <Sparkles className="h-5 w-5 text-primary-foreground" />
            </div>
            <div className="min-w-0">
              <p className="truncate text-lg font-bold tracking-tight">BinderDex</p>
              <p className="truncate text-xs text-muted-foreground">National Dex binder tracking</p>
            </div>
          </div>
          <Button onClick={openAuthOrApp} className="h-10 shrink-0 rounded-xl px-4">
            {isSignedIn ? "Open app" : "Sign in"}
          </Button>
        </header>

        <section className="grid min-h-[calc(100dvh-6rem)] items-center gap-8 py-8 lg:grid-cols-[0.9fr_1.1fr] lg:gap-10 lg:py-10">
          <div className="max-w-xl">
            <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
              <Heart className="h-3.5 w-3.5 fill-current" />
              Built for shared collecting
            </div>
            <h1 className="text-4xl font-bold tracking-tight text-foreground sm:text-5xl lg:text-6xl">
              Know exactly what is in the binder.
            </h1>
            <p className="mt-4 max-w-lg text-base leading-7 text-muted-foreground sm:text-lg">
              BinderDex gives your Pokemon card binder a clean National Dex map, wanted list, card matching, prices, and shared sync for whoever is updating it.
            </p>
            <div className="mt-6 flex flex-col gap-3 sm:flex-row">
              <Button onClick={openAuthOrApp} size="lg" className="h-12 rounded-2xl px-5 text-base">
                {isSignedIn ? "Open app" : "Open your binder"}
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
              <a
                href="#preview"
                className="inline-flex h-12 items-center justify-center rounded-2xl border border-border/70 bg-card/70 px-5 text-base font-semibold text-foreground transition-colors hover:bg-muted/70"
              >
                Preview the layout
              </a>
            </div>

            <div className="mt-8 grid gap-3 sm:grid-cols-3">
              {FEATURES.map((feature) => {
                const Icon = feature.icon

                return (
                  <div key={feature.title} className="rounded-2xl border border-border/60 bg-card/70 p-3">
                    <Icon className="mb-3 h-4 w-4 text-primary" />
                    <p className="text-sm font-semibold">{feature.title}</p>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">{feature.text}</p>
                  </div>
                )
              })}
            </div>
          </div>

          <div id="preview" className="relative mx-auto w-full max-w-xl scroll-mt-6 lg:max-w-none">
            <div className="rounded-[2rem] border border-emerald-500/30 bg-emerald-950/25 p-3 shadow-[0_30px_90px_-48px_rgba(16,185,129,0.75)] dark:bg-emerald-950/35">
              <div className="rounded-[1.45rem] border border-white/10 bg-background/80 p-3 shadow-inner backdrop-blur">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Pages 16-17</p>
                    <p className="text-sm font-bold">Starter binder preview</p>
                  </div>
                  <div className="rounded-full border border-primary/25 bg-primary/10 px-3 py-1 text-sm font-bold text-primary">
                    349 / 1025
                  </div>
                </div>
                <div className="grid grid-cols-4 gap-2">
                  {PREVIEW_SLOTS.map((slot, index) => (
                    <div
                      key={slot.id}
                      className={`relative aspect-[2.5/3.5] overflow-hidden rounded-xl border bg-gradient-to-br from-muted to-background ${
                        slot.status === "owned"
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
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="border-t border-border/50 py-10 sm:py-12">
          <div className="mb-6 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">What it supports</p>
              <h2 className="mt-2 text-2xl font-bold tracking-tight sm:text-3xl">Everything around the binder, not just a checklist.</h2>
            </div>
            <p className="max-w-md text-sm leading-6 text-muted-foreground">
              The app is built around the way a real collection gets handled: page positions, exact cards, buying targets, prices, and two people editing at once.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {CAPABILITIES.map((capability) => {
              const Icon = capability.icon

              return (
                <div key={capability.title} className="rounded-2xl border border-border/60 bg-card/70 p-4">
                  <Icon className="mb-4 h-5 w-5 text-primary" />
                  <h3 className="text-sm font-semibold">{capability.title}</h3>
                  <p className="mt-2 text-xs leading-5 text-muted-foreground">{capability.text}</p>
                </div>
              )
            })}
          </div>
        </section>

        <section className="grid gap-4 border-t border-border/50 py-10 sm:py-12 lg:grid-cols-[0.9fr_1.1fr]">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">Daily flow</p>
            <h2 className="mt-2 text-2xl font-bold tracking-tight sm:text-3xl">Designed for repeated updates.</h2>
            <p className="mt-3 max-w-md text-sm leading-6 text-muted-foreground">
              Most sessions are quick: find the slot, mark the card, move on. The deeper tools are there when you need prices, scans, or cleanup.
            </p>
          </div>

          <div className="grid gap-3">
            {WORKFLOW_STEPS.map((step, index) => (
              <div key={step} className="grid grid-cols-[auto_minmax(0,1fr)] gap-3 rounded-2xl border border-border/60 bg-card/70 p-4">
                <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-primary text-sm font-bold text-primary-foreground">
                  {index + 1}
                </div>
                <p className="self-center text-sm font-medium leading-6">{step}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="grid gap-4 border-t border-border/50 py-10 sm:py-12 lg:grid-cols-4">
          {VIEW_MODES.map((view) => (
            <div key={view.label} className="rounded-2xl border border-border/60 bg-card/70 p-4">
              <div className="mb-4 inline-flex rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-xs font-bold text-primary">
                {view.label}
              </div>
              <p className="text-sm leading-6 text-muted-foreground">{view.text}</p>
            </div>
          ))}
        </section>

        <section className="border-t border-border/50 py-10 sm:py-12">
          <div className="rounded-[2rem] border border-primary/20 bg-primary/10 p-5 sm:flex sm:items-center sm:justify-between sm:gap-6">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">Sync and share</p>
              <h2 className="mt-2 text-2xl font-bold tracking-tight">Keep the collection current from anywhere.</h2>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
                Realtime refresh keeps partner sessions aligned, local changes can queue offline, and read-only share links give anyone a live binder preview without letting them change anything.
              </p>
            </div>
            <Button onClick={openAuthOrApp} size="lg" className="mt-5 h-12 rounded-2xl px-5 text-base sm:mt-0">
              {isSignedIn ? "Open app" : "Start tracking"}
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </div>
        </section>
      </div>

      {!isSignedIn ? <AuthModal isOpen={isAuthOpen} onClose={() => setIsAuthOpen(false)} /> : null}
    </main>
  )
}
