import { Search, SlidersHorizontal } from "lucide-react"
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from "react"

// The one search, sort and filter row shared by the pages that list cards (Inventory, Wanted).
// On a phone the search takes the first line and sort and filters sit under it; from 640px it is one line.
const control = "h-11 rounded-2xl border border-border/60 bg-background/85 text-base outline-none focus-visible:ring-2 focus-visible:ring-primary/50 md:text-sm"

export function ListControls({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap items-center gap-2">{children}</div>
}

export function ListSearch({ label, ...input }: { label: string } & InputHTMLAttributes<HTMLInputElement>) {
  return <label className="relative basis-full sm:min-w-[10rem] sm:flex-1 sm:basis-0">
    <span className="sr-only">{label}</span>
    <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
    <input type="search" {...input} className={`${control} w-full pl-9 pr-3 placeholder:text-muted-foreground`} />
  </label>
}

export function ListSelect({ label, children, ...select }: { label: string } & SelectHTMLAttributes<HTMLSelectElement>) {
  return <select aria-label={label} {...select} className={`${control} min-w-0 max-w-[60%] flex-none px-3 font-medium sm:max-w-[12rem]`}>{children}</select>
}

export function ListFiltersButton({ active, ...button }: { active: number } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button type="button" {...button}
    className={`flex h-11 shrink-0 items-center gap-1.5 rounded-2xl border px-3 text-sm font-semibold ${active ? "border-primary/45 bg-primary/12 text-primary" : "border-border/60 bg-background/85 hover:bg-muted/60"}`}>
    <SlidersHorizontal className="h-4 w-4" aria-hidden />Filters{active > 0 && <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1 text-[10px] text-primary-foreground">{active}</span>}
  </button>
}

export function ListClearButton(button: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button type="button" {...button} className="h-11 rounded-2xl px-2 text-sm font-medium text-muted-foreground hover:text-foreground">Clear</button>
}
