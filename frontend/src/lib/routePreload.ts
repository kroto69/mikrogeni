/**
 * Lazy route loaders, shared between App.tsx (React.lazy) and the navigation
 * (prefetch on hover/focus). Prefetching warms Vite's module cache, so tapping
 * a menu item after hovering it renders instantly instead of flashing the
 * Suspense fallback. import() is cached by the browser, so repeated calls are
 * cheap; the `warmed` set only skips re-invocation after a successful load so
 * a failed load can still be retried.
 */
export const routeLoaders = {
  dashboard: () => import("@/pages/Dashboard"),
  login: () => import("@/pages/Login"),
  mikrotik: () => import("@/pages/Mikrotik"),
  mikrotikDetail: () => import("@/pages/Mikrotik/Detail"),
  billing: () => import("@/pages/Billing"),
  onu: () => import("@/pages/ONU"),
  onuDetail: () => import("@/pages/ONU/Detail"),
  hioso: () => import("@/pages/Plugin/OltHioso"),
  settings: () => import("@/pages/Settings"),
  logs: () => import("@/pages/Logs"),
  zte: () => import("@/pages/ZTE/ONUListPage"),
} as const;

export type RouteLoaderKey = keyof typeof routeLoaders;

const warmed = new Set<RouteLoaderKey>();

export function preloadRoute(key: RouteLoaderKey): void {
  if (warmed.has(key)) {
    return;
  }
  try {
    const result = routeLoaders[key]() as Promise<unknown>;
    void result.then(
      () => {
        warmed.add(key);
      },
      () => {
        // Leave unwarmed so a later hover can retry.
      },
    );
  } catch {
    // Synchronous failure (shouldn't happen for import()); retry next time.
  }
}
