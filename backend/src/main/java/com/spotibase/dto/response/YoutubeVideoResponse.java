package com.spotibase.dto.response;

import java.io.Serializable;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * Single YouTube video entry served by the {@code /api/v1/youtube} proxy.
 *
 * <p>{@code source} is {@code LIVE} for YouTube Data API v3 responses and
 * {@code MOCK} for the built-in offline fallback (no API key configured or
 * upstream quota/network failure). The API key itself is never exposed here.
 *
 * <p>Playback-safety flags (issue #153): {@code embeddable} mirrors
 * {@code status.embeddable}; {@code privacyStatus} mirrors
 * {@code status.privacyStatus} ({@code public}/{@code unlisted}/{@code private});
 * {@code allowedRegions}/{@code blockedRegions} mirror
 * {@code contentDetails.regionRestriction.allowed/blocked};
 * {@code ageRestricted} is true when
 * {@code contentDetails.contentRating.ytRating=ytAgeRestricted}.
 * Null means "unknown" (e.g. search hydration failed) and must be treated as
 * playable by fail-open filtering.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class YoutubeVideoResponse implements Serializable {

    private static final long serialVersionUID = 2L;

    private String videoId;
    private String title;
    private String channelId;
    private String channelTitle;
    private String description;
    private String thumbnailUrl;
    /** ISO-8601 publish timestamp as returned by the Data API (may be null for mock rows). */
    private String publishedAt;
    /** ISO-8601 duration (e.g. {@code PT4M13S}); null when unavailable. */
    private String duration;
    private long viewCount;
    /** LIVE or MOCK — tells clients whether this row came from the quota-backed API. */
    private String source;
    /** Mirrors {@code status.embeddable}. Null = unknown (treat as playable, fail-open). */
    private Boolean embeddable;
    /** Mirrors {@code status.privacyStatus}. Null = unknown (treat as playable). */
    private String privacyStatus;
    /** Mirrors {@code contentDetails.regionRestriction.allowed}. Null/empty = no allowlist. */
    private java.util.List<String> allowedRegions;
    /** Mirrors {@code contentDetails.regionRestriction.blocked}. Null/empty = not blocked. */
    private java.util.List<String> blockedRegions;
    /** True when {@code contentDetails.contentRating.ytRating=ytAgeRestricted}. Null = unknown. */
    private Boolean ageRestricted;
}
