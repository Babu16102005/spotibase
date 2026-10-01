/**
 * Shared React Query client (Spotify-like instant loads).
 *
 * Defaults per spec: staleTime 30-60s, gcTime 30m, retry 1-2,
 * refetchOnWindowFocus false. Per-hook staleTimes (see cache/ttl.ts)
 * override the client default where a bucket needs its own window.
 */
import { QueryClient } from '@tanstack/react-query';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Mid-point of the 30-60s spec window; hooks override per bucket.
      staleTime: 45_000,
      // Keep inactive data for 30 minutes so back-navigation is instant.
      gcTime: 30 * 60 * 1000,
      // 1-2 retries: one retry for transient blips, no endless loops.
      retry: 2,
      // Mobile has no window focus semantics; focus revalidation is driven
      // explicitly via useFocusEffect prefetch helpers (see query/prefetch).
      refetchOnWindowFocus: false,
      // Revalidate after reconnecting — offline edits replay on return.
      refetchOnReconnect: true,
    },
  },
});

export default queryClient;
