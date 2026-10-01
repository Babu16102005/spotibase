import apiClient, { YOUTUBE_SEARCH_TIMEOUT_MS } from './client';
import type {
  YouTubeLocaleOptions,
  YouTubeResolveResponse,
  YouTubeSearchResponse,
  YouTubeTrendingResponse,
  YouTubeVideo,
} from '../types/youtube';

/**
 * Default locale for the YouTube catalog: India (region) + Tamil (language).
 * Trending defaults to regionCode IN ("Trending in India"); search defaults
 * to regionCode IN + relevanceLanguage ta + hl ta ("Tamil & Indian songs").
 */
export const YOUTUBE_DEFAULT_REGION_CODE = 'IN';
export const YOUTUBE_DEFAULT_RELEVANCE_LANGUAGE = 'ta';
export const YOUTUBE_DEFAULT_HL = 'ta';

/**
 * Centralized India-first locale bundle — single source of truth for
 * IN/ta/ta. Screens (Songs/Watch) and MiniYouTubeOverlay must import this
 * (or the individual constants above) instead of hardcoding literals.
 */
export const YOUTUBE_DEFAULT_LOCALE = {
  regionCode: YOUTUBE_DEFAULT_REGION_CODE,
  relevanceLanguage: YOUTUBE_DEFAULT_RELEVANCE_LANGUAGE,
  hl: YOUTUBE_DEFAULT_HL,
} as const;

/**
 * Default Tamil-first feed query for the Songs screen (empty query state).
 * Clearing search returns to this feed — never to an empty state.
 * Sent with YOUTUBE_DEFAULT_LOCALE (IN/ta/ta) via youtubeApi.search.
 */
export const YOUTUBE_DEFAULT_TAMIL_QUERY = 'Tamil songs';

/**
 * YouTube API via the shared apiClient (auth + base-URL retry interceptors).
 *
 * All methods accept an optional AbortSignal so screens can cancel in-flight
 * requests on debounce/unmount and avoid stale responses overwriting fresh
 * ones (same pattern as searchApi). Callers should ignore cancellations:
 *   err?.code === 'ERR_CANCELED' || err?.name === 'CanceledError'
 *
 * Backend contract (canonical — see src/types/youtube.ts):
 * - GET /youtube/trending?maxResults=&regionCode=[&pageToken=] (regionCode defaults to IN)
 * - GET /youtube/search?q=&maxResults=[&pageToken=][&regionCode=][&relevanceLanguage=][&hl=]
 *   (regionCode/relevanceLanguage/hl default to IN/ta/ta)
 * - GET /youtube/resolve?id=
 * The backend also accepts legacy aliases (limit/query/videoId) but new
 * code must send the canonical names. pageToken is accepted server-side
 * (currently a no-op) so pagination never 400s. Extra locale params are
 * ignored by older backends, so sending them is forward- and backward-safe.
 */

const withSignal = (signal?: AbortSignal) => ({
  ...(signal ? { signal } : {}),
  timeout: YOUTUBE_SEARCH_TIMEOUT_MS,
});

/** Strict videoId for resolve: 11 chars [A-Za-z0-9_-]. Mirrors YouTubePlayer. */
const YOUTUBE_VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;

export const youtubeApi = {
  /**
   * Trending YouTube music videos (defaults to India).
   * GET /youtube/trending?maxResults=&regionCode=IN[&pageToken=]
   * Response is the { regionCode, maxResults, count, source, videos,
   * nextPageToken } envelope — callers should also tolerate a bare array
   * (offline mocks). pageToken enables infinite scroll; the backend treats
   * it as forward-compat (currently a no-op) so pagination never 400s.
   */
  trending: (
    limit = 20,
    signal?: AbortSignal,
    regionCode: string = YOUTUBE_DEFAULT_REGION_CODE,
    pageToken?: string
  ) =>
    apiClient.get<YouTubeVideo[] | YouTubeTrendingResponse>(
      `/youtube/trending?maxResults=${limit}${
        regionCode ? `&regionCode=${encodeURIComponent(regionCode)}` : ''
      }${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`,
      withSignal(signal)
    ),

  /**
   * Search YouTube for music videos (defaults to Tamil & Indian results).
   * GET /youtube/search?q=&maxResults=[&pageToken=]&regionCode=IN&relevanceLanguage=ta&hl=ta
   */
  search: (
    query: string,
    limit = 20,
    pageToken?: string,
    signal?: AbortSignal,
    locale?: YouTubeLocaleOptions
  ) => {
    const regionCode = locale?.regionCode ?? YOUTUBE_DEFAULT_REGION_CODE;
    const relevanceLanguage =
      locale?.relevanceLanguage ?? YOUTUBE_DEFAULT_RELEVANCE_LANGUAGE;
    const hl = locale?.hl ?? YOUTUBE_DEFAULT_HL;
    return apiClient.get<YouTubeSearchResponse | YouTubeVideo[]>(
      `/youtube/search?q=${encodeURIComponent(query)}&maxResults=${limit}${
        pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''
      }${regionCode ? `&regionCode=${encodeURIComponent(regionCode)}` : ''}${
        relevanceLanguage
          ? `&relevanceLanguage=${encodeURIComponent(relevanceLanguage)}`
          : ''
      }${hl ? `&hl=${encodeURIComponent(hl)}` : ''}`,
      withSignal(signal)
    );
  },

  /**
   * Resolve a video to a playable embed/stream URL.
   * GET /youtube/resolve?id=
   * Strict videoId: must match /^[A-Za-z0-9_-]{11}$/ (fail fast, no request).
   */
  resolve: (videoId: string, signal?: AbortSignal) => {
    if (typeof videoId !== 'string' || !YOUTUBE_VIDEO_ID_PATTERN.test(videoId)) {
      throw new Error(`Invalid YouTube videoId: ${String(videoId)}`);
    }
    return apiClient.get<YouTubeResolveResponse>(
      `/youtube/resolve?id=${encodeURIComponent(videoId)}`,
      withSignal(signal)
    );
  },
};

export default youtubeApi;
