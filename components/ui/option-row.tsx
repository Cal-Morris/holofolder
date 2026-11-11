import type { ComponentProps, ReactNode } from "react"
import { Check } from "lucide-react"
import { cn } from "@/lib/utils"

/**
 * One choice in a list of results or options (a set, a promo, a card to leave out). A title, an optional muted detail
 * line and an optional picture on the left. Pass `selected` for a toggle (it becomes `aria-pressed`, with a check).
 */
export function OptionRow({ title, detail, media, selected, className, ...props }: Omit<ComponentProps<"button">, "title" | "children"> & {
  title: ReactNode; detail?: ReactNode; media?: ReactNode; selected?: boolean
}) {
  return <button type="button" aria-pressed={selected} {...props}
    className={cn("flex min-h-12 w-full min-w-0 items-center gap-3 rounded-2xl border border-border/60 bg-background/40 px-3 py-2 text-left transition-[background-color,border-color,transform] duration-150 ease-out hover:border-primary/45 hover:bg-primary/5 active:scale-[0.99] disabled:pointer-events-none disabled:opacity-45 aria-pressed:border-primary/55 aria-pressed:bg-primary/10", className)}>
    {media && <span aria-hidden="true" className="flex shrink-0 items-center justify-center">{media}</span>}
    <span className="min-w-0 flex-1">
      <span className="block break-words text-sm font-semibold [overflow-wrap:anywhere]">{title}</span>
      {detail && <span className="block break-words text-xs text-muted-foreground [overflow-wrap:anywhere]">{detail}</span>}
    </span>
    {selected !== undefined && <span aria-hidden="true" className={cn("flex h-6 w-6 shrink-0 items-center justify-center rounded-full border transition-colors",
      selected ? "border-primary bg-primary text-primary-foreground" : "border-border/70")}>{selected && <Check className="h-3.5 w-3.5" />}</span>}
  </button>
}
