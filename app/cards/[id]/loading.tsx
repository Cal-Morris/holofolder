import { Skeleton } from '@/components/ui/skeleton';

// The card page's own boundary, so moving between cards keeps the page frame instead of the app's spinner.
export default function Loading() {
  return (
    <main className="bg-background min-h-screen px-4 py-8" aria-busy="true">
      <div className="mx-auto grid max-w-6xl gap-6 sm:grid-cols-[18rem_1fr]">
        <span className="sr-only">Loading card</span>
        <Skeleton className="mx-auto aspect-[5/7] w-52 rounded-xl sm:w-full" />
        <div className="space-y-3">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-8 w-3/4" />
          <Skeleton className="h-24 w-full" />
        </div>
      </div>
    </main>
  );
}
