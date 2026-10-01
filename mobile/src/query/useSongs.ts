/**
 * Infinite songs catalogue over GET /songs/cursor.
 *
 * Uses useInfiniteQuery with React Query request dedup (identical in-flight
 * queries are coalesced by key), which supersedes the old AllSongsScreen
 * `inFlightRef` guard. The cursor endpoint is tried first; when the backend
 * does not implement it yet (404/405) the fetcher transparently falls back to
 * the paged /songs?page&size endpoint so the UI works against both backends.
 */
import { useInfiniteQuery } from '@tanstack/react-query';
import apiClient, { songApi } from '../api/client';
import { READ_TIMEOUT_MS } from '../api/client';
import { TTL_MS } from '../cache/ttl';
import { SONGS_PAGE_SIZE } from '../cache/songListCache';
import { queryKeys } from './queryKeys';
import type { PagedResponse, SongResponse } from '../types';

export interface SongsCursorPage {
  content: SongResponse[];
  /** Opaque cursor for the next page; null when exhausted. */
  nextCursor: string | null;
  hasMore: boolean;
  totalElements?: number;
  /**
   * Internal: true when this page came from the paged fallback (or a
   * non-paginated array shape). Drives getNextPageParam into numeric paging
   * instead of re-requesting the cursor endpoint without a cursor.
   */
  cursorUnsupported?: boolean;
}

/** PageParam carries both cursor-mode and page-fallback state. */
export interface SongsPageParam {
  cursor: string | null;
  /** Numeric page used only when the backend lacks /songs/cursor. */
  page: number;
  cursorUnsupported: boolean;
}

const INITIAL_PARAM: SongsPageParam = { cursor: null, page: 0, cursorUnsupported: false };

const toCursorPage = (data: any, limit: number): SongsCursorPage | null => {
  if (!data) return null;
  if (Array.isArray(data)) {
    return { content: data as SongResponse[], nextCursor: null, hasMore: data.length >= limit };
  }
  if (Array.isArray((data as PagedResponse<SongResponse>)?.content)) {
    // Already a paged payload (should not happen here, but normalize anyway).
    const paged = data as PagedResponse<SongResponse>;
    return {
      content: paged.content,
      nextCursor: paged.last ? null : String(paged.page + 1),
      hasMore: !paged.last && paged.content.length > 0,
      totalElements: paged.totalElements,
    };
  }
  const content = (data.content ?? []) as SongResponse[];
  const nextCursor =
    data.nextCursor ?? data.nextPageToken ?? data.cursor ?? null;
  const hasMore =
    typeof data.hasMore === 'boolean'
      ? data.hasMore
      : typeof data.last === 'boolean'
        ? !data.last && content.length > 0
        : nextCursor != null || content.length >= limit;
  return {
    content,
    nextCursor: hasMore ? (nextCursor != null ? String(nextCursor) : null) : null,
    hasMore,
    totalElements: data.totalElements,
  };
};

const isCursorUnsupported = (err: any): boolean => {
  const status = err?.response?.status;
  return status === 404 || status === 405;
};

/** Single page fetch: cursor endpoint first, paged fallback on 404/405. */
export const fetchSongsPage = async (
  param: SongsPageParam,
  limit: number,
  signal?: AbortSignal
): Promise<SongsCursorPage> => {
  if (!param.cursorUnsupported) {
    try {
      const qs = [`size=${limit}`];
      if (param.cursor != null) qs.push(`cursorId=${encodeURIComponent(param.cursor)}`);
      const res = await apiClient.get(`/songs/cursor?${qs.join('&')}`, {
        ...(signal ? { signal } : {}),
        timeout: READ_TIMEOUT_MS,
      });
      // Bare-array shape = endpoint without pagination support: this page is
      // usable, but the *next* fetch must use the paged fallback.
      const bareArray = Array.isArray(res.data);
      const page = toCursorPage(res.data, limit) ?? { content: [], nextCursor: null, hasMore: false };
      return bareArray ? { ...page, cursorUnsupported: true } : page;
    } catch (err: any) {
      if (!isCursorUnsupported(err)) throw err;
      // Fall through to the paged endpoint with the same position.
    }
  }
  const res = await songApi.getAll(param.page, limit, signal);
  const paged = res.data;
  return {
    content: paged.content,
    nextCursor: paged.last ? null : String(param.page + 1),
    hasMore: !paged.last && paged.content.length > 0,
    totalElements: paged.totalElements,
    cursorUnsupported: true,
  };
};

interface UseSongsOptions {
  limit?: number;
  enabled?: boolean;
}

export const useSongs = ({ limit = SONGS_PAGE_SIZE, enabled = true }: UseSongsOptions = {}) => {
  return useInfiniteQuery({
    queryKey: queryKeys.songs.infinite(limit),
    queryFn: ({ pageParam, signal }) =>
      fetchSongsPage(pageParam as SongsPageParam, limit, signal),
    initialPageParam: INITIAL_PARAM as SongsPageParam,
    getNextPageParam: (lastPage, _allPages, lastPageParam) => {
      if (!lastPage.hasMore) return undefined;
      const prev = lastPageParam as SongsPageParam;
      // Paged-fallback mode (backend lacks /songs/cursor, or it returned a
      // non-paginated array): advance numerically. Cursor mode follows the
      // opaque cursor verbatim.
      if (lastPage.cursorUnsupported) {
        return { cursor: null, page: prev.page + 1, cursorUnsupported: true } as SongsPageParam;
      }
      return { cursor: lastPage.nextCursor, page: prev.page + 1, cursorUnsupported: false } as SongsPageParam;
    },
    staleTime: TTL_MS.SONGS,
    gcTime: 30 * 60 * 1000,
    retry: 2,
    refetchOnWindowFocus: false,
    enabled,
  });
};

/** Flatten helper for screens: pages -> song list. */
export const flattenSongsPages = (pages: SongsCursorPage[] | undefined): SongResponse[] => {
  if (!pages) return [];
  const map = new Map<string, SongResponse>();
  for (const p of pages) {
    for (const s of p.content) map.set(s.id, s);
  }
  return Array.from(map.values());
};
