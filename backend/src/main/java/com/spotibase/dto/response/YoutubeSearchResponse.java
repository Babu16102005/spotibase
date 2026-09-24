package com.spotibase.dto.response;

import java.io.Serializable;
import java.util.List;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * Wrapper for {@code GET /api/v1/youtube/search} list responses.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class YoutubeSearchResponse implements Serializable {

    private static final long serialVersionUID = 1L;

    private String query;
    private int maxResults;
    private int count;
    /** LIVE or MOCK — see {@link YoutubeVideoResponse#getSource()}. */
    private String source;
    private List<YoutubeVideoResponse> videos;
}
