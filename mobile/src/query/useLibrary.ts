/**
 * Library queries without the getLibrary-then-getFeatured waterfall.
 *
 * The old LibraryScreen awaited `getLibrary()` and only afterwards — when the
 * payload lacked featured playlists — awaited `getFeatured()`. Both requests
 * below fire concurrently via Promise.all / useQueries so total latency is
 * max(parts) instead of sum(parts).
 */
import { useEffect } from 'react';
import { useQueries, useQuery } from '@tanstack/react-query';
import { libraryApi, playlistApi } from '../api/client';
import { TTL_MS } from '../cache/ttl';
import { queryKeys } from './queryKeys';
import type {
  AlbumResponse,
  ArtistResponse,
  LibraryResponse,
  PlaylistResponse,
  SongResponse,
} from '../types';

const LIBRARY_CACHE_KEY = 'libraryDataV2';
const LEGACY_LIBRARY_CACHE_KEY = 'libraryData';

export const readLibrarySnapshot = (): LibraryResponse | null => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getStorage } = require('../utils');
    const cache = getStorage('spotibase-cache');
    const rawV2 = cache.getString(LIBRARY_CACHE_KEY);
    if (rawV2) return JSON.parse(rawV2) as LibraryResponse;
    const rawV1 = cache.getString(LEGACY_LIBRARY_CACHE_KEY);
    return rawV1 ? (JSON.parse(rawV1) as LibraryResponse) : null;
  } catch {
    return null;
  }
};

const writeLibrarySnapshot = (payload: LibraryResponse): void => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getStorage } = require('../utils');
    const cache = getStorage('spotibase-cache');
    cache.set(LIBRARY_CACHE_KEY, JSON.stringify(payload));
    cache.set('libraryDataAtV2', Date.now());
  } catch {}
};

const withFeatured = (
  lib: LibraryResponse,
  featured: PlaylistResponse[]
): LibraryResponse => {
  if (Array.isArray((lib as LibraryResponse)?.featuredPlaylists)) return lib;
  return {
    ...lib,
    featuredPlaylists: featured,
    totalFeaturedPlaylists: lib?.totalFeaturedPlaylists ?? featured.length,
  };
};

/**
 * Sequential fetch: /library first; /playlists/featured fires only when the
 * payload lacks featuredPlaylists (back-compat fallback). A featured failure
 * never fails the library.
 */
export const fetchLibraryMerged = async (
  signal?: AbortSignal
): Promise<LibraryResponse> => {
  const res = await libraryApi.getLibrary(signal);
  const lib = res.data as LibraryResponse;
  if (Array.isArray(lib?.featuredPlaylists)) return lib;
  let fallback: PlaylistResponse[] = [];
  try {
    const featured = await playlistApi.getFeatured(20, signal);
    if (Array.isArray(featured.data)) fallback = featured.data as PlaylistResponse[];
  } catch {}
  return withFeatured(lib, fallback);
};

export interface LibraryParts {
  playlists: PlaylistResponse[];
  albums: AlbumResponse[];
  artists: ArtistResponse[];
  likedSongs: SongResponse[];
  featured: PlaylistResponse[];
}

/**
 * Fully granular parallel fetch: playlists, albums, artists, liked-songs and
 * featured all fire together (Promise.all) and are composed into a
 * LibraryResponse. Individual part failures degrade to empty lists so one
 * slow/broken endpoint never blanks the whole library.
 */
export const fetchLibraryParts = async (signal?: AbortSignal): Promise<LibraryParts> => {
  const [playlists, albums, artists, likedSongs, featured] = await Promise.all([
    libraryApi.getPlaylists(signal).then((r) => r.data as PlaylistResponse[]).catch(() => [] as PlaylistResponse[]),
    libraryApi.getAlbums(signal).then((r) => r.data as AlbumResponse[]).catch(() => [] as AlbumResponse[]),
    libraryApi.getArtists(signal).then((r) => r.data as ArtistResponse[]).catch(() => [] as ArtistResponse[]),
    libraryApi.getLikedSongs(signal).then((r) => r.data as SongResponse[]).catch(() => [] as SongResponse[]),
    playlistApi.getFeatured(20, signal).then((r) => (Array.isArray(r.data) ? (r.data as PlaylistResponse[]) : [])).catch(() => [] as PlaylistResponse[]),
  ]);
  return { playlists, albums, artists, likedSongs, featured };
};

