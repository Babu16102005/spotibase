import apiClient from './client';
import type {
  YouTubeResolveResponse,
  YouTubeSearchResponse,
  YouTubeTrendingResponse,
  YouTubeVideo,
} from '../types/youtube';

/**
 * YouTube API via the shared apiClient (auth + base-URL retry interceptors).
 *
 * All methods accept an optional AbortSignal so screens can cancel in-flight
 * requests on debounce/unmount and avoid stale responses overwriting fresh
 * ones (same pattern as searchApi). Callers should ignore cancellations:
 *   err?.code === 'ERR_CANCELED' || err?.name === 'CanceledError'
 *
 * Backend contract (canonical — see src/types/youtube.ts):
 * - GET /youtube/trending?maxResults=&regionCode=
 * - GET /youtube/search?q=&maxResults=[&pageToken=]
 * - GET /youtube/resolve?id=
 * The backend also accepts legacy aliases (limit/query/videoId) but new
 * code must send the canonical names. pageToken is accepted server-side
 * (currently a no-op) so pagination never 400s.
 */

const withSignal = (signal?: AbortSignal) =>
  signal ? { signal } : undefined;

export const youtubeApi = {
  /**
   * Trending YouTube music videos.
   * GET /youtube/trending?maxResults=&regionCode=
   * Response is the { regionCode, maxResults, count, source, videos }
   * envelope — callers should also tolerate a bare array (offline mocks).
   */
  trending: (limit = 20, signal?: AbortSignal, regionCode?: string) =>
    apiClient.get<YouTubeVideo[] | YouTubeTrendingResponse>(
      `/youtube/trending?maxResults=${limit}${
        regionCode ? `&regionCode=${encodeURIComponent(regionCode)}` : ''
      }`,
      withSignal(signal)
    ),

  /**
   * Search YouTube for music videos.
   * GET /youtube/search?q=&maxResults=[&pageToken=]
   */
  search: (
    query: string,
    limit = 20,
    pageToken?: string,
    signal?: AbortSignal
  ) =>
    apiClient.get<YouTubeSearchResponse | YouTubeVideo[]>(
      `/youtube/search?q=${encodeURIComponent(query)}&maxResults=${limit}${
        pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''
      }`,
      withSignal(signal)
    ),

  /**
   * Resolve a video to a playable embed/stream URL.
   * GET /youtube/resolve?id=
   */
  resolve: (videoId: string, signal?: AbortSignal) =>
    apiClient.get<YouTubeResolveResponse>(
      `/youtube/resolve?id=${encodeURIComponent(videoId)}`,
      withSignal(signal)
    ),
};

export default youtubeApi;
