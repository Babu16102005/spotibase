package com.spotibase.dto.response;

import java.io.Serializable;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * Wrapper for {@code GET /api/v1/youtube/resolve} single-video responses.
 * {@code watchUrl}/{@code embedUrl} are derived client-side helpers, not
 * Data API fields, so playback clients don't have to rebuild URLs.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class YoutubeResolveResponse implements Serializable {

    private static final long serialVersionUID = 1L;

    /** LIVE or MOCK — see {@link YoutubeVideoResponse#getSource()}. */
    private String source;
    private String watchUrl;
    private String embedUrl;
    private YoutubeVideoResponse video;
}
