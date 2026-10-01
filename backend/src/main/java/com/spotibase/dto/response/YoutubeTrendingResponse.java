package com.spotibase.dto.response;

import java.io.Serializable;
import java.util.List;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * Wrapper for {@code GET /api/v1/youtube/trending} list responses.
 *
 * <p>Pagination: {@code nextPageToken} is the opaque YouTube
 * {@code nextPageToken} for live results, or the mock catalogue offset
 * (stringified integer) for {@code MOCK} results. {@code null} means no
 * further pages. Omit {@code pageToken} (or send blank) for the first page.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class YoutubeTrendingResponse implements Serializable {

    private static final long serialVersionUID = 1L;

    private String regionCode;
    private int maxResults;
    private int count;
    /** LIVE or MOCK — see {@link YoutubeVideoResponse#getSource()}. */
    private String source;
    /**
     * Opaque token for the next page ({@code null} when exhausted).
     * Echo back as {@code ?pageToken=} to scroll.
     */
    private String nextPageToken;
    private List<YoutubeVideoResponse> videos;
}
