import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

/** One analytics section: icon, title, optional note, content. */
export default function AnalyticsPanel({
  icon: Icon,
  title,
  note,
  children,
  className = '',
}: {
  icon: LucideIcon;
  title: string;
  note?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section aria-label={title} className={`holo-tile border-border/60 min-w-0 rounded-2xl border p-4 ${className}`}>
      <h2 className="flex items-center gap-2 font-semibold">
        <span className="bg-highlight-surface text-highlight grid size-7 shrink-0 place-items-center rounded-lg">
          <Icon className="size-4" aria-hidden="true" />
        </span>
        {title}
      </h2>
      {note && <p className="text-muted-foreground mt-1 text-sm">{note}</p>}
      <div className="mt-3">{children}</div>
    </section>
  );
}
