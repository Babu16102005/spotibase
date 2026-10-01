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
 *
 * <p>Canonical embed URL is
 * {@code https://www.youtube.com/embed/{id}?enablejsapi=1&rel=0} (clients
 * append {@code &origin=} themselves). We use the {@code www.youtube.com}
 * host — not {@code www.youtube-nocookie.com} — because
 * {@code enablejsapi=1} origin checks require it; privacy-strict clients can
 * rewrite the host to {@code www.youtube-nocookie.com/embed/{id}.
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
