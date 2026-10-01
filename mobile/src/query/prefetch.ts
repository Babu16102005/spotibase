/**
 * Focus-driven prefetch helpers (Spotify-like instant loads).
 *
 * Screens call these from `useFocusEffect` instead of fetching directly:
 * - paint comes from MMKV initialData / React Query cache synchronously,
 * - the network only fires when the entry is stale (TTL check first),
 * - everything is best-effort (never throws, never blocks render).
 */
import { queryClient } from './queryClient';
import { queryKeys } from './queryKeys';
import { TTL_MS, isFresh } from '../cache/ttl';
import { getSongsAt, SONGS_PAGE_SIZE } from '../cache/songListCache';
import { fetchHomeFeed } from './useHome';
import { fetchLibraryMerged } from './useLibrary';
import { fetchSongsPage } from './useSongs';
import type { SongsCursorPage, SongsPageParam } from './useSongs';
import { searchApi } from '../api/client';

/** Warm the home feed entry when older than TTL.HOME. */
export const prefetchHome = async (): Promise<void> => {
  try {
    const cached = queryClient.getQueryData(queryKeys.home) != null;
    const state = queryClient.getQueryState(queryKeys.home);
    const at = state?.dataUpdatedAt ?? 0;
    if (cached && isFresh(at, TTL_MS.HOME)) return;
    await queryClient.prefetchQuery({
      queryKey: queryKeys.home,
      queryFn: ({ signal }) => fetchHomeFeed(signal),
      staleTime: TTL_MS.HOME,
    });
  } catch {}
};

/** Warm the library entry when older than TTL.LIBRARY. */
export const prefetchLibrary = async (): Promise<void> => {
  try {
    const cached = queryClient.getQueryData(queryKeys.library) != null;
    const state = queryClient.getQueryState(queryKeys.library);
    const at = state?.dataUpdatedAt ?? 0;
    if (cached && isFresh(at, TTL_MS.LIBRARY)) return;
    await queryClient.prefetchQuery({
      queryKey: queryKeys.library,
      queryFn: ({ signal }) => fetchLibraryMerged(signal),
      staleTime: TTL_MS.LIBRARY,
    });
  } catch {}
};

/**
 * Warm the first songs page (MMKV timestamp gate) plus the *next* infinite
 * page when a catalogue query is already active — lists keep scrolling
 * without a spinner.
 */
export const prefetchSongs = async (): Promise<void> => {
  try {
    if (!isFresh(getSongsAt(), TTL_MS.SONGS)) {
      const initialParam: SongsPageParam = { cursor: null, page: 0, cursorUnsupported: false };
      await queryClient.prefetchInfiniteQuery({
        queryKey: queryKeys.songs.infinite(SONGS_PAGE_SIZE),
        queryFn: ({ pageParam, signal }) =>
          fetchSongsPage((pageParam ?? initialParam) as SongsPageParam, SONGS_PAGE_SIZE, signal),
        initialPageParam: initialParam,
        getNextPageParam: (lastPage: SongsCursorPage, _allPages, lastPageParam) => {
          if (!lastPage.hasMore) return undefined;
          const prev = lastPageParam as SongsPageParam;
          if (lastPage.cursorUnsupported) {
            return { cursor: null, page: prev.page + 1, cursorUnsupported: true } as SongsPageParam;
          }
          return { cursor: lastPage.nextCursor, page: prev.page + 1, cursorUnsupported: false } as SongsPageParam;
        },
        staleTime: TTL_MS.SONGS,
        pages: 1,
      });
    }
  } catch {}
};

/** Best-effort prefetch of the page after the last loaded one into the
 * infinite catalogue entry (the key screens actually read). Seeds the next
 * page via setQueryData so scrolling never hits a spinner. */
export const prefetchNextSongsPage = async (
  limit: number = SONGS_PAGE_SIZE,
  getNextParam?: () => { cursor: string | null; page: number; cursorUnsupported: boolean } | undefined
): Promise<void> => {
  try {
    const next = getNextParam?.();
    if (!next) return;
    const page = await fetchSongsPage(next, limit);
    const key = queryKeys.songs.infinite(limit);
    const cached = queryClient.getQueryData<{ pages: SongsCursorPage[]; pageParams: unknown[] }>(key);
    if (!cached) return;
    queryClient.setQueryData(key, {
      ...cached,
      pages: [...cached.pages, page],
      pageParams: [...cached.pageParams, next],
    });
  } catch {}
};

/** Warm trending-search suggestions (landing data for SearchScreen). */
export const prefetchSearchTrending = async (): Promise<void> => {
  try {
    await queryClient.prefetchQuery({
      queryKey: queryKeys.searchTrending,
      queryFn: () => searchApi.trending().then((r) => r.data),
      staleTime: TTL_MS.SEARCH,
    });
  } catch {}
};

/** Warm everything after login / session restore (parallel, best-effort). */
export const warmCriticalCaches = async (): Promise<void> => {
  await Promise.allSettled([prefetchHome(), prefetchLibrary(), prefetchSongs()]);
};
