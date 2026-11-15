import { APP_BASE_PATH } from '@/lib/app-path';

/** True when following `target` from `current` is a page load inside the app, so the top progress bar should run. */
export function isAppNavigation(target: URL, current: URL) {
  const inApp = target.pathname === APP_BASE_PATH || target.pathname.startsWith(`${APP_BASE_PATH}/`);
  const samePage = target.pathname === current.pathname && target.search === current.search;
  return target.origin === current.origin && inApp && !samePage;
}

export const navigationProgressStarters = new Set<() => void>();

/** Starts the top bar (components/navigation-progress.tsx) for a navigation that isn't a link click. */
export function startNavigationProgress() {
  for (const start of navigationProgressStarters) start();
}
