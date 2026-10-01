/**
 * Central React Query key factory. All hooks must build keys from here so
 * prefetch/invalidation target exactly the same entries the screens read.
 */
export const queryKeys = {
  home: ['home'] as const,
  /** Staged home tiers: critical → secondary → heavy (see useHomeTiers). */
  homeTiers: {
    root: ['home', 'tiers'] as const,
    critical: ['home', 'critical'] as const,
    secondary: ['home', 'secondary'] as const,
    heavy: ['home', 'heavy'] as const,
  },
  library: ['library'] as const,
  libraryParts: {
    root: ['library', 'parts'] as const,
    playlists: ['library', 'parts', 'playlists'] as const,
    albums: ['library', 'parts', 'albums'] as const,
    artists: ['library', 'parts', 'artists'] as const,
    likedSongs: ['library', 'parts', 'liked-songs'] as const,
    featured: ['library', 'parts', 'featured'] as const,
  },
  songs: {
    /** Infinite catalogue list. `limit` is part of the key. */
    infinite: (limit: number) => ['songs', 'infinite', limit] as const,
    page: (page: number, size: number) => ['songs', 'page', page, size] as const,
  },
  /** One entry per debounced query string (+ types). */
  search: (query: string, types: string) => ['search', query, types] as const,
  searchTrending: ['search', 'trending'] as const,
} as const;
