import { Skeleton } from '@/components/ui/skeleton';

// The set page's own boundary, so moving between sets keeps the page frame instead of the app's spinner.
export default function Loading() {
  return (
    <main className="bg-background min-h-screen px-4 py-8" aria-busy="true">
      <div className="mx-auto max-w-2xl space-y-3">
        <span className="sr-only">Loading set</span>
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-8 w-3/4" />
        <Skeleton className="h-24 w-full" />
      </div>
    </main>
  );
}
