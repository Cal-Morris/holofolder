import { BinderSkeleton } from '@/components/binder-skeleton';

// Without this, share links fall back to app/loading.tsx's spinner while the binder loads.
export default function Loading() {
  return <BinderSkeleton />;
}