export const partsToLibrary = (parts: LibraryParts): LibraryResponse => ({
  playlists: parts.playlists,
  albums: parts.albums,
  artists: parts.artists,
  likedSongs: parts.likedSongs,
  totalPlaylists: parts.playlists.length,
  totalAlbums: parts.albums.length,
  totalArtists: parts.artists.length,
  totalLikedSongs: parts.likedSongs.length,
  featuredPlaylists: parts.featured,
  totalFeaturedPlaylists: parts.featured.length,
});

interface UseLibraryOptions {
  enabled?: boolean;
}

export const useLibrary = ({ enabled = true }: UseLibraryOptions = {}) => {
  const query = useQuery({
    queryKey: queryKeys.library,
    queryFn: ({ signal }) => fetchLibraryMerged(signal),
    staleTime: TTL_MS.LIBRARY,
    gcTime: 30 * 60 * 1000,
    retry: 2,
    refetchOnWindowFocus: false,
    enabled,
    initialData: () => readLibrarySnapshot() ?? undefined,
  });

  useEffect(() => {
    if (query.data) writeLibrarySnapshot(query.data);
  }, [query.data]);

  return query;
};

/**
 * Granular variant: five parallel sub-queries via useQueries (no waterfall).
 * Prefer `useLibrary` when the combined /library endpoint is available.
 */
export const useLibraryParts = ({ enabled = true }: UseLibraryOptions = {}) => {
  const results = useQueries({
    queries: [
      {
        queryKey: queryKeys.libraryParts.playlists,
        queryFn: ({ signal }: { signal: AbortSignal }) =>
          libraryApi.getPlaylists(signal).then((r) => r.data as PlaylistResponse[]),
        staleTime: TTL_MS.LIBRARY,
        gcTime: 30 * 60 * 1000,
        retry: 2,
        refetchOnWindowFocus: false,
        enabled,
      },
      {
        queryKey: queryKeys.libraryParts.albums,
        queryFn: ({ signal }: { signal: AbortSignal }) =>
          libraryApi.getAlbums(signal).then((r) => r.data as AlbumResponse[]),
        staleTime: TTL_MS.LIBRARY,
        gcTime: 30 * 60 * 1000,
        retry: 2,
        refetchOnWindowFocus: false,
        enabled,
      },
      {
        queryKey: queryKeys.libraryParts.artists,
        queryFn: ({ signal }: { signal: AbortSignal }) =>
          libraryApi.getArtists(signal).then((r) => r.data as ArtistResponse[]),
        staleTime: TTL_MS.LIBRARY,
        gcTime: 30 * 60 * 1000,
        retry: 2,
        refetchOnWindowFocus: false,
        enabled,
      },
      {
        queryKey: queryKeys.libraryParts.likedSongs,
        queryFn: ({ signal }: { signal: AbortSignal }) =>
          libraryApi.getLikedSongs(signal).then((r) => r.data as SongResponse[]),
        staleTime: TTL_MS.LIBRARY,
        gcTime: 30 * 60 * 1000,
        retry: 2,
        refetchOnWindowFocus: false,
        enabled,
      },
      {
        queryKey: queryKeys.libraryParts.featured,
        queryFn: ({ signal }: { signal: AbortSignal }) =>
          playlistApi.getFeatured(20, signal).then((r) => (Array.isArray(r.data) ? (r.data as PlaylistResponse[]) : [])),
        staleTime: TTL_MS.LIBRARY,
        gcTime: 30 * 60 * 1000,
        retry: 1,
        refetchOnWindowFocus: false,
        enabled,
      },
    ],
  });

  const [playlists, albums, artists, likedSongs, featured] = results;
  const isPending = results.some((r) => r.isPending);
  const isError = results.some((r) => r.isError);
  const parts: LibraryParts = {
    playlists: (playlists.data ?? []) as PlaylistResponse[],
    albums: (albums.data ?? []) as AlbumResponse[],
    artists: (artists.data ?? []) as ArtistResponse[],
    likedSongs: (likedSongs.data ?? []) as SongResponse[],
    featured: (featured.data ?? []) as PlaylistResponse[],
  };

  return { ...results, parts, library: partsToLibrary(parts), isPending, isError };
};
