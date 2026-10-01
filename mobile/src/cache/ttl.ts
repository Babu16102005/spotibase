/**
 * Central TTL definitions for all client-side caches (Spotify-like instant loads).
 *
 * Single source of truth — homeFeedCache, songListCache and LibraryScreen must
 * import from here instead of declaring their own freshness windows so the
 * whole app agrees on staleness.
 *
 * - HOME:           30s — legacy full home feed (recently played, trending)
 * - HOME_CRITICAL:  45s — recently-played + trending (stale-while-revalidate)
 * - HOME_SECONDARY:  5m — browse/catalog sections (stable per user)
 * - HOME_HEAVY:     15m — made-for-you + daily mixes (expensive personalization)
 * - LIBRARY: 30s — user library (playlists, liked songs) changes often
 * - SONGS:   60s — song catalogue is comparatively stable
 * - SEARCH:  60s — search results are comparatively stable per query
 */
export const TTL_MS = {
  HOME: 30_000,
  HOME_CRITICAL: 45_000,
  HOME_SECONDARY: 5 * 60_000,
  HOME_HEAVY: 15 * 60_000,
  LIBRARY: 30_000,
  SONGS: 60_000,
  SEARCH: 60_000,
} as const;

export type TtlKey = keyof typeof TTL_MS;

/**
 * Returns true when `cachedAt` (epoch ms) is set and younger than `ttlMs`.
 */
export const isFresh = (
  cachedAt: number | null | undefined,
  ttlMs: number,
  now: number = Date.now()
): boolean => {
  return typeof cachedAt === 'number' && cachedAt > 0 && now - cachedAt < ttlMs;
};

/** Convenience: freshness check for a named TTL bucket. */
export const isBucketFresh = (
  cachedAt: number | null | undefined,
  bucket: TtlKey,
  now: number = Date.now()
): boolean => isFresh(cachedAt, TTL_MS[bucket], now);
