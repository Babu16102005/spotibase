/**
 * YouTube catalog types (mobile).
 *
 * Backend contract (GET /api/v1/youtube, canonical params):
 * - GET /youtube/trending?maxResults=&regionCode= -> YouTubeTrendingResponse
 *   (mobile defaults regionCode to "IN" for Trending in India)
 * - GET /youtube/search?q=&maxResults=[&pageToken=][&regionCode=][&relevanceLanguage=][&hl=]
 *   -> YouTubeSearchResponse
 *   (mobile defaults regionCode/relevanceLanguage/hl to "IN"/"ta"/"ta" for
 *   Tamil & Indian results)
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
  /**
   * Playback-safety flags mirrored from backend YoutubeVideoResponse
   * (status.embeddable / privacyStatus / regionRestriction / ytRating).
   * Null/undefined = unknown (fail-open). embeddable===false means the
   * owner disallows embedding — clients must show the fallback card
   * instead of mounting the iframe (avoids raw Error 150).
   */
  embeddable?: boolean | null;
  privacyStatus?: string | null;
  allowedRegions?: string[] | null;
  blockedRegions?: string[] | null;
  ageRestricted?: boolean | null;
}

export interface YouTubeSearchResponse {
  query: string;
  maxResults: number;
  count: number;
  source: string;
  videos: YouTubeVideo[];
  /** Forward-compat pagination token (backend currently omits it). */
  nextPageToken?: string | null;
  /** Echoed locale hints (mobile sends IN/ta/ta by default). */
  regionCode?: string;
  relevanceLanguage?: string;
  hl?: string;
}

export interface YouTubeTrendingResponse {
  regionCode: string;
  maxResults: number;
  count: number;
  source: string;
  videos: YouTubeVideo[];
  /** Forward-compat pagination token (backend currently omits it). */
  nextPageToken?: string | null;
  /** Echoed locale hints (mobile sends IN/ta by default). */
  relevanceLanguage?: string;
  hl?: string;
}

/** Locale options for YouTube catalog requests (defaults: IN / ta / ta). */
export interface YouTubeLocaleOptions {
  regionCode?: string;
  relevanceLanguage?: string;
  hl?: string;
}

/**
 * Pagination params for YouTube list endpoints (infinite scroll).
 * Both search and trending accept an opaque `pageToken` request param and
 * return an opaque `nextPageToken` envelope field. A null/absent
 * nextPageToken means the end of the feed (hasMore === false).
 */
export interface YouTubePaginationParams {
  /** Opaque cursor from the previous response's `nextPageToken`. */
  pageToken?: string;
  /** Page size (backend canonical name is maxResults). */
  maxResults?: number;
}

/** Search request params (canonical names — see youtubeApi.search). */
export interface YouTubeSearchParams extends YouTubePaginationParams, YouTubeLocaleOptions {
  q: string;
}

/** Trending request params (canonical names — see youtubeApi.trending). */
export interface YouTubeTrendingParams extends YouTubePaginationParams {
  regionCode?: string;
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
