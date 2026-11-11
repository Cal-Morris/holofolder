import type { ComponentProps } from "react"
import { ChevronDown } from "lucide-react"
import { cn } from "@/lib/utils"

/**
 * The app's one dropdown: a native <select> (so the phone's own picker, labels and keyboard keep working) styled like
 * the other fields, with a chevron. `className` sizes and places it (margins, width, flex); the look is fixed here.
 */
export function Select({ className, children, ...props }: ComponentProps<"select">) {
  return <span className={cn("relative inline-flex min-w-0 max-w-full align-middle", className)}>
    <select {...props} className="h-11 w-full min-w-0 cursor-pointer appearance-none truncate rounded-2xl border border-border/60 bg-background/60 pl-3 pr-9 text-base font-medium text-foreground outline-none transition-colors hover:border-primary/40 focus-visible:ring-2 focus-visible:ring-primary/50 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm">
      {children}
    </select>
    <ChevronDown aria-hidden="true" className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
  </span>
}
