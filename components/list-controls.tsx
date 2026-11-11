import { Search, SlidersHorizontal } from 'lucide-react';
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from 'react';

// The one search, sort and filter row shared by the pages that list cards (Inventory, Wanted).
// On a phone the search takes the first line and sort and filters sit under it; from 640px it is one line.
const control =
  'h-11 rounded-2xl border border-border/60 bg-background/85 text-base outline-none focus-visible:ring-2 focus-visible:ring-primary/50 md:text-sm';

export function ListControls({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap items-center gap-2">{children}</div>;
}

export function ListSearch({ label, ...input }: { label: string } & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="relative basis-full sm:min-w-[10rem] sm:flex-1 sm:basis-0">
      <span className="sr-only">{label}</span>
      <Search
        aria-hidden="true"
        className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2"
      />
      <input type="search" {...input} className={`${control} placeholder:text-muted-foreground w-full pr-3 pl-9`} />
    </label>
  );
}

export function ListSelect({
  label,
  children,
  ...select
}: { label: string } & SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      aria-label={label}
      {...select}
      className={`${control} max-w-[60%] min-w-0 flex-none px-3 font-medium sm:max-w-[12rem]`}
    >
      {children}
    </select>
  );
}

export function ListFiltersButton({ active, ...button }: { active: number } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      {...button}
      className={`flex h-11 shrink-0 items-center gap-1.5 rounded-2xl border px-3 text-sm font-semibold ${active ? 'border-primary/45 bg-primary/12 text-primary' : 'border-border/60 bg-background/85 hover:bg-muted/60'}`}
    >
      <SlidersHorizontal className="h-4 w-4" aria-hidden />
      Filters
      {active > 0 && (
        <span className="bg-primary text-primary-foreground flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[10px]">
          {active}
        </span>
      )}
    </button>
  );
}

export function ListClearButton(button: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      {...button}
      className="text-muted-foreground hover:text-foreground h-11 rounded-2xl px-2 text-sm font-medium"
    >
      Clear
    </button>
  );
}
