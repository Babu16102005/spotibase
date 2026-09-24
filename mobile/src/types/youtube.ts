/**
 * YouTube catalog types (mobile).
 *
 * Backend contract (GET /api/v1/youtube, canonical params):
 * - GET /youtube/trending?maxResults=&regionCode= -> YouTubeTrendingResponse
 * - GET /youtube/search?q=&maxResults=[&pageToken=] -> YouTubeSearchResponse
 * - GET /youtube/resolve?id=                    -> YouTubeResolveResponse
 *
 * Legacy aliases still accepted server-side (limit/query/videoId) for
 * older clients; new code must send the canonical names above.
 * List envelopes always carry { maxResults, count, source, videos }.
 */

export interface YouTubeVideo {
  videoId: string;
  title: string;
  channelId?: string;
  channelTitle?: string;
  description?: string | null;
  thumbnailUrl: string;
  publishedAt?: string | null;
  /**
   * ISO-8601 duration as returned by the backend (e.g. "PT4M13S").
   * Use formatYouTubeDuration() / parseIsoDurationToMs() to display.
   */
  duration?: string | null;
  /** Duration in milliseconds when the backend provides it. */
  durationMs?: number;
  viewCount?: number;
  /** LIVE or MOCK — tells clients whether this row came from the quota-backed API. */
  source?: string;
}

export interface YouTubeSearchResponse {
  query: string;
  maxResults: number;
  count: number;
  source: string;
  videos: YouTubeVideo[];
  /** Forward-compat pagination token (backend currently omits it). */
  nextPageToken?: string | null;
}

export interface YouTubeTrendingResponse {
  regionCode: string;
  maxResults: number;
  count: number;
  source: string;
  videos: YouTubeVideo[];
  /** Forward-compat pagination token (backend currently omits it). */
  nextPageToken?: string | null;
}

/** Stream/embed resolution for a single video. */
export interface YouTubeResolveResponse {
  source: string;
  watchUrl?: string;
  /** Privacy-enhanced embed URL (youtube-nocookie.com). */
  embedUrl: string;
  video: YouTubeVideo;
  /** Direct stream URL when the backend can provide one (optional). */
  streamUrl?: string | null;
  /** Legacy flat fields kept for older call sites (prefer video.*). */
  videoId?: string;
  title?: string;
  thumbnailUrl?: string;
}

/** Alias kept for call sites that import the short name. */
export type YouTubeResolve = YouTubeResolveResponse;
